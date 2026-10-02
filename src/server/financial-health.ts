import 'server-only';

import { formatCents } from '@/lib/money';
import { cleanMerchant, isPayNowToPerson } from '@/server/merchants';
import { computeSubscriptions } from '@/server/subscriptions';
import type { Transaction } from '@prisma/client';

export type HealthSummary = {
  score: number;
  grade: string;
  savingsRatePct: number;
  prevSavingsRatePct: number | null;
  drivers: { label: string; points: number }[];
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

export function computeHealth(txns: Transaction[]): HealthSummary {
  const months = [...new Set(txns.map((txn) => monthKey(txn.date)))].sort();
  const latestMonth = months.at(-1);

  if (!latestMonth) {
    return summarizeNoData();
  }

  const previousMonth = previousCalendarMonth(latestMonth);
  const latestTxns = txns.filter((txn) => monthKey(txn.date) === latestMonth);
  const previousTxns = txns.filter((txn) => monthKey(txn.date) === previousMonth);
  const latestTotals = monthTotals(latestTxns);
  const previousTotals = monthTotals(previousTxns);
  const savingsRatePct = savingsRate(latestTotals);
  const subscriptionSummary = computeSubscriptions(txns);
  const recurringCents = Math.max(
    activeRecurringMonthlyCents(subscriptionSummary.items, latestMonth),
    subscriptionCategorySpend(latestTxns),
  );
  const recurringMerchantKeys = new Set(subscriptionSummary.items.map((item) => normalizeText(item.name)));
  const anomalyCount = countBigAnomalies(txns, latestMonth, recurringMerchantKeys);

  const drivers: Driver[] = [
    savingsDriver(savingsRatePct, latestTotals.incomeCents),
    reviewDriver(latestTotals.needsReviewCount, latestTotals.transactionCount),
    recurringDriver(recurringCents, latestTotals.incomeCents),
    anomalyDriver(anomalyCount),
  ];
  const score = clampScore(BASE_SCORE + drivers.reduce((sum, driver) => sum + driver.points, 0));

  return {
    score,
    grade: gradeFor(score),
    savingsRatePct,
    prevSavingsRatePct: previousTxns.length > 0 ? savingsRate(previousTotals) : null,
    drivers: topDrivers(drivers),
  };
}

function summarizeNoData(): HealthSummary {
  const drivers: Driver[] = [
    { label: 'No transaction data yet', points: -45, rank: 0 },
    { label: 'No income recorded this month', points: -35, rank: 1 },
    { label: 'Review status unknown', points: 0, rank: 2 },
  ];
  const score = clampScore(BASE_SCORE + drivers.reduce((sum, driver) => sum + driver.points, 0));

  return {
    score,
    grade: gradeFor(score),
    savingsRatePct: 0,
    prevSavingsRatePct: null,
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
    return { label: 'No income recorded this month', points: -35, rank: 0 };
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
  if (transactionCount === 0) return { label: 'No current-month transactions', points: -4, rank: 1 };
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

function anomalyDriver(anomalyCount: number): Driver {
  if (anomalyCount === 0) return { label: 'No big anomalies', points: 5, rank: 3 };
  const points = anomalyCount === 1 ? -5 : anomalyCount === 2 ? -10 : -16;
  return { label: `${anomalyCount} big ${anomalyCount === 1 ? 'anomaly' : 'anomalies'}`, points, rank: 3 };
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

function countBigAnomalies(txns: Transaction[], latestMonth: string, recurringMerchantKeys: Set<string>): number {
  const spends = txns
    .filter((txn) => txn.amountCents < 0)
    .map((txn) => {
      const merchant = cleanMerchant(txn.description, txn.counterparty);
      return {
        txn,
        month: monthKey(txn.date),
        absCents: -txn.amountCents,
        category: txn.category.trim() || 'Uncategorized',
        merchantKey: normalizeText(merchant),
        personLike: isPayNowToPerson(txn.description, txn.counterparty),
      };
    });

  const priorSpends = spends.filter((row) => row.month < latestMonth);
  const priorByMerchant = groupAmounts(priorSpends, (row) => row.merchantKey);
  const priorByCategory = groupAmounts(priorSpends, (row) => row.category);
  const globalMedian = median(priorSpends.map((row) => row.absCents));

  return spends.filter((row) => {
    if (row.month !== latestMonth) return false;
    if (row.merchantKey && recurringMerchantKeys.has(row.merchantKey)) return false;
    if (isSubscriptionCategory(row.txn)) return false;

    const merchantMedian = median(priorByMerchant.get(row.merchantKey) ?? []);
    const categoryMedian = median(priorByCategory.get(row.category) ?? []);
    const baseline = merchantMedian || categoryMedian || globalMedian;
    const multiplier = row.personLike ? 3.5 : 2.5;
    const dynamicThreshold = baseline > 0 ? baseline * multiplier : BIG_SPEND_CENTS;
    const threshold = Math.max(BIG_SPEND_CENTS, dynamicThreshold);

    return row.absCents >= threshold || row.absCents >= VERY_BIG_SPEND_CENTS;
  }).length;
}

function groupAmounts<T extends { absCents: number }>(items: T[], keyOf: (item: T) => string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item.absCents);
    else groups.set(key, [item.absCents]);
  }
  return groups;
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
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  return monthKey(new Date(Date.UTC(year, monthNumber - 2, 1)));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}
