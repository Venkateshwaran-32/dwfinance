import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { cleanMerchant, normalizeKey } from "@/server/merchants";
import { CATEGORIES } from "@/server/categorize";
import { recurringPayees, isLargeOneOff } from "@/lib/spend-trend";
import { buildSearch, matches, sortRows, GROUPS, PAY_TYPES, SORTS, type SearchParams } from "@/server/statement-search";
import { StatementFilters, type StatementFilterValues } from "@/components/statement-filters";
import { DeleteStatementButton } from "@/components/delete-statement-button";

export const dynamic = "force-dynamic";

const KEYS = ["q", "not", "category", "cats", "from", "to", "month", "dir", "min", "max", "review", "type", "sort", "group", "all", "adv", "oneoff"] as const;
const money = (cents: number) => (cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (d: Date) => d.toLocaleDateString("en-SG", { month: "long", year: "numeric", timeZone: "UTC" });
const monthName = (ym: string) => monthLabel(new Date(`${ym}-01T00:00:00Z`));
const hrefWith = (sp: SearchParams, patch: SearchParams) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
  const qs = p.toString();
  return qs ? `/dashboard/statements?${qs}` : "/dashboard/statements";
};

type Row = { id: string; date: Date; description: string; counterparty: string | null; amountCents: number; category: string; needsReview: boolean };

