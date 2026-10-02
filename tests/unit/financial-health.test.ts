import { describe, expect, it } from "vitest";
import type { Transaction } from "@prisma/client";
import { computeHealth, periodLabel } from "@/server/financial-health";

let n = 0;
const row = (ym: string, cents: number, description: string): Transaction => ({
  id: `h${n++}`, userId: "u", statementId: "s", date: new Date(`${ym}-15T00:00:00Z`), description, counterparty: null,
  amountCents: cents, category: cents > 0 ? "Income" : "Food", subcategory: null, confidence: 0.9, needsReview: false, source: "rule",
} as Transaction);
const months = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
// Steady months saving 40%, then a last month that overspends by half.
const steady = (ym: string) => [row(ym, 200_000, "SALARY ACME"), row(ym, -120_000, "Debit Card Transaction FOOD PLACE SI SINGAPORE")];
const all = [...months(2067).flatMap(steady), ...months(2068).slice(0, 11).flatMap(steady),
  row("2068-12", 200_000, "SALARY ACME"), row("2068-12", -300_000, "Debit Card Transaction FOOD PLACE SI SINGAPORE")];
const inPeriod = (from: string, to: string) => all.filter((t) => { const ym = t.date.toISOString().slice(0, 7); return ym >= from && ym <= to; });

describe("computeHealth", () => {
  it("scores a long period on its overall savings rate, not on its last month", () => {
    const h = computeHealth(inPeriod("2067-01", "2068-12"), { allTxns: all, from: "2067-01", to: "2068-12" });
    expect(h.months).toBe(24);
    // (24 x 2000 - (23 x 1200 + 3000)) / (24 x 2000) = 36%
    expect(h.savingsRatePct).toBe(36);
    expect(h.score).toBeGreaterThan(50);
    // All time: there is no same-length period before it, so no comparison.
    expect(h.prevSavingsRatePct).toBeNull();
    expect(h.prevLabel).toBeNull();
  });

  it("scores a single month on that month and compares it with the month before", () => {
    const h = computeHealth(inPeriod("2068-12", "2068-12"), { allTxns: all, from: "2068-12", to: "2068-12" });
    expect(h).toMatchObject({ months: 1, savingsRatePct: -50, prevSavingsRatePct: 40, prevLabel: "Nov 2068" });
    expect(h.score).toBeLessThan(50);
  });

  it("compares a year with the full year before it", () => {
    const h = computeHealth(inPeriod("2068-01", "2068-12"), { allTxns: all, from: "2068-01", to: "2068-12" });
    expect(h).toMatchObject({ months: 12, prevSavingsRatePct: 40, prevLabel: "Jan 2067 to Dec 2067" });
  });

  it("defaults the period to the months in the data and labels periods plainly", () => {
    expect(computeHealth(all).months).toBe(24);
    expect(periodLabel("2070-12", "2070-12")).toBe("Dec 2070");
    expect(computeHealth([]).score).toBe(0);
  });
});
