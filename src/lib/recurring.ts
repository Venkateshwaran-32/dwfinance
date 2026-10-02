// Recurring payments: payees paid again and again at a steady rhythm (groceries, transport, rent, a phone plan).
// Pure and deterministic: the dashboard calls it with the chosen period's spending; tests call it directly.
import { isLargeOneOff, recurringPayees } from "@/lib/spend-trend";

export type RecurringInput = { date: Date; amountCents: number; name: string; category: string };

export type Recurring = {
  name: string; count: number; avg: number; total: number;
  cadence: string; category: string; instances: { date: string; cents: number }[];
};

const DAY_MS = 86_400_000;
const MIN_PAYMENTS = 3;
const MANY_PAYMENTS = 6;     // this many payments counts as a habit even if the rhythm is uneven
const MAX_GAP_CV = 0.75;     // fewer payments than that: gaps must be fairly even (spread / average gap)...
const MAX_AMOUNT_SPREAD = 0.25; // ...and amounts about the same (within 25% of the median), so 3 trips a year apart drop out
const AVG_MONTH_DAYS = 365.25 / 12;

// Plain-English rhythm from the median number of days between payment days.
export function cadenceFromGap(medianGapDays: number): string {
  const g = medianGapDays;
  if (g <= 2) return "daily";
  if (g <= 5) return "a few times a week";
  if (g <= 10) return "weekly";
  if (g <= 17) return "fortnightly";
  if (g < 25) return "every 3 weeks";
  if (g <= 35) return "monthly";
  const months = Math.round(g / AVG_MONTH_DAYS);
  if (months < 11) return `every ${Math.max(2, months)} months`;
  if (months <= 13) return "yearly";
  return `every ${Math.round(g / 365.25)} years`;
}

export function computeRecurring(txns: RecurringInput[], opts: { limit?: number; maxInstances?: number } = {}): Recurring[] {
  const { limit = 10, maxInstances = 12 } = opts;
  const spends = txns.filter((t) => t.amountCents < 0);

  // A S$300+ charge is only part of a habit when that payee's large charges repeat at about the same amount
  // (rent, hall fees). Flights, hotels and gadgets bought a few times are one-offs and are left out.
  const regularLarge = recurringPayees(spends.map((t) => ({ date: t.date, amountCents: t.amountCents, payeeKey: t.name })));

  const byName = new Map<string, RecurringInput[]>();
  for (const t of spends) {
    if (isLargeOneOff({ date: t.date, amountCents: t.amountCents, payeeKey: t.name }, regularLarge)) continue;
    const list = byName.get(t.name);
    if (list) list.push(t);
    else byName.set(t.name, [t]);
  }

  const out: Recurring[] = [];
  for (const [name, list] of byName) {
    if (list.length < MIN_PAYMENTS) continue;
    const days = [...new Set(list.map((t) => dayKey(t.date)))].sort();
    if (days.length < 2) continue;
    const gaps = days.slice(1).map((d, i) => (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${days[i]!}T00:00:00Z`)) / DAY_MS);
    if (list.length < MANY_PAYMENTS) {
      const amounts = list.map((t) => -t.amountCents);
      const mid = median(amounts);
      if (coefficientOfVariation(gaps) > MAX_GAP_CV || amounts.some((a) => Math.abs(a - mid) > mid * MAX_AMOUNT_SPREAD)) continue;
    }

    const total = list.reduce((sum, t) => sum + -t.amountCents, 0);
    const instances = list
      .map((t) => ({ date: dayKey(t.date), cents: -t.amountCents }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, maxInstances);
    out.push({
      name, count: list.length, avg: Math.round(total / list.length), total,
      cadence: cadenceFromGap(median(gaps)), category: mostCommon(list.map((t) => t.category)), instances,
    });
  }

  return out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, limit);
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean <= 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "Uncategorized";
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
