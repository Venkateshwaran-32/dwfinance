import type { Transaction } from "@prisma/client";
import { cleanMerchant, isPayNowToPerson } from "@/server/merchants";

// Money flow: income sources -> total -> categories + saved.
// Everything is in cents and both sides always balance: sum(sources) === totalCents === sum(uses).
export type MoneyFlow = {
  sources: { name: string; cents: number; kind: "income" | "drawdown" }[];
  uses: { name: string; cents: number; kind: "category" | "saved" }[];
  totalCents: number;
  incomeCents: number;
  spendCents: number;
  paynowPeopleCents: number; // part of spendCents that went to named people via PayNow / NETS QR
};

const TOP_SOURCE_COUNT = 3;

export function buildMoneyFlow(txns: Transaction[]): MoneyFlow {
  const bySource = new Map<string, number>();
  const byCategory = new Map<string, number>();
  let incomeCents = 0, spendCents = 0, paynowPeopleCents = 0;

  for (const t of txns) {
    if (t.amountCents > 0) {
      incomeCents += t.amountCents;
      const name = cleanMerchant(t.description, t.counterparty).trim() || "Other income";
      bySource.set(name, (bySource.get(name) ?? 0) + t.amountCents);
    } else if (t.amountCents < 0) {
      const cents = -t.amountCents;
      spendCents += cents;
      const category = t.category.trim() || "Uncategorized";
      byCategory.set(category, (byCategory.get(category) ?? 0) + cents);
      if (isPayNowToPerson(t.description, t.counterparty)) paynowPeopleCents += cents;
    }
  }

  const desc = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
  const ranked = [...bySource.entries()].sort(desc);
  const sources: MoneyFlow["sources"] = ranked.slice(0, TOP_SOURCE_COUNT).map(([name, cents]) => ({ name, cents, kind: "income" }));
  const restCents = ranked.slice(TOP_SOURCE_COUNT).reduce((sum, [, cents]) => sum + cents, 0);
  if (restCents > 0) sources.push({ name: "Other income", cents: restCents, kind: "income" });
  // Spent more than came in: the gap came out of existing savings, so the two sides still balance.
  if (spendCents > incomeCents) sources.push({ name: "From savings", cents: spendCents - incomeCents, kind: "drawdown" });

  const uses: MoneyFlow["uses"] = [...byCategory.entries()].sort(desc).map(([name, cents]) => ({ name, cents, kind: "category" }));
  if (incomeCents > spendCents) uses.push({ name: "Saved", cents: incomeCents - spendCents, kind: "saved" });

  return { sources, uses, totalCents: Math.max(incomeCents, spendCents), incomeCents, spendCents, paynowPeopleCents };
}
