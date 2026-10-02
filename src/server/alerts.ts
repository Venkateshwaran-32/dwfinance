import 'server-only';

import type { Transaction } from "@prisma/client";
import { cleanMerchant, isPayNowToPerson } from "@/server/merchants";

export type Alert = {
  kind: "big" | "duplicate" | "new-merchant" | "spike";
  title: string;
  detail: string;
  amountCents: number;
  date: string;
};

type SpendRow = {
  txn: Transaction;
  merchant: string;
  merchantKey: string;
  day: string;
  month: string;
  absCents: number;
  time: number;
  personLike: boolean;
};

const DAY_MS = 86_400_000;
const BIG_SPEND_CENTS = 50_000;

const KIND_RANK: Record<Alert["kind"], number> = {
  big: 0,
  duplicate: 1,
  "new-merchant": 2,
  spike: 3,
};

export function computeAlerts(txns: Transaction[]): Alert[] {
  const spends = txns
    .filter((txn) => txn.amountCents < 0)
    .map(toSpendRow)
    .sort((a, b) => a.time - b.time || a.txn.id.localeCompare(b.txn.id));

  if (spends.length === 0) return [];

  const alerts: Alert[] = [
    ...bigSpendAlerts(spends),
    ...duplicateAlerts(spends),
    ...newMerchantAlerts(spends),
    ...spikeAlerts(spends),
  ];

  return alerts
    .sort((a, b) => (
      Math.abs(b.amountCents) - Math.abs(a.amountCents)
      || b.date.localeCompare(a.date)
      || KIND_RANK[a.kind] - KIND_RANK[b.kind]
      || a.title.localeCompare(b.title)
    ))
    .slice(0, 8);
}

function toSpendRow(txn: Transaction): SpendRow {
  const day = toDay(txn.date);
  const merchant = cleanMerchant(txn.description, txn.counterparty);
  return {
    txn,
    merchant,
    merchantKey: normalizeMerchant(merchant),
    day,
    month: day.slice(0, 7),
    absCents: Math.abs(txn.amountCents),
    time: Date.parse(`${day}T00:00:00.000Z`),
    personLike: isPayNowToPerson(txn.description, txn.counterparty),
  };
}

function bigSpendAlerts(spends: SpendRow[]): Alert[] {
  const medians = new Map<string, number>();
  const byCategory = groupBy(spends, (row) => row.txn.category);

  for (const [category, rows] of byCategory) {
    medians.set(category, median(rows.map((row) => row.absCents)));
  }

  return spends.flatMap((row) => {
    const categoryMedian = medians.get(row.txn.category) ?? 0;
    const overFixedLimit = row.txn.amountCents <= -BIG_SPEND_CENTS;
    const overCategoryNorm = categoryMedian > 0 && row.absCents > categoryMedian * 2.5;

    if (!overFixedLimit && !overCategoryNorm) return [];

    const reason = overFixedLimit ? "single charge over S$500" : `above typical ${row.txn.category} spend`;
    return [{
      kind: "big" as const,
      title: `Large spend at ${row.merchant}`,
      detail: `${contextLabel(row)} · ${reason}`,
      amountCents: row.txn.amountCents,
      date: row.day,
    }];
  });
}

function duplicateAlerts(spends: SpendRow[]): Alert[] {
  const recurringMerchants = new Set<string>();
  for (const [merchantKey, rows] of groupBy(spends, (row) => row.merchantKey)) {
    if (looksMonthly(rows)) recurringMerchants.add(merchantKey);
  }

  const byMerchantAndAmount = groupBy(spends, (row) => `${row.merchantKey}\0${row.txn.amountCents}`);
  const alerts: Alert[] = [];

  for (const rows of byMerchantAndAmount.values()) {
    if (rows.length < 2 || recurringMerchants.has(rows[0]!.merchantKey)) continue;

    let match: { first: SpendRow; second: SpendRow; gapDays: number } | null = null;
    const ordered = [...rows].sort((a, b) => a.time - b.time || a.txn.id.localeCompare(b.txn.id));

    for (let i = 1; i < ordered.length; i++) {
      const first = ordered[i - 1]!;
      const second = ordered[i]!;
      const gapDays = Math.round((second.time - first.time) / DAY_MS);
      if (gapDays <= 3) match = { first, second, gapDays };
    }

    if (!match) continue;

    const gap = match.gapDays === 0 ? "same day" : `${match.gapDays}d apart`;
    alerts.push({
      kind: "duplicate",
      title: `Possible duplicate at ${match.second.merchant}`,
      detail: `${contextLabel(match.second)} · matches ${match.first.day} · ${gap}`,
      amountCents: match.second.txn.amountCents,
      date: match.second.day,
    });
  }

  return alerts;
}

