import 'server-only';

import { formatCents } from '@/lib/money';
import { cleanMerchant, isPayNowToPerson } from '@/server/merchants';
import { computeSubscriptions } from '@/server/subscriptions';
import type { Transaction } from '@prisma/client';

export type HealthSummary = {
  score: number;
  grade: string;
  months: number;                  // calendar months in the scored period
  savingsRatePct: number;          // over the whole period
  prevSavingsRatePct: number | null;
  prevLabel: string | null;        // the same-length period just before, e.g. "Nov 2070" or "Jan 2069 to Dec 2069"
  drivers: { label: string; points: number }[];
};

export type HealthOptions = {
  // Every transaction, so the period can be compared with the same-length period before it and big spends can be
  // judged against history from before the period. Defaults to `txns`.
  allTxns?: Transaction[];
  // The chosen period ("YYYY-MM"). Defaults to the first and last month present in `txns`.
  from?: string;
  to?: string;
};

type MonthTotals = {
  incomeCents: number;
  spendCents: number;
  transactionCount: number;
  needsReviewCount: number;
};

type Driver = { label: string; points: number; rank: number };

const BASE_SCORE = 45;
const BIG_SPEND_CENTS = 50_000;
const VERY_BIG_SPEND_CENTS = 150_000;
const WEEKLY_MONTH_MULTIPLIER = 4.33;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Scores the period the dashboard is showing (the `txns` passed in), not just its last month: over a long period
// the savings rate, recurring load and big-spend rate are the period's overall figures and monthly averages.
export function computeHealth(txns: Transaction[], options: HealthOptions = {}): HealthSummary {
  const months = [...new Set(txns.map((txn) => monthKey(txn.date)))].sort();
  const from = options.from ?? months[0];
  const to = options.to ?? months.at(-1);

  if (!from || !to || txns.length === 0) {
    return summarizeNoData();
  }

  const allTxns = options.allTxns ?? txns;
  const monthCount = monthsBetween(from, to) + 1;
  const totals = monthTotals(txns);
  const savingsRatePct = savingsRate(totals);
  const avgIncomeCents = Math.round(totals.incomeCents / monthCount);

  // Same-length period just before this one, only when the data fully covers it (none for "All time").
  const prevFrom = addMonths(from, -monthCount);
  const prevTo = addMonths(from, -1);
  const firstDataMonth = allTxns.reduce((min, txn) => (monthKey(txn.date) < min ? monthKey(txn.date) : min), '9999-12');
  const prevTxns = prevFrom >= firstDataMonth
    ? allTxns.filter((txn) => { const ym = monthKey(txn.date); return ym >= prevFrom && ym <= prevTo; })
    : [];
  const prevTotals = monthTotals(prevTxns);
  const hasPrev = prevTotals.incomeCents > 0 || prevTotals.spendCents > 0;

  const subscriptionSummary = computeSubscriptions(txns);
  const recurringCents = Math.max(
    activeRecurringMonthlyCents(subscriptionSummary.items, to),
    Math.round(subscriptionCategorySpend(txns) / monthCount),
  );
  const recurringMerchantKeys = new Set(subscriptionSummary.items.map((item) => normalizeText(item.name)));
  const anomalyCount = countBigAnomalies(txns, allTxns, recurringMerchantKeys);

  const drivers: Driver[] = [
    savingsDriver(savingsRatePct, totals.incomeCents),
    reviewDriver(totals.needsReviewCount, totals.transactionCount),
    recurringDriver(recurringCents, avgIncomeCents),
    anomalyDriver(anomalyCount, monthCount),
  ];
  const score = clampScore(BASE_SCORE + drivers.reduce((sum, driver) => sum + driver.points, 0));

  return {
    score,
    grade: gradeFor(score),
    months: monthCount,
    savingsRatePct,
    prevSavingsRatePct: hasPrev ? savingsRate(prevTotals) : null,
    prevLabel: hasPrev ? periodLabel(prevFrom, prevTo) : null,
    drivers: topDrivers(drivers),
  };
}

export function periodLabel(from: string, to: string): string {
  return from === to ? ymLabel(from) : `${ymLabel(from)} to ${ymLabel(to)}`;
}

function summarizeNoData(): HealthSummary {
  const drivers: Driver[] = [
    { label: 'No transaction data yet', points: -45, rank: 0 },
    { label: 'No income recorded in this period', points: -35, rank: 1 },
    { label: 'Review status unknown', points: 0, rank: 2 },
  ];
  const score = clampScore(BASE_SCORE + drivers.reduce((sum, driver) => sum + driver.points, 0));

  return {
    score,
    grade: gradeFor(score),
    months: 0,
    savingsRatePct: 0,
    prevSavingsRatePct: null,
    prevLabel: null,
    drivers: topDrivers(drivers),
  };
}

