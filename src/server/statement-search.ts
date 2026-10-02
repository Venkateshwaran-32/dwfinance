import "server-only";
import { cleanMerchant } from "./merchants";
import { CATEGORIES } from "./categorize";

// Search + filter model for the Statements page and its CSV export. Everything is driven by URL params so a
// view can be bookmarked, shared and deep-linked from chat. Pure functions: no DB access here.

export const PAY_TYPES = [
  ["paynow", "PayNow"], ["nets", "NETS QR"], ["card", "Card"], ["giro", "GIRO"], ["bill", "Bill payment"], ["transfer", "Bank transfer"], ["other", "Other"],
] as const;
export type PayType = (typeof PAY_TYPES)[number][0];

// How the money moved, read from the bank's own narration.
export function paymentType(description: string): PayType {
  const d = description.toLowerCase();
  if (d.includes("paynow")) return "paynow";
  if (d.includes("nets")) return "nets";
  if (/debit card|credit card/.test(d)) return "card";
  if (d.includes("giro")) return "giro";
  if (d.includes("bill payment")) return "bill";
  if (/funds? ?transfer|fast payment|interbank/.test(d)) return "transfer";
  return "other";
}

export type ParsedQuery = { include: string[]; exclude: string[]; minCents: number | null; maxCents: number | null };

const NUM = String.raw`(?:s?\$)?(\d+(?:\.\d{1,2})?)`;
const OP = new RegExp(`^(>=|<=|>|<|=)${NUM}$`, "i");
const RANGE = new RegExp(`^${NUM}\\.\\.${NUM}$`, "i");
const toCents = (s: string) => Math.round(Number(s) * 100);

// Search-box syntax: plain words must all match; "quoted phrase" matches exactly; -word excludes;
// >50  >=50  <10  <=10  =3.30  10..20 filter by amount in SGD.
export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { include: [], exclude: [], minCents: null, maxCents: null };
  const atLeast = (c: number) => { out.minCents = out.minCents === null ? c : Math.max(out.minCents, c); };
  const atMost = (c: number) => { out.maxCents = out.maxCents === null ? c : Math.min(out.maxCents, c); };
  for (const m of raw.slice(0, 200).matchAll(/(-?)"([^"]+)(?:"|$)|(\S+)/g)) {
    if (m[2] !== undefined) {
      const phrase = m[2].trim().toLowerCase();
      if (phrase) (m[1] ? out.exclude : out.include).push(phrase);
      continue;
    }
    const tok = m[3];
    const op = OP.exec(tok);
    const range = RANGE.exec(tok);
    if (op) {
      const c = toCents(op[2]);
      if (op[1] === ">") atLeast(c + 1);
      else if (op[1] === ">=") atLeast(c);
      else if (op[1] === "<") atMost(c - 1);
      else if (op[1] === "<=") atMost(c);
      else { atLeast(c); atMost(c); }
    } else if (range) {
      atLeast(Math.min(toCents(range[1]), toCents(range[2])));
      atMost(Math.max(toCents(range[1]), toCents(range[2])));
    } else if (tok.startsWith("-") && tok.length > 1) out.exclude.push(tok.slice(1).toLowerCase());
    else if (tok !== "-") out.include.push(tok.toLowerCase());
  }
  return out;
}

export const SORTS = [["default", "Statement order"], ["newest", "Newest first"], ["largest", "Largest amount"], ["smallest", "Smallest amount"]] as const;
export const GROUPS = [["month", "Month"], ["payee", "Payee"], ["category", "Category"], ["none", "No grouping"]] as const;
export type Sort = (typeof SORTS)[number][0];
export type Group = (typeof GROUPS)[number][0];

export type SearchParams = Partial<Record<
  "q" | "not" | "category" | "cats" | "from" | "to" | "month" | "dir" | "min" | "max" | "review" | "type" | "sort" | "group" | "all" | "adv" | "oneoff",
  string
>>;