function newMerchantAlerts(spends: SpendRow[]): Alert[] {
  const latestMonth = spends.reduce((latest, row) => (row.month > latest ? row.month : latest), "");
  const alerts: Alert[] = [];

  for (const rows of groupBy(spends, (row) => row.merchantKey).values()) {
    const ordered = [...rows].sort((a, b) => a.time - b.time || a.txn.id.localeCompare(b.txn.id));
    const first = ordered[0]!;
    if (first.month !== latestMonth) continue;

    const latestRows = ordered.filter((row) => row.month === latestMonth);
    const amountCents = latestRows.reduce((sum, row) => sum + row.txn.amountCents, 0);
    const countText = latestRows.length === 1 ? "1 charge" : `${latestRows.length} charges`;

    alerts.push({
      kind: "new-merchant",
      title: `New merchant: ${first.merchant}`,
      detail: `${contextLabel(first)} · first seen ${first.day} · ${countText}`,
      amountCents,
      date: first.day,
    });
  }

  return alerts;
}

function spikeAlerts(spends: SpendRow[]): Alert[] {
  const byDay = new Map<string, { amountCents: number; count: number }>();

  for (const row of spends) {
    const current = byDay.get(row.day) ?? { amountCents: 0, count: 0 };
    current.amountCents += row.txn.amountCents;
    current.count += 1;
    byDay.set(row.day, current);
  }

  const dailySpend = [...byDay.values()].map((day) => Math.abs(day.amountCents));
  const dailyMedian = median(dailySpend);
  const mad = median(dailySpend.map((amount) => Math.abs(amount - dailyMedian)));
  const threshold = dailyMedian + 3 * mad;

  return [...byDay.entries()].flatMap(([day, total]) => {
    const spent = Math.abs(total.amountCents);
    if (spent <= threshold) return [];

    return [{
      kind: "spike" as const,
      title: `Spending spike on ${day}`,
      detail: `${total.count} spend rows · above the daily baseline`,
      amountCents: total.amountCents,
      date: day,
    }];
  });
}

function looksMonthly(rows: SpendRow[]): boolean {
  if (rows.length < 3) return false;

  for (const amountRows of groupBy(rows, (row) => String(row.txn.amountCents)).values()) {
    const uniqueDays = [...new Set(amountRows.map((row) => row.day))].sort();
    if (uniqueDays.length < 3) continue;

    const gaps = uniqueDays.slice(1).map((day, index) => (
      Math.round((Date.parse(`${day}T00:00:00.000Z`) - Date.parse(`${uniqueDays[index]!}T00:00:00.000Z`)) / DAY_MS)
    ));
    const monthlyGaps = gaps.filter((gap) => gap >= 25 && gap <= 35).length;
    const gapMedian = median(gaps);
    const gapMad = median(gaps.map((gap) => Math.abs(gap - gapMedian)));

    if (monthlyGaps >= 2 && monthlyGaps / gaps.length >= 0.5) return true;
    if (gapMedian >= 25 && gapMedian <= 35 && gapMad <= 4) return true;
  }

  return false;
}

function contextLabel(row: SpendRow): string {
  return row.personLike ? "PayNow/person-to-person" : row.txn.category;
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeMerchant(merchant: string): string {
  return merchant.toLowerCase().replace(/\s+/g, " ").trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return groups;
}
