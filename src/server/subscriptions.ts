import "server-only";

import type { Transaction } from "@prisma/client";
import { cleanMerchant, isPayNowToPerson } from "@/server/merchants";

export type Sub = {
  name: string;
  amountCents: number;
  cadence: string;
  nextDate: string | null;
  lastDate: string;
  count: number;
  priceChange?: { fromCents: number; toCents: number };
};

export type SubscriptionSummary = {
  totalMonthlyCents: number;
  items: Sub[];
};

type Charge = { date: string; cents: number };
type Candidate = Sub & { avgGapDays: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AVG_MONTH_DAYS = 365.25 / 12;
const WEEKLY_MONTH_MULTIPLIER = 4.33;

export function computeSubscriptions(txns: Transaction[]): SubscriptionSummary {
  const groups = new Map<string, Charge[]>();

  for (const txn of txns) {
    if (txn.amountCents >= 0) continue;
    if (isPayNowToPerson(txn.description, txn.counterparty)) continue;

    const name = cleanMerchant(txn.description, txn.counterparty).trim();
    if (!name) continue;

    const charges = groups.get(name) ?? [];
    charges.push({ date: dateKey(txn.date), cents: -txn.amountCents });
    groups.set(name, charges);
  }

  // "Now" is the newest transaction in the data, so an old subscription that stopped being charged can be told apart.
  const latestDay = txns.reduce((max, t) => (dateKey(t.date) > max ? dateKey(t.date) : max), "");

  const items: Candidate[] = [];
  for (const [name, rawCharges] of groups) {
    const charges = compactDailyCharges(rawCharges);
    if (charges.length < 3) continue;

    const avgGapDays = recurringGap(charges);
    if (avgGapDays === null) continue;

    // A subscription's price is flat, with at most a few step changes over the years. Split the history into
    // price "runs"; every finished run must have held for 2+ charges. A final run of one charge is a fresh price change.
    const amounts = charges.map((charge) => charge.cents);
    const runs = priceRuns(amounts);
    const current = runs[runs.length - 1];
    const earlier = runs.slice(0, -1);
    if (!current || runs.length > 4 || earlier.some((run) => run.length < 2)) continue;
    const previous = earlier[earlier.length - 1];
    const fresh = current.length < 2;
    if (fresh && !previous) continue;
    // Always show (and total) the CURRENT price: after a fresh change that is the latest charge itself.
    const amountCents = fresh ? current[0]! : medianCents(current);
    const priceChange = fresh ? { fromCents: medianCents(previous!), toCents: current[0]! } : undefined;

    const lastCharge = charges[charges.length - 1];
    if (!lastCharge) continue;
    // Cancelled or lapsed: nothing charged for well over two billing periods before the end of the data.
    if (daysBetween(lastCharge.date, latestDay) > avgGapDays * 2.5) continue;

    items.push({
      name,
      amountCents,
      cadence: cadenceLabel(avgGapDays),
      nextDate: addDays(lastCharge.date, avgGapDays),
      lastDate: lastCharge.date,
      count: charges.length,
      ...(priceChange ? { priceChange } : {}),
      avgGapDays,
    });
  }

  items.sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name));

  return {
    totalMonthlyCents: items.reduce((sum, item) => sum + monthlyCents(item.amountCents, item.avgGapDays), 0),
    items: items.map(({ avgGapDays, ...item }) => { void avgGapDays; return item; }),
  };
}

function compactDailyCharges(charges: Charge[]): Charge[] {
  const byDate = new Map<string, number>();
  for (const charge of charges) {
    byDate.set(charge.date, (byDate.get(charge.date) ?? 0) + charge.cents);
  }

  return [...byDate.entries()]
    .map(([date, cents]) => ({ date, cents }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function recurringGap(charges: Charge[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < charges.length; i++) {
    const prev = charges[i - 1];
    const curr = charges[i];
    if (!prev || !curr) continue;

    const gap = daysBetween(prev.date, curr.date);
    if (gap > 0) gaps.push(gap);
  }

  if (gaps.length < 2) return null;

  const avgGap = average(gaps);
  if (!Number.isFinite(avgGap) || avgGap < 5 || avgGap > 370) return null;

  const medianGap = medianNumber(gaps);
  const tolerance = Math.max(4, medianGap * 0.35);
  const closeGaps = gaps.filter((gap) => Math.abs(gap - medianGap) <= tolerance).length;
  const requiredCloseGaps = gaps.length <= 2 ? gaps.length : Math.ceil(gaps.length * 0.75);

  return closeGaps >= requiredCloseGaps ? avgGap : null;
}

function priceRuns(amounts: number[]): number[][] {
  const runs: number[][] = [];
  for (const amount of amounts) {
    const run = runs[runs.length - 1];
    if (run && Math.abs(amount - run[0]!) <= amountTolerance(run[0]!)) run.push(amount);
    else runs.push([amount]);
  }
  return runs;
}

function amountTolerance(cents: number): number {
  return Math.max(200, cents * 0.08);
}

function cadenceLabel(avgGapDays: number): string {
  if (Math.abs(avgGapDays - 7) <= 2) return "weekly";
  if (Math.abs(avgGapDays - AVG_MONTH_DAYS) <= 6) return "monthly";
  return `~${Math.round(avgGapDays)}d`;
}

function monthlyCents(amountCents: number, avgGapDays: number): number {
  if (avgGapDays <= 0) return 0;
  if (Math.abs(avgGapDays - 7) <= 2) return Math.round(amountCents * WEEKLY_MONTH_MULTIPLIER);
  if (Math.abs(avgGapDays - AVG_MONTH_DAYS) <= 6) return amountCents;
  return Math.round(amountCents * (30 / avgGapDays));
}

function medianCents(values: number[]): number {
  return Math.round(medianNumber(values));
}

function medianNumber(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted[mid];
  if (value === undefined) return 0;
  if (sorted.length % 2 === 1) return value;

  const prev = sorted[mid - 1];
  return prev === undefined ? value : (prev + value) / 2;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((utcDay(toDate) - utcDay(fromDate)) / MS_PER_DAY);
}

function addDays(date: string, days: number): string {
  const next = new Date(utcDay(date));
  next.setUTCDate(next.getUTCDate() + Math.round(days));
  return dateKey(next);
}

function utcDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return 0;
  return Date.UTC(year, month - 1, day);
}