function monthTotals(txns: Transaction[]): MonthTotals {
  return txns.reduce<MonthTotals>(
    (totals, txn) => {
      if (txn.amountCents > 0) totals.incomeCents += txn.amountCents;
      if (txn.amountCents < 0) totals.spendCents += -txn.amountCents;
      if (txn.needsReview) totals.needsReviewCount += 1;
      totals.transactionCount += 1;
      return totals;
    },
    { incomeCents: 0, spendCents: 0, transactionCount: 0, needsReviewCount: 0 },
  );
}

function savingsRate(totals: Pick<MonthTotals, 'incomeCents' | 'spendCents'>): number {
  if (totals.incomeCents <= 0) return 0;
  return Math.round(((totals.incomeCents - totals.spendCents) / totals.incomeCents) * 100);
}

function savingsDriver(savingsRatePct: number, incomeCents: number): Driver {
  if (incomeCents <= 0) {
    return { label: 'No income recorded in this period', points: -35, rank: 0 };
  }

  let points = 0;
  if (savingsRatePct >= 40) points = 34;
  else if (savingsRatePct >= 25) points = 26;
  else if (savingsRatePct >= 15) points = 18;
  else if (savingsRatePct >= 5) points = 8;
  else if (savingsRatePct < 0) points = Math.max(-38, Math.round(savingsRatePct * 0.75));

  return { label: `Savings rate ${formatPct(savingsRatePct)}`, points, rank: 0 };
}

function reviewDriver(needsReviewCount: number, transactionCount: number): Driver {
  if (transactionCount === 0) return { label: 'No transactions in this period', points: -4, rank: 1 };
  if (needsReviewCount === 0) return { label: 'Review queue clear', points: 6, rank: 1 };

  const ratio = needsReviewCount / transactionCount;
  let points = -14;
  if (ratio <= 0.05) points = 3;
  else if (ratio <= 0.15) points = -4;
  else if (ratio <= 0.3) points = -9;

  return { label: `${Math.round(ratio * 100)}% of rows need review`, points, rank: 1 };
}

function recurringDriver(recurringCents: number, incomeCents: number): Driver {
  if (recurringCents <= 0) return { label: 'No recurring commitments detected', points: 5, rank: 2 };
  if (incomeCents <= 0) {
    return { label: `Recurring commitments ${formatCents(recurringCents)}/mo without income`, points: -16, rank: 2 };
  }

  const sharePct = Math.round((recurringCents / incomeCents) * 100);
  let points = -18;
  if (sharePct <= 5) points = 6;
  else if (sharePct <= 10) points = 3;
  else if (sharePct <= 20) points = -4;
  else if (sharePct <= 35) points = -10;

  return {
    label: `Recurring commitments ${formatCents(recurringCents)}/mo (${sharePct}% of income)`,
    points,
    rank: 2,
  };
}

// Scaled to the period: one big surprise in a month costs 5 points, one in a year costs much less.
function anomalyDriver(anomalyCount: number, monthCount: number): Driver {
  if (anomalyCount === 0) return { label: 'No big anomalies', points: 5, rank: 3 };
  const perMonth = anomalyCount / Math.max(1, monthCount);
  const points = perMonth >= 2.5 ? -16 : -Math.max(1, Math.round(perMonth * 5));
  const noun = anomalyCount === 1 ? 'big anomaly' : 'big anomalies';
  const label = monthCount <= 1 ? `${anomalyCount} ${noun}` : `${anomalyCount} ${noun} in ${monthCount} months`;
  return { label, points, rank: 3 };
}

function activeRecurringMonthlyCents(
  items: ReturnType<typeof computeSubscriptions>['items'],
  latestMonth: string,
): number {
  return items
    .filter((item) => isActiveRecurring(item.lastDate, item.nextDate, latestMonth))
    .reduce((sum, item) => sum + monthlyCentsForCadence(item.amountCents, item.cadence), 0);
}

function isActiveRecurring(lastDate: string, nextDate: string | null, latestMonth: string): boolean {
  const priorMonth = previousCalendarMonth(latestMonth);
  return lastDate.slice(0, 7) >= priorMonth || (nextDate !== null && nextDate.slice(0, 7) >= latestMonth);
}

