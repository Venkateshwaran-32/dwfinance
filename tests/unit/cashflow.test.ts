import { describe, expect, it } from "vitest";
import type { Transaction } from "@prisma/client";
import { buildMoneyFlow } from "@/lib/cashflow";

let n = 0;
const txn = (description: string, amountCents: number, category: string): Transaction => ({
  id: `t${n++}`, userId: "u", statementId: "s", date: new Date("2067-03-01T00:00:00Z"), description, counterparty: null,
  amountCents, category, subcategory: null, confidence: 1, needsReview: false, source: "rule",
} as Transaction);
const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);

describe("buildMoneyFlow", () => {
  const rows = [
    txn("Advice FAST Payment / Receipt INCOMING PAYNOW REF 1111111 FROM: LOKE KAH WAI", 60000, "Transfers"),
    txn("Advice FAST Payment / Receipt INCOMING PAYNOW REF 2222222 FROM: LOKE KAH WAI", 60000, "Transfers"),
    txn("Advice GIRO SALARY 3333333 FROM: KOPI CORNER PTE LTD", 45033, "Income"),
    txn("Advice FAST Payment / Receipt PAYNOW TRANSFER 4444444 TO: ONG BEE LIAN", -340, "Food & Dining"),
    txn("Advice FAST Payment / Receipt PAYNOW TRANSFER 5555555 TO: ONG BEE LIAN", -451, "Food & Dining"),
    txn("Debit Card Transaction NTUC FAIRPRICE NTU SI SINGAPORE", -2219, "Groceries"),
    txn("Debit Card Transaction BUS/MRT 370316167 SI SINGAPORE", -133, "Transport"),
  ];

  it("balances to the cent: sources = total = categories + saved", () => {
    const f = buildMoneyFlow(rows);
    expect(f.incomeCents).toBe(165033);
    expect(f.spendCents).toBe(3143);
    expect(f.totalCents).toBe(165033);
    expect(sum(f.sources)).toBe(f.totalCents);
    expect(sum(f.uses)).toBe(f.totalCents);
    expect(f.uses.at(-1)).toEqual({ name: "Saved", cents: 165033 - 3143, kind: "saved" });
  });

  it("groups income by payer (reference numbers ignored) and spend by category, largest first", () => {
    const f = buildMoneyFlow(rows);
    expect(f.sources[0]).toEqual({ name: "LOKE KAH WAI", cents: 120000, kind: "income" });
    expect(f.sources).toHaveLength(2);
    expect(f.uses.filter((u) => u.kind === "category")).toEqual([
      { name: "Groceries", cents: 2219, kind: "category" },
      { name: "Food & Dining", cents: 791, kind: "category" },
      { name: "Transport", cents: 133, kind: "category" },
    ]);
    expect(f.paynowPeopleCents).toBe(791);
  });

  it("folds payers beyond the top 3 into Other income", () => {
    const many = ["AAA ONE", "BBB TWO", "CCC THREE", "DDD FOUR", "EEE FIVE"].map((p, i) => txn(`INCOMING PAYNOW REF 900000${i} FROM: ${p}`, 1000 * (5 - i), "Income"));
    const f = buildMoneyFlow(many);
    expect(f.sources.map((s) => s.name)).toEqual(["AAA ONE", "BBB TWO", "CCC THREE", "Other income"]);
    expect(f.sources.at(-1)?.cents).toBe(3000);
    expect(sum(f.sources)).toBe(f.incomeCents);
  });

  it("adds a From savings source when spending exceeds income, and no Saved bar", () => {
    const f = buildMoneyFlow([txn("GIRO SALARY FROM: KOPI CORNER PTE LTD", 1000, "Income"), txn("Debit Card Transaction LAPTOP WORLD SI SINGAPORE", -149900, "Other")]);
    expect(f.sources.at(-1)).toEqual({ name: "From savings", cents: 148900, kind: "drawdown" });
    expect(f.uses.some((u) => u.kind === "saved")).toBe(false);
    expect(sum(f.sources)).toBe(sum(f.uses));
    expect(f.totalCents).toBe(149900);
  });

  it("handles no transactions", () => {
    expect(buildMoneyFlow([])).toEqual({ sources: [], uses: [], totalCents: 0, incomeCents: 0, spendCents: 0, paynowPeopleCents: 0 });
  });
});
