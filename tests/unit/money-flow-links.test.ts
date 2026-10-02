import { describe, expect, it } from "vitest";
import type { MoneyFlow } from "@/lib/cashflow";
import { MIDDLE_NAME, sharePct, toSankey, truncate } from "@/lib/money-flow-links";

const flow: MoneyFlow = {
  sources: [
    { name: "ACME PTE LTD SALARY", cents: 500_001, kind: "income" },
    { name: "Other income", cents: 1_999, kind: "income" },
    { name: "From savings", cents: 10_000, kind: "drawdown" },
  ],
  uses: [
    { name: "Food & Dining", cents: 300_000, kind: "category" },
    { name: "Transport", cents: 212_000, kind: "category" },
  ],
  totalCents: 512_000,
  incomeCents: 502_000,
  spendCents: 512_000,
  paynowPeopleCents: 0,
};

describe("toSankey", () => {
  it("keeps array order, routes everything through one middle node, and keeps exact cents", () => {
    const { nodes, links, middle } = toSankey(flow);
    expect(nodes.map((n) => n.name)).toEqual([
      "ACME PTE LTD SALARY", "Other income", "From savings", MIDDLE_NAME, "Food & Dining", "Transport",
    ]);
    expect(middle).toBe(3);
    expect(nodes[middle]).toMatchObject({ cents: 512_000, kind: "total", column: 1 });
    const into = links.filter((l) => l.target === middle);
    const out = links.filter((l) => l.source === middle);
    expect(into.map((l) => l.source)).toEqual([0, 1, 2]);
    expect(out.map((l) => l.target)).toEqual([4, 5]);
    const sum = (ls: typeof links) => ls.reduce((s, l) => s + l.value, 0);
    expect(sum(into)).toBe(flow.totalCents);
    expect(sum(out)).toBe(flow.totalCents);
    expect(links.every((l) => Number.isInteger(l.value))).toBe(true);
  });

  it("drops zero-cent rows", () => {
    const { nodes, links } = toSankey({ ...flow, uses: [...flow.uses, { name: "Saved", cents: 0, kind: "saved" }] });
    expect(nodes.some((n) => n.name === "Saved")).toBe(false);
    expect(links).toHaveLength(5);
  });
});

describe("label helpers", () => {
  it("formats shares and truncates long names", () => {
    expect(sharePct(1, 1000)).toBe("<1%");
    expect(sharePct(500, 1000)).toBe("50%");
    expect(sharePct(0, 0)).toBe("0%");
    expect(truncate("Short")).toBe("Short");
    const t = truncate("A VERY LONG PAYER NAME PTE LTD SINGAPORE");
    expect(t.length).toBeLessThanOrEqual(22);
    expect(t.endsWith("…")).toBe(true);
  });
});
