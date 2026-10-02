import { describe, expect, it } from "vitest";
import type { Transaction } from "@prisma/client";
import { computeSubscriptions } from "@/server/subscriptions";

let n = 0;
const charge = (merchant: string, ym: string, day: number, cents: number): Transaction => ({
  id: `t${n++}`, userId: "u", statementId: "s", date: new Date(`${ym}-${String(day).padStart(2, "0")}T00:00:00Z`),
  description: `Debit Card Transaction ${merchant} SI SINGAPORE`, counterparty: null, amountCents: -cents, category: "Subscriptions",
  subcategory: null, confidence: 0.9, needsReview: false, source: "rule",
} as Transaction);
const months = (from: number, count: number) => Array.from({ length: count }, (_, i) => { const m = from + i; return `${2067 + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, "0")}`; });
const find = (txns: Transaction[], name: string) => computeSubscriptions(txns).items.find((x) => x.name === name);

describe("computeSubscriptions", () => {
  it("keeps a subscription whose price changed long ago, at its current price, without flagging a change", () => {
    const txns = [...months(1, 11).map((m) => charge("NETFLIX.COM", m, 12, 1398)), ...months(12, 25).map((m) => charge("NETFLIX.COM", m, 12, 1798))];
    expect(find(txns, "NETFLIX.COM")).toMatchObject({ amountCents: 1798, count: 36 });
    expect(find(txns, "NETFLIX.COM")?.priceChange).toBeUndefined();
  });
  it("flags a price change only when it is the latest charge", () => {
    const txns = [...months(1, 11).map((m) => charge("SPOTIFY", m, 5, 1098)), charge("SPOTIFY", "2067-12", 5, 1398)];
    expect(find(txns, "SPOTIFY")).toMatchObject({ amountCents: 1398, priceChange: { fromCents: 1098, toCents: 1398 } });
  });
  it("shows and totals the current price after a fresh price rise", () => {
    const txns = [...months(1, 11).map((m) => charge("SPOTIFY", m, 5, 1098)), charge("SPOTIFY", "2067-12", 5, 1398),
      ...months(1, 12).map((m) => charge("NETFLIX.COM", m, 12, 1798))];
    const summary = computeSubscriptions(txns);
    expect(summary.items.find((x) => x.name === "SPOTIFY")?.amountCents).toBe(1398);
    expect(summary.totalMonthlyCents).toBe(1398 + 1798);
  });
  it("drops a subscription that stopped being charged", () => {
    const txns = [...months(1, 8).map((m) => charge("BOULDER BARN CLIMBING", m, 9, 6800)), ...months(1, 24).map((m) => charge("SPOTIFY", m, 5, 1098))];
    expect(find(txns, "BOULDER BARN CLIMBING")).toBeUndefined();
    expect(find(txns, "SPOTIFY")).toBeDefined();
  });
  it("does not treat regular shopping with changing amounts as a subscription", () => {
    const amounts = [1250, 4410, 2380, 5790, 1985, 3320, 2675, 4930, 1540, 3875, 2260, 5105];
    const txns = months(1, 12).map((m, i) => charge("NTUC FAIRPRICE NTU", m, 14, amounts[i]!));
    expect(find(txns, "NTUC FAIRPRICE NTU")).toBeUndefined();
  });
});