// Every loaded statement laid out like the bank's own, with search, filters, sorting and grouping. Every option
// lives in the URL (see src/server/statement-search.ts), so chat answers deep-link here and any view can be bookmarked.
// The original PDFs are never stored (data minimisation), so this is rebuilt from the parsed rows.
export default async function StatementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const rawSp = await searchParams;
  const sp: SearchParams = {};
  for (const k of KEYS) { const v = rawSp[k]; if (typeof v === "string" && v) sp[k] = v; }
  const s = buildSearch(sp);
  const filtered = s.active;

  const statements = await db.statement.findMany({
    where: { userId },
    select: { id: true, uploadedAt: true, issues: true, transactions: { orderBy: { date: "asc" }, select: { id: true, date: true, description: true, counterparty: true, amountCents: true, category: true, needsReview: true } } },
  });

  // Large one-offs need the whole history (a payee paid in 3+ months is regular), so build that once here.
  const recurring = s.oneOff ? recurringPayees(statements.flatMap((st) => st.transactions).map((t) => ({ date: t.date, amountCents: t.amountCents, payeeKey: normalizeKey(t.description, t.counterparty) }))) : new Set<string>();
  const isOneOff = (t: { date: Date; amountCents: number; description: string; counterparty: string | null }) => isLargeOneOff({ date: t.date, amountCents: t.amountCents, payeeKey: normalizeKey(t.description, t.counterparty) }, recurring);
  const isHit = (t: Row) => matches(s, t, isOneOff);
  const all = statements
    .filter((st) => st.transactions.length > 0)
    .map((st) => ({ ...st, start: st.transactions[0].date, hits: st.transactions.filter(isHit).length }))
    .sort((a, b) => b.start.getTime() - a.start.getTime());
  const months = [...new Set(all.flatMap((st) => st.transactions.map((t) => t.date.toISOString().slice(0, 7))))].sort().reverse();
  const allRows = all.flatMap((st) => st.transactions);
  const hitRows = allRows.filter(isHit);
  const hitOut = hitRows.reduce((sum, t) => sum + (t.amountCents < 0 ? -t.amountCents : 0), 0);
  const hitIn = hitRows.reduce((sum, t) => sum + (t.amountCents > 0 ? t.amountCents : 0), 0);
  const firstHitId = hitRows[0]?.id; // top-most highlighted row gets the #match anchor (used with all=1)

  // Month view: one section per statement. Filtering shows just the matching rows; all=1 keeps the others (dimmed).
  const sections = filtered && (!s.showAll || s.month) ? all.filter((st) => st.hits > 0) : all;
  // Payee / category / flat view: the matching rows (or everything when nothing is filtered), regrouped.
  const pool = filtered ? hitRows : allRows;
  const keyOf = (t: Row) => (s.group === "payee" ? cleanMerchant(t.description, t.counterparty) : s.group === "category" ? t.category : filtered ? "Matching transactions" : "All transactions");
  const grouped = new Map<string, Row[]>();
  if (s.group !== "month") for (const t of pool) grouped.set(keyOf(t), [...(grouped.get(keyOf(t)) ?? []), t]);
  const groups = [...grouped.entries()]
    .map(([name, rows]) => ({ name, rows: sortRows(rows, s.sort), out: rows.reduce((n, t) => n + (t.amountCents < 0 ? -t.amountCents : 0), 0), inn: rows.reduce((n, t) => n + (t.amountCents > 0 ? t.amountCents : 0), 0) }))
    .sort((a, b) => b.out + b.inn - (a.out + a.inn) || a.name.localeCompare(b.name));

  const advActive = Boolean(s.not || s.fromIso || s.toIso || sp.cats || s.types.length || s.sort !== "default" || s.group !== "month");
  const values: StatementFilterValues = {
    q: s.q, month: s.month, category: sp.category && s.categories.includes(sp.category) ? sp.category : "", dir: s.dir, min: s.minField, max: s.maxField,
    review: s.review, all: s.showAll, not: s.not, from: s.fromIso, to: s.toIso,
    cats: (sp.cats ?? "").split(",").filter((c) => s.categories.includes(c)), types: s.types, sort: s.sort, group: s.group, advOpen: advActive || sp.adv === "1", oneOff: s.oneOff,
  };

  // One removable chip per active filter.
  const chips: { label: string; href: string }[] = [];
  const chip = (label: string, patch: SearchParams) => chips.push({ label, href: hrefWith(sp, patch) });
  if (s.oneOff) chip("Large one-offs (S$300+, not regular)", { oneoff: undefined });
  if (s.q) chip(`Search: ${s.q}`, { q: undefined });
  if (s.not) chip(`Not: ${s.not}`, { not: undefined });
  if (s.month) chip(monthName(s.month), { month: undefined });
  if (s.fromIso || s.toIso) chip(`${s.fromIso || "start"} to ${s.toIso || "latest"}`, { from: undefined, to: undefined });
  if (values.category) chip(values.category, { category: undefined });
  for (const c of values.cats) chip(c, { cats: values.cats.filter((x) => x !== c).join(",") || undefined });
  if (s.dir) chip(s.dir === "in" ? "Money in" : "Money out", { dir: undefined });
  if (s.minField || s.maxField) chip(`S$${s.minField || "0"} to ${s.maxField ? `S$${s.maxField}` : "any"}`, { min: undefined, max: undefined });
  for (const ty of s.types) chip(PAY_TYPES.find(([k]) => k === ty)![1], { type: s.types.filter((x) => x !== ty).join(",") || undefined });
  if (s.review) chip("Needs review", { review: undefined });

  const preset = (label: string, p: SearchParams) => ({ label, href: hrefWith({}, { ...p, adv: "1" }) });
  const presets = [
    preset("PayNow to people", { type: "paynow", dir: "out", group: "payee" }),
    preset("Large payments (S$100+)", { q: ">=100", dir: "out", sort: "largest", group: "none" }),
    preset("Large one-offs (S$300+)", { oneoff: "1", sort: "largest", group: "none" }),
    preset("Needs review, by payee", { review: "1", group: "payee" }),
    preset("Subscriptions", { category: "Subscriptions", group: "payee" }),
    preset("Income", { dir: "in" }),
    ...(months[0] ? [preset(`${monthName(months[0])}, biggest first`, { month: months[0], sort: "largest" })] : []),
  ];
  const exportHref = `/api/statements/export${hrefWith(sp, { adv: undefined, all: undefined, group: undefined }).replace("/dashboard/statements", "")}`;
  // Clicking a payee or category in the table narrows the current view to it.
  const payeeHref = (payee: string) => hrefWith(sp, { q: `"${payee.replace(/"/g, "")}"` });

  const table = (rows: Row[], dimOthers: boolean) => (
    <div className="stmt-scroll">
      <table className="stmt-table">
        <thead>
          <tr><th>Date</th><th>Description</th><th className="num">Withdrawal (-)</th><th className="num">Deposit (+)</th><th>Category</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const payee = cleanMerchant(t.description, t.counterparty);
            return (
              <tr key={t.id} id={dimOthers && t.id === firstHitId ? "match" : undefined} className={!dimOthers ? undefined : isHit(t) ? "stmt-hit" : filtered ? "stmt-dim" : undefined}>
                <td className="mono">{t.date.toISOString().slice(0, 10)}</td>
                <td>
                  <Link className="stmt-payee" href={payeeHref(payee)} title={`Show all payments to ${payee}`}>{payee}</Link>
                  <div className="stmt-narr">{t.description}</div>
                </td>
                <td className="num amount out">{t.amountCents < 0 ? money(-t.amountCents) : ""}</td>
                <td className="num amount in">{t.amountCents > 0 ? money(t.amountCents) : ""}</td>
                <td className="stmt-cat">
                  <Link href={hrefWith(sp, { category: t.category })} title={`Show only ${t.category}`}>{t.category}</Link>
                  {t.needsReview ? <span className="stmt-flag">review</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div>
        <h1 style={{ margin: 0 }}>Bank statements</h1>
        <p style={{ color: "var(--text-dim)", margin: "4px 0 0" }}>
          {all.length} statement{all.length === 1 ? "" : "s"}, {allRows.length} transactions. Rebuilt from your uploads; the original PDFs are not kept.
        </p>
      </div>

      {all.length > 0 && (
        <StatementFilters key={JSON.stringify(values)} values={values} months={months} categories={CATEGORIES} payTypes={PAY_TYPES} sorts={SORTS} groups={GROUPS} presets={presets} />
      )}

      {chips.length > 0 && (
        <ul className="stmt-chips" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.label}><Link className="stmt-chip" href={c.href} aria-label={`Remove filter: ${c.label}`}><span>{c.label}</span><span className="stmt-chip-x" aria-hidden="true" /></Link></li>
          ))}
          <li><Link className="stmt-chip-clear" href="/dashboard/statements">Clear all</Link></li>
        </ul>
      )}

      {filtered && (
        <div className="card stmt-summary" role="status" aria-live="polite">
          <div><span>Matching</span><strong>{hitRows.length}</strong></div>
          <div><span>Money out</span><strong className={hitOut ? "neg" : undefined}>S${money(hitOut)}</strong></div>
          <div><span>Money in</span><strong className={hitIn ? "pos" : undefined}>S${money(hitIn)}</strong></div>
          <div><span>Net</span><strong className={hitIn - hitOut >= 0 ? "pos" : "neg"}>{hitIn - hitOut < 0 ? "-" : ""}S${money(Math.abs(hitIn - hitOut))}</strong></div>
        </div>
      )}

      {all.length > 0 && pool.length > 0 && (
        <div className="stmt-tools">
          <a className="btn ghost" href={exportHref} download>Export {filtered ? `${hitRows.length} matching` : "all"} as CSV</a>
        </div>
      )}

      {all.length === 0 && (
        <div className="card" style={{ padding: 20 }}>
          No statements yet. <Link href="/dashboard/upload">Upload one</Link>.
        </div>
      )}
      {filtered && hitRows.length === 0 && all.length > 0 && (
        <div className="card" style={{ padding: 20 }}>No transactions match these filters. <Link href="/dashboard/statements">Clear filters</Link></div>
      )}

      {s.group === "month" && sections.map((st, i) => {
        const rows = sortRows(filtered && !s.showAll ? st.transactions.filter(isHit) : st.transactions, s.sort);
        return (
          <details key={st.id} className="card stmt" open={filtered ? st.hits > 0 : i === 0}>
            <summary>
              <span className="stmt-title">{monthLabel(st.start)}</span>
              <span className="stmt-meta">
                {st.issues && <span className="stmt-flag">Needs checking</span>}
                {st.transactions.length} transactions{st.hits ? <> · <strong>{st.hits} matching</strong></> : null}
              </span>
            </summary>
            <div className="stmt-head">
              <span>Uploaded {st.uploadedAt.toISOString().slice(0, 10)} · {st.transactions.length} transactions</span>
              <DeleteStatementButton statementId={st.id} label={monthLabel(st.start)} count={st.transactions.length} />
            </div>
            {st.issues && (
              <div className="stmt-issues" role="note">
                <strong>This statement did not pass every check.</strong> The lines below were saved; doubtful ones are marked for review.
                <ul>{st.issues.split("\n").map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            {table(rows, s.showAll)}
          </details>
        );
      })}

      {s.group !== "month" && groups.map((g, i) => (
        <details key={g.name} className="card stmt" open={groups.length <= 3 || i < 3}>
          <summary>
            <span className="stmt-title">{g.name}</span>
            <span className="stmt-meta">
              {g.rows.length} transaction{g.rows.length === 1 ? "" : "s"}
              {g.out ? <> · <span className="neg">S${money(g.out)} out</span></> : null}
              {g.inn ? <> · <span className="pos">S${money(g.inn)} in</span></> : null}
            </span>
          </summary>
          {table(g.rows, false)}
        </details>
      ))}
    </div>
  );
}
