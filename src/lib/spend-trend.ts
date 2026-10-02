// Monthly spending, split into everyday spending and large one-off purchases, with a "usual month" reference
// taken from the 12 months before each month. Pure: used by the dashboard, the Statements filter and tests.

export const LARGE_ONE_OFF_CENTS = 30_000; // S$300
const REGULAR_MIN = 3;                     // a large charge that comes back 3+ times...
const REGULAR_SPREAD = 0.2;                // ...at about the same amount (within 20% of its median) is a regular bill
const HISTORY = 12;                        // the "usual month" looks back this many months
const MIN_HISTORY = 6;                     // fewer months than this and there is no usual month yet

export type TrendTxn = { id?: string; date: Date; amountCents: number; payeeKey: string; label?: string };

// Payees whose large charges are regular bills (rent, hall fees): they come back REGULAR_MIN+ times at about the
// same amount. A travel site booked three times at S$310, S$520 and S$740 is not a bill; each trip is a one-off.
export function recurringPayees(txns: TrendTxn[]): Set<string> {
  const large = new Map<string, number[]>();
  for (const t of txns) {
    if (t.amountCents > -LARGE_ONE_OFF_CENTS) continue;
    const a = large.get(t.payeeKey) ?? []; a.push(-t.amountCents); large.set(t.payeeKey, a);
  }
  const regular = [...large].filter(([, amts]) => {
    if (amts.length < REGULAR_MIN) return false;
    const med = quantile([...amts].sort((a, b) => a - b), 0.5);
    return amts.every((a) => Math.abs(a - med) <= med * REGULAR_SPREAD);
  });
  return new Set(regular.map(([k]) => k));
}

// A single payment of S$300 or more to a payee that is not paid regularly (a laptop, a flight, a phone).
export function isLargeOneOff(t: TrendTxn, recurring: Set<string>): boolean {
  return t.amountCents <= -LARGE_ONE_OFF_CENTS && !recurring.has(t.payeeKey);
}

// Linear-interpolated quantile of a sorted list.
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
}

// low/high = middle half of the months before (interquartile range); unusual = Tukey's upper fence, high + 1.5 x (high - low)
export type Usual = { median: number; low: number; high: number; unusual: number };
export type TrendMonth = {
  ym: string; everyday: number; oneOff: number; oneOffCount: number; biggestOneOff: { label: string; cents: number } | null;
  usualEveryday: Usual | null; usualTotal: Usual | null;
};

// One entry per month in `months` (sorted "YYYY-MM"), including months with no spending.
export function buildSpendTrend(txns: TrendTxn[], months: string[]): TrendMonth[] {
  const recurring = recurringPayees(txns);
  const acc = new Map(months.map((ym) => [ym, { everyday: 0, oneOff: 0, oneOffCount: 0, biggestOneOff: null as TrendMonth["biggestOneOff"] }]));
  for (const t of txns) {
    if (t.amountCents >= 0) continue;
    const m = acc.get(t.date.toISOString().slice(0, 7)); if (!m) continue;
    if (isLargeOneOff(t, recurring)) {
      m.oneOff += -t.amountCents; m.oneOffCount++;
      if (!m.biggestOneOff || -t.amountCents > m.biggestOneOff.cents) m.biggestOneOff = { label: t.label ?? t.payeeKey, cents: -t.amountCents };
    } else m.everyday += -t.amountCents;
  }
  const rows = months.map((ym) => ({ ym, ...acc.get(ym)! }));
  const usual = (vals: number[]): Usual | null => {
    if (vals.length < MIN_HISTORY) return null;
    const s = [...vals].sort((a, b) => a - b);
    const low = quantile(s, 0.25), high = quantile(s, 0.75);
    return { median: quantile(s, 0.5), low, high, unusual: Math.round(high + 1.5 * (high - low)) };
  };
  return rows.map((r, i) => {
    const prev = rows.slice(Math.max(0, i - HISTORY), i);
    return { ...r, usualEveryday: usual(prev.map((p) => p.everyday)), usualTotal: usual(prev.map((p) => p.everyday + p.oneOff)) };
  });
}
