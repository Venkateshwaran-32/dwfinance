import 'server-only';

import type { Transaction } from "@prisma/client";
import { formatCents } from "@/lib/money";
import { isLargeOneOff, recurringPayees } from "@/lib/spend-trend";
import { cleanMerchant, isPayNowToPerson } from "@/server/merchants";

export type AlertKind = "big" | "duplicate" | "new-merchant" | "spike";

// One alert per day: every signal that points at the same day (a big purchase, the spike it caused, a first-time
// payee) is merged into a single row that lists its reasons, instead of three rows about one purchase.
export type Alert = {
  kind: AlertKind;            // the most important reason; drives the dot colour
  kinds: AlertKind[];         // every reason, most important first
  title: string;              // short: the payee (and "+ N more" for a busy day)
  reasons: string[];          // plain-English reasons, most important first
  detail: string;             // reasons joined with " · "
  amountCents: number;        // the flagged payment, or the day's total for a busy day with no single big payment
  date: string;               // YYYY-MM-DD
  dateLabel: string;          // "6 Aug 2067"
  href: string;               // that day in Statements
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

type Signal = {
  kind: AlertKind;
  day: string;
  row: SpendRow | null;     // the payment the signal is about; null for a busy day
  reason: string;
  amountCents: number;
  dayRows?: SpendRow[];     // busy day only: that day's everyday payments
};

const DAY_MS = 86_400_000;
const MAX_ALERTS = 6;
// debt: fixed floors suit a student/young-earner budget; make them relative to income when users with very
// different spending levels appear.
const MIN_UNUSUAL_CENTS = 10_000;   // "well above usual" only from S$100, so a S$40 grocery run is not an alert
const BUSY_DAY_FLOOR_CENTS = 20_000; // a busy day must also total S$200+
const DUP_SAME_DAY_MIN_CENTS = 2_000;  // same amount twice in a day: from S$20
const DUP_NEARBY_MIN_CENTS = 5_000;    // same amount within 3 days: from S$50
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Lower = more important. Used to pick the headline reason and to order reasons inside one alert.
const KIND_RANK: Record<AlertKind, number> = { duplicate: 0, big: 1, spike: 2, "new-merchant": 3 };
// How much each kind of reason adds to an alert's importance (on top of its amount).
const KIND_WEIGHT: Record<AlertKind, number> = { duplicate: 1, big: 0.5, spike: 0.25, "new-merchant": 0.25 };

export function computeAlerts(txns: Transaction[]): Alert[] {
  const spends = txns
    .filter((txn) => txn.amountCents < 0)
    .map(toSpendRow)
    .sort((a, b) => a.time - b.time || a.txn.id.localeCompare(b.txn.id));

  if (spends.length === 0) return [];

  // Rent, hall fees and other large bills paid regularly at about the same amount are expected, not alerts.
  const regular = recurringPayees(spends.map(trendRow));

  const signals: Signal[] = [
    ...bigSpendSignals(spends, regular),
    ...duplicateSignals(spends),
    ...newMerchantSignals(spends),
    ...spikeSignals(spends, regular),
  ];

  return mergeByDay(signals)
    .sort((a, b) => b.score - a.score || b.alert.date.localeCompare(a.alert.date) || a.alert.title.localeCompare(b.alert.title))
    .slice(0, MAX_ALERTS)
    .map(({ alert }) => alert);
}

function mergeByDay(signals: Signal[]): { alert: Alert; score: number }[] {
  const byDay = groupBy(signals, (signal) => signal.day);
  const out: { alert: Alert; score: number }[] = [];

  for (const [day, daySignals] of byDay) {
    const ordered = [...daySignals].sort((a, b) => (
      KIND_RANK[a.kind] - KIND_RANK[b.kind] || Math.abs(b.amountCents) - Math.abs(a.amountCents)
    ));
    const head = ordered[0]!;
    const kinds = [...new Set(ordered.map((signal) => signal.kind))];
    const reasons = [...new Set(ordered.map((signal) => signal.reason))];

    // The payments this alert is about: the flagged ones, or (for a busy day only) the day's biggest payment.
    const flaggedRows = ordered.flatMap((signal) => (signal.row ? [signal.row] : []));
    const spike = ordered.find((signal) => signal.kind === "spike");
    let title: string;
    let amountCents: number;
    if (flaggedRows.length > 0) {
      const biggest = flaggedRows.reduce((max, row) => (row.absCents > max.absCents ? row : max));
      title = head.kind === "new-merchant" && kinds.length === 1 ? `New merchant: ${biggest.merchant}` : biggest.merchant;
      amountCents = head.row ? head.amountCents : -biggest.absCents;
    } else {
      // Only a busy day: name its biggest payment and how many others made up the total.
      const dayRows = spike?.dayRows ?? [];
      const biggest = dayRows.reduce<SpendRow | null>((max, row) => (!max || row.absCents > max.absCents ? row : max), null);
      const others = new Set(dayRows.map((row) => row.merchant)).size - 1;
      title = biggest ? (others > 0 ? `${biggest.merchant} + ${others} more` : biggest.merchant) : "Busy day";
      amountCents = head.amountCents;
    }

    const score = Math.abs(amountCents) * (1 + kinds.reduce((sum, kind) => sum + KIND_WEIGHT[kind], 0));
    out.push({
      score,
      alert: {
        kind: head.kind,
        kinds,
        title,
        reasons,
        detail: reasons.join(" · "),
        amountCents,
        date: day,
        dateLabel: dayLabel(day),
        href: `/dashboard/statements?from=${day}&to=${day}&adv=1`,
      },
    });
  }

  return out;
}

function toSpendRow(txn: Transaction): SpendRow {
  const day = toDay(txn.date);
  const merchant = cleanMerchant(txn.description, txn.counterparty) || txn.counterparty || txn.description;
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

function trendRow(row: SpendRow) {
  return { date: row.txn.date, amountCents: row.txn.amountCents, payeeKey: row.merchantKey };
}

function bigSpendSignals(spends: SpendRow[], regular: Set<string>): Signal[] {
  const medians = new Map<string, number>();
  for (const [category, rows] of groupBy(spends, (row) => row.txn.category)) {
    medians.set(category, median(rows.map((row) => row.absCents)));
  }

  return spends.flatMap((row) => {
    if (regular.has(row.merchantKey)) return [];
    const categoryMedian = medians.get(row.txn.category) ?? 0;
    const largeOneOff = isLargeOneOff(trendRow(row), regular);
    const overCategoryNorm = categoryMedian > 0 && row.absCents > categoryMedian * 2.5 && row.absCents >= MIN_UNUSUAL_CENTS;
    if (!largeOneOff && !overCategoryNorm) return [];

    const reason = largeOneOff
      ? (row.personLike ? "Large PayNow transfer" : "Large one-off")
      : `Well above a usual ${row.personLike ? "PayNow transfer" : `${row.txn.category} payment`}`;
    return [{ kind: "big" as const, day: row.day, row, reason, amountCents: row.txn.amountCents }];
  });
}

function duplicateSignals(spends: SpendRow[]): Signal[] {
  const recurringMerchants = new Set<string>();
  for (const [merchantKey, rows] of groupBy(spends, (row) => row.merchantKey)) {
    if (looksMonthly(rows)) recurringMerchants.add(merchantKey);
  }

  const signals: Signal[] = [];
  for (const rows of groupBy(spends, (row) => `${row.merchantKey}\0${row.txn.amountCents}`).values()) {
    if (rows.length < 2 || recurringMerchants.has(rows[0]!.merchantKey)) continue;

    let match: { first: SpendRow; second: SpendRow; gapDays: number } | null = null;
    for (let i = 1; i < rows.length; i++) {
      const first = rows[i - 1]!;
      const second = rows[i]!;
      const gapDays = Math.round((second.time - first.time) / DAY_MS);
      // Small repeat buys (the same S$6 lunch two days running) are habits, not double charges.
      const sameDay = gapDays === 0 && second.absCents >= DUP_SAME_DAY_MIN_CENTS;
      const nearby = gapDays <= 3 && second.absCents >= DUP_NEARBY_MIN_CENTS;
      if (sameDay || nearby) match = { first, second, gapDays };
    }
    if (!match) continue;

    const when = match.gapDays === 0 ? "same amount twice that day" : `same amount on ${dayLabel(match.first.day)}`;
    signals.push({
      kind: "duplicate",
      day: match.second.day,
      row: match.second,
      reason: `Possible duplicate (${when})`,
      amountCents: match.second.txn.amountCents,
    });
  }
  return signals;
}

function newMerchantSignals(spends: SpendRow[]): Signal[] {
  const latestMonth = spends.reduce((latest, row) => (row.month > latest ? row.month : latest), "");
  const signals: Signal[] = [];

  for (const rows of groupBy(spends, (row) => row.merchantKey).values()) {
    const first = rows[0]!;
    if (first.month !== latestMonth) continue;
    signals.push({ kind: "new-merchant", day: first.day, row: first, reason: "First payment to this payee", amountCents: first.txn.amountCents });
  }
  return signals;
}

// A day whose everyday spending (regular bills left out) is far above a normal day.
function spikeSignals(spends: SpendRow[], regular: Set<string>): Signal[] {
  const byDay = new Map<string, SpendRow[]>();
  for (const row of spends) {
    if (regular.has(row.merchantKey)) continue;
    const rows = byDay.get(row.day);
    if (rows) rows.push(row);
    else byDay.set(row.day, [row]);
  }

  const dayTotals = new Map([...byDay].map(([day, rows]) => [day, rows.reduce((sum, row) => sum + row.absCents, 0)]));
  const dailySpend = [...dayTotals.values()];
  const dailyMedian = median(dailySpend);
  const mad = median(dailySpend.map((amount) => Math.abs(amount - dailyMedian)));
  const threshold = Math.max(dailyMedian + 3 * mad, BUSY_DAY_FLOOR_CENTS);

  const monthMax = new Map<string, number>();
  for (const [day, total] of dayTotals) monthMax.set(day.slice(0, 7), Math.max(monthMax.get(day.slice(0, 7)) ?? 0, total));

  return [...byDay].flatMap(([day, rows]) => {
    const total = dayTotals.get(day) ?? 0;
    if (total <= threshold) return [];
    const ym = day.slice(0, 7);
    const reason = monthMax.get(ym) === total
      ? `Biggest spending day of ${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
      : `Busy day: ${formatCents(total)} across ${rows.length} ${rows.length === 1 ? "payment" : "payments"}`;
    return [{ kind: "spike" as const, day, row: null, reason, amountCents: -total, dayRows: rows }];
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

function dayLabel(day: string): string {
  return `${Number(day.slice(8, 10))} ${MON[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
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
