import "server-only";

import { formatCents } from "@/lib/money";
import { cleanMerchant, isPayNowToPerson } from "@/server/merchants";
import type { Transaction } from "@prisma/client";

export type Insight = { text: string; tone: "up" | "down" | "new" | "info"; amountCents?: number };

const MIN_DELTA_CENTS = 2_000;
const MIN_DELTA_RATIO = 0.25;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type MerchantSpend = { key: string; name: string; cents: number; count: number };
type DaySpend = { day: string; cents: number; count: number };

export function computeInsights(txns: Transaction[]): Insight[] {
  const months = [...new Set(txns.map((t) => monthKey(t.date)))].sort();
  const latestMonth = months.at(-1);

  if (!latestMonth) {
    return [{ text: "No transaction data yet.", tone: "info", amountCents: 0 }];
  }

  if (months.length < 2) {
    return [summarizeMonth(txns, latestMonth)];
  }

  const previousMonth = previousCalendarMonth(latestMonth);
  const currentSpend = spendInMonth(txns, latestMonth);
  const previousSpend = spendInMonth(txns, previousMonth);
  const insights: Insight[] = [
    ...categoryMovers(currentSpend, previousSpend, previousMonth).slice(0, 3),
  ];

  const newMerchant = findNewMerchant(txns, latestMonth);
  if (newMerchant) {
    insights.push({
      text: `New merchant: ${newMerchant.name} at ${formatCents(newMerchant.cents)} this month.`,
      tone: "new",
      amountCents: newMerchant.cents,
    });
  }

  const day = biggestSpendDay(currentSpend);
  if (day) {
    insights.push({
      text: `Biggest spend day: ${dayLabel(day.day)} at ${formatCents(day.cents)} across ${day.count} ${plural(day.count, "transaction")}.`,
      tone: "info",
      amountCents: day.cents,
    });
  }

  if (insights.length < 3) {
    insights.push(summarizeMonth(txns, latestMonth));
  }

  return insights
    .map((insight, index) => ({ insight, index }))
    .sort((a, b) => Math.abs(b.insight.amountCents ?? 0) - Math.abs(a.insight.amountCents ?? 0) || a.index - b.index)
    .slice(0, 5)
    .map(({ insight }) => insight);
}

function categoryMovers(currentSpend: Transaction[], previousSpend: Transaction[], previousMonth: string): Insight[] {
  const currentByCategory = spendByCategory(currentSpend);
  const previousByCategory = spendByCategory(previousSpend);
  const categories = [...new Set([...currentByCategory.keys(), ...previousByCategory.keys()])];

  return categories
    .map((category) => {
      const currentCents = currentByCategory.get(category) ?? 0;
      const previousCents = previousByCategory.get(category) ?? 0;
      const deltaCents = currentCents - previousCents;
      return { category, currentCents, previousCents, deltaCents };
    })
    .filter(({ currentCents, previousCents, deltaCents }) => {
      if (deltaCents === 0 || Math.abs(deltaCents) < MIN_DELTA_CENTS) return false;
      if (previousCents === 0) return currentCents >= MIN_DELTA_CENTS;
      return Math.abs(deltaCents) / previousCents >= MIN_DELTA_RATIO;
    })
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents) || compareText(a.category, b.category))
    .map(({ category, currentCents, previousCents, deltaCents }) => {
      const topMerchant = topMerchantForCategory(currentSpend, category);
      const direction = deltaCents > 0 ? "up" : "down";
      const changeText = previousCents === 0
        ? "up from no spend"
        : `${direction} ${Math.round((Math.abs(deltaCents) / previousCents) * 100)}%`;
      const driver = merchantDriver(topMerchant, deltaCents, currentCents);

      return {
        text: `${category} ${changeText} vs ${monthLabel(previousMonth)} (${signedCents(deltaCents)})${driver}.`,
        tone: direction,
        amountCents: deltaCents,
      };
    });
}

function spendInMonth(txns: Transaction[], month: string): Transaction[] {
  return txns.filter((t) => t.amountCents < 0 && monthKey(t.date) === month);
}

function spendByCategory(txns: Transaction[]): Map<string, number> {
  const byCategory = new Map<string, number>();
  for (const txn of txns) {
    const category = txn.category.trim() || "Uncategorized";
    byCategory.set(category, (byCategory.get(category) ?? 0) + -txn.amountCents);
  }
  return byCategory;
}

