import { cleanMerchant, normalizeKey } from "@/server/merchants";

// Review queue grouped by payee: one decision per payee instead of one per transaction.
// Group key = normalizeKey, the same key applyPayeeRule matches on, so "Confirm" covers exactly this group.

export type ReviewItem = {
  id: string; date: Date; description: string; counterparty: string | null; amountCents: number; category: string;
};

export type ReviewGroup = {
  matchKey: string;
  payee: string;
  count: number;
  category: string;          // most common current guess in the group
  lowCents: number;          // typical range of absolute amounts (p10..p90 once there are 10+ payments, else min..max)
  highCents: number;
  flow: "out" | "in" | "mixed";
  firstDate: Date;
  lastDate: Date;
  recent: ReviewItem[];      // newest first, at most RECENT_LIMIT
};

export const RECENT_LIMIT = 5;
const PERCENTILE_MIN = 10;

// Nearest-rank percentile on a sorted ascending array.
function pick(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  let best = values[0] ?? "Other";
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) { best = v; bestN = n; } // first to reach the top count wins ties: stable
  }
  return best;
}

export function groupReviewItems(items: ReviewItem[]): ReviewGroup[] {
  const buckets = new Map<string, ReviewItem[]>();
  for (const it of items) {
    const key = normalizeKey(it.description, it.counterparty);
    const b = buckets.get(key);
    if (b) b.push(it);
    else buckets.set(key, [it]);
  }
  const groups: ReviewGroup[] = [];
  for (const [matchKey, rows] of buckets) {
    const byDate = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
    const amounts = rows.map((r) => Math.abs(r.amountCents)).sort((a, b) => a - b);
    const usePct = amounts.length >= PERCENTILE_MIN;
    const ins = rows.filter((r) => r.amountCents > 0).length;
    groups.push({
      matchKey,
      payee: cleanMerchant(byDate[0].description, byDate[0].counterparty),
      count: rows.length,
      category: mostCommon(byDate.map((r) => r.category)),
      lowCents: usePct ? pick(amounts, 0.1) : amounts[0],
      highCents: usePct ? pick(amounts, 0.9) : amounts[amounts.length - 1],
      flow: ins === 0 ? "out" : ins === rows.length ? "in" : "mixed",
      firstDate: byDate[byDate.length - 1].date,
      lastDate: byDate[0].date,
      recent: byDate.slice(0, RECENT_LIMIT),
    });
  }
  return groups.sort((a, b) => b.count - a.count || a.payee.localeCompare(b.payee) || a.matchKey.localeCompare(b.matchKey));
}

// "?show=" -> how many groups to render: steps of 50, at least 50, never more than needed.
export const PAGE_SIZE = 50;
export function parseShow(raw: string | string[] | undefined, total: number): number {
  const n = Number.parseInt(Array.isArray(raw) ? raw[0] ?? "" : raw ?? "", 10);
  const want = Number.isFinite(n) && n > PAGE_SIZE ? Math.ceil(n / PAGE_SIZE) * PAGE_SIZE : PAGE_SIZE;
  return Math.min(want, Math.max(PAGE_SIZE, Math.ceil(total / PAGE_SIZE) * PAGE_SIZE));
}