function monthlyCentsForCadence(amountCents: number, cadence: string): number {
  if (cadence === 'weekly') return Math.round(amountCents * WEEKLY_MONTH_MULTIPLIER);
  if (cadence === 'monthly') return amountCents;

  const dayMatch = /^~(\d+)d$/.exec(cadence);
  const days = dayMatch ? Number(dayMatch[1]) : 0;
  return days > 0 ? Math.round(amountCents * (30 / days)) : amountCents;
}

function subscriptionCategorySpend(txns: Transaction[]): number {
  return txns
    .filter((txn) => txn.amountCents < 0 && isSubscriptionCategory(txn))
    .reduce((sum, txn) => sum + -txn.amountCents, 0);
}

function isSubscriptionCategory(txn: Transaction): boolean {
  const category = `${txn.category} ${txn.subcategory ?? ''}`.toLowerCase();
  return category.includes('subscription') || category.includes('recurring') || category.includes('commitment');
}

// Big spends in the period, each judged against what came before its month (history from allTxns, so the first
// month of a chosen period still has a baseline).
function countBigAnomalies(txns: Transaction[], allTxns: Transaction[], recurringMerchantKeys: Set<string>): number {
  const toRow = (txn: Transaction) => ({
    txn,
    month: monthKey(txn.date),
    absCents: -txn.amountCents,
    category: txn.category.trim() || 'Uncategorized',
    merchantKey: normalizeText(cleanMerchant(txn.description, txn.counterparty)),
    personLike: isPayNowToPerson(txn.description, txn.counterparty),
  });
  type Row = ReturnType<typeof toRow>;
  const history = allTxns.filter((txn) => txn.amountCents < 0).map(toRow).sort((a, b) => a.month.localeCompare(b.month));
  const candidates = txns
    .filter((txn) => txn.amountCents < 0)
    .map(toRow)
    .filter((row) => !(row.merchantKey && recurringMerchantKeys.has(row.merchantKey)) && !isSubscriptionCategory(row.txn))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Walk the months in order, growing the "before this month" history as we go.
  const priorByMerchant = new Map<string, number[]>();
  const priorByCategory = new Map<string, number[]>();
  const priorAll: number[] = [];
  const medianCache = new Map<string, number>();
  const cachedMedian = (key: string, values: number[] | undefined) => {
    if (!values || values.length === 0) return 0;
    const cacheKey = `${key}\0${values.length}`;
    let value = medianCache.get(cacheKey);
    if (value === undefined) { value = median(values); medianCache.set(cacheKey, value); }
    return value;
  };
  let h = 0;
  let count = 0;
  for (const row of candidates) {
    while (h < history.length && history[h]!.month < row.month) {
      const prior: Row = history[h++]!;
      push(priorByMerchant, prior.merchantKey, prior.absCents);
      push(priorByCategory, prior.category, prior.absCents);
      priorAll.push(prior.absCents);
    }
    const merchantMedian = cachedMedian(`m:${row.merchantKey}`, priorByMerchant.get(row.merchantKey));
    const categoryMedian = cachedMedian(`c:${row.category}`, priorByCategory.get(row.category));
    const globalMedian = cachedMedian('all', priorAll);
    const baseline = merchantMedian || categoryMedian || globalMedian;
    const multiplier = row.personLike ? 3.5 : 2.5;
    const dynamicThreshold = baseline > 0 ? baseline * multiplier : BIG_SPEND_CENTS;
    const threshold = Math.max(BIG_SPEND_CENTS, dynamicThreshold);
    if (row.absCents >= threshold || row.absCents >= VERY_BIG_SPEND_CENTS) count += 1;
  }
  return count;
}

function push(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function topDrivers(drivers: Driver[]): HealthSummary['drivers'] {
  return [...drivers]
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || a.rank - b.rank || a.label.localeCompare(b.label))
    .slice(0, 5)
    .map(({ label, points }) => ({ label, points }));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function gradeFor(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Good';
  if (score >= 50) return 'Fair';
  return 'Needs work';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function previousCalendarMonth(month: string): string {
  return addMonths(month, -1);
}

function addMonths(month: string, delta: number): string {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  return monthKey(new Date(Date.UTC(year, monthNumber - 1 + delta, 1)));
}

function monthsBetween(from: string, to: string): number {
  const [fy = 0, fm = 1] = from.split('-').map(Number);
  const [ty = 0, tm = 1] = to.split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

function ymLabel(ym: string): string {
  return `${MON[Number(ym.slice(5, 7)) - 1] ?? ''} ${ym.slice(0, 4)}`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}