export type Search = {
  q: string; not: string; include: string[]; exclude: string[];
  categories: string[]; types: PayType[];
  month: string; fromIso: string; toIso: string; from: Date | null; to: Date | null;
  dir: "" | "out" | "in"; minCents: number | null; maxCents: number | null; minField: string; maxField: string;
  review: boolean; oneOff: boolean; sort: Sort; group: Group; showAll: boolean;
  active: boolean; // any filter set (sort / group / showAll do not count)
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;
const list = (s?: string) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const fieldCents = (s?: string) => { const n = Number(s); return s && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

export function buildSearch(sp: SearchParams): Search {
  const q = (sp.q ?? "").trim().slice(0, 200);
  const not = (sp.not ?? "").trim().slice(0, 100);
  const pq = parseQuery(q);
  const pn = parseQuery(not); // the "exclude" field: every word / "phrase" in it is excluded
  const valid = (c: string) => (CATEGORIES as readonly string[]).includes(c);
  const categories = [...new Set([...(sp.category && valid(sp.category) ? [sp.category] : []), ...list(sp.cats).filter(valid)])];
  const types = [...new Set(list(sp.type))].filter((t): t is PayType => PAY_TYPES.some(([k]) => k === t));

  const month = sp.month && YM.test(sp.month) ? sp.month : "";
  const fromIso = !month && sp.from && ISO.test(sp.from) ? sp.from : "";
  const toIso = !month && sp.to && ISO.test(sp.to) ? sp.to : "";
  const from = month ? new Date(`${month}-01T00:00:00Z`) : fromIso ? new Date(`${fromIso}T00:00:00Z`) : null;
  const to = month ? new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0, 23, 59, 59, 999)) : toIso ? new Date(`${toIso}T23:59:59.999Z`) : null;

  const fMin = fieldCents(sp.min), fMax = fieldCents(sp.max);
  const mins = [fMin, pq.minCents].filter((v): v is number => v !== null);
  const maxs = [fMax, pq.maxCents].filter((v): v is number => v !== null);
  const dir = sp.dir === "out" || sp.dir === "in" ? sp.dir : "";
  const review = sp.review === "1";
  const sort = SORTS.some(([k]) => k === sp.sort) ? (sp.sort as Sort) : "default";
  const group = GROUPS.some(([k]) => k === sp.group) ? (sp.group as Group) : "month";
  const include = pq.include, exclude = [...pq.exclude, ...pn.include, ...pn.exclude];
  const minCents = mins.length ? Math.max(...mins) : null, maxCents = maxs.length ? Math.min(...maxs) : null;

  return {
    q, not, include, exclude, categories, types, month, fromIso, toIso, from, to, dir, minCents, maxCents,
    minField: fMin === null ? "" : String(fMin / 100), maxField: fMax === null ? "" : String(fMax / 100),
    review, oneOff: sp.oneoff === "1", sort, group, showAll: sp.all === "1",
    active: Boolean(include.length || exclude.length || categories.length || types.length || from || to || dir || minCents !== null || maxCents !== null || review || sp.oneoff === "1"),
  };
}

export type TxnLike = { date: Date; description: string; counterparty: string | null; amountCents: number; category: string; needsReview: boolean };
// isOneOff: supplied by the caller (it needs every transaction to know which payees are regular).

export function matches(s: Search, t: TxnLike, isOneOff?: (t: TxnLike) => boolean): boolean {
  if (!s.active) return false;
  if (s.oneOff && !isOneOff?.(t)) return false;
  const abs = Math.abs(t.amountCents);
  if (s.categories.length && !s.categories.includes(t.category)) return false;
  if (s.from && t.date < s.from) return false;
  if (s.to && t.date > s.to) return false;
  if (s.dir && (s.dir === "out" ? t.amountCents >= 0 : t.amountCents <= 0)) return false;
  if (s.minCents !== null && abs < s.minCents) return false;
  if (s.maxCents !== null && abs > s.maxCents) return false;
  if (s.review && !t.needsReview) return false;
  if (s.types.length && !s.types.includes(paymentType(t.description))) return false;
  if (s.include.length || s.exclude.length) {
    const hay = `${cleanMerchant(t.description, t.counterparty)} ${t.description} ${t.counterparty ?? ""} ${t.category}`.toLowerCase();
    if (!s.include.every((w) => hay.includes(w))) return false;
    if (s.exclude.some((w) => hay.includes(w))) return false;
  }
  return true;
}

export function sortRows<T extends { date: Date; amountCents: number }>(rows: T[], sort: Sort): T[] {
  const out = [...rows];
  if (sort === "newest") out.sort((a, b) => b.date.getTime() - a.date.getTime());
  else if (sort === "largest") out.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents) || b.date.getTime() - a.date.getTime());
  else if (sort === "smallest") out.sort((a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents) || b.date.getTime() - a.date.getTime());
  else out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}

// CSV cell: quoted, and neutralised if it could be read as a spreadsheet formula (narration comes from PDFs).
export function csvCell(v: string | number): string {
  const s = String(v);
  const safe = typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