function topMerchantForCategory(txns: Transaction[], category: string): MerchantSpend | null {
  return topMerchant(txns.filter((txn) => (txn.category.trim() || "Uncategorized") === category));
}

function findNewMerchant(txns: Transaction[], latestMonth: string): MerchantSpend | null {
  const seenBefore = new Set<string>();
  const current = new Map<string, MerchantSpend>();

  for (const txn of txns) {
    if (txn.amountCents >= 0) continue;
    const merchant = merchantFrom(txn);
    if (!merchant) continue;

    const txnMonth = monthKey(txn.date);
    if (txnMonth < latestMonth) {
      seenBefore.add(merchant.key);
      continue;
    }

    if (txnMonth === latestMonth && !seenBefore.has(merchant.key) && !isPayNowToPerson(txn.description, txn.counterparty)) {
      addMerchantSpend(current, merchant, -txn.amountCents);
    }
  }

  return sortMerchants([...current.values()].filter((merchant) => !seenBefore.has(merchant.key))).at(0) ?? null;
}

function topMerchant(txns: Transaction[]): MerchantSpend | null {
  const merchants = new Map<string, MerchantSpend>();
  for (const txn of txns) {
    if (txn.amountCents >= 0) continue;
    const merchant = merchantFrom(txn);
    if (!merchant) continue;
    addMerchantSpend(merchants, merchant, -txn.amountCents);
  }
  return sortMerchants([...merchants.values()]).at(0) ?? null;
}

function addMerchantSpend(merchants: Map<string, MerchantSpend>, merchant: Pick<MerchantSpend, "key" | "name">, cents: number) {
  const existing = merchants.get(merchant.key);
  if (existing) {
    existing.cents += cents;
    existing.count += 1;
    if (compareText(merchant.name, existing.name) < 0) existing.name = merchant.name;
    return;
  }
  merchants.set(merchant.key, { ...merchant, cents, count: 1 });
}

function merchantFrom(txn: Transaction): Pick<MerchantSpend, "key" | "name"> | null {
  const name = cleanMerchant(txn.description, txn.counterparty).trim();
  const key = name.toLowerCase().replace(/\s+/g, " ").trim();
  return key ? { key, name } : null;
}

function sortMerchants(merchants: MerchantSpend[]): MerchantSpend[] {
  return merchants.sort((a, b) => b.cents - a.cents || compareText(a.name, b.name));
}

function biggestSpendDay(txns: Transaction[]): DaySpend | null {
  const byDay = new Map<string, DaySpend>();
  for (const txn of txns) {
    const day = dayKey(txn.date);
    const existing = byDay.get(day) ?? { day, cents: 0, count: 0 };
    existing.cents += -txn.amountCents;
    existing.count += 1;
    byDay.set(day, existing);
  }
  return [...byDay.values()].sort((a, b) => b.cents - a.cents || compareText(a.day, b.day)).at(0) ?? null;
}

function summarizeMonth(txns: Transaction[], month: string): Insight {
  const spend = spendInMonth(txns, month);
  const totals = [...spendByCategory(spend).entries()].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));
  const top = totals.at(0);

  if (!top) {
    return { text: `No spending recorded in ${monthLabel(month)}.`, tone: "info", amountCents: 0 };
  }

  return {
    text: `Top category in ${monthLabel(month)}: ${top[0]} at ${formatCents(top[1])}.`,
    tone: "info",
    amountCents: top[1],
  };
}

function merchantDriver(merchant: MerchantSpend | null, deltaCents: number, currentCents: number): string {
  if (deltaCents > 0 && merchant) return `, driven by ${merchant.name}`;
  if (deltaCents < 0 && currentCents === 0) return ", no spend this month";
  if (deltaCents < 0 && merchant) return `, largest remaining spend at ${merchant.name}`;
  return "";
}

function signedCents(cents: number): string {
  return `${cents > 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dayKey(date: Date): string {
  return `${monthKey(date)}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function previousCalendarMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(year, monthNumber - 2, 1)));
}

function monthLabel(month: string): string {
  const monthNumber = Number(month.slice(5, 7));
  return MONTHS[monthNumber - 1] ?? month;
}

function dayLabel(day: string): string {
  const month = monthLabel(day.slice(0, 7));
  const dayNumber = Number(day.slice(8, 10));
  return `${month} ${dayNumber}`;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
