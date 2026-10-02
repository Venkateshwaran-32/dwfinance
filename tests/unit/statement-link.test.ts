import { describe, expect, it } from "vitest";
import { statementHref } from "@/lib/statement-link";

describe("statementHref", () => {
  it("uses the find_transactions filter", () => {
    expect(statementHref([{ tool: "find_transactions", args: { text: "ong bee lian", from: "2067-11-01" }, result: {} }]))
      .toBe("/dashboard/statements?q=ong+bee+lian&from=2067-11-01&all=1#match");
  });
  it("points a month ranking at the top month", () => {
    const step = { tool: "spend_summary", args: { groupBy: "month" }, result: { groups: [{ name: "2067-02" }] } };
    expect(statementHref([step])).toBe("/dashboard/statements?from=2067-02-01&to=2067-02-28&all=1#match");
  });
  it("uses the payee of a proposed recategorisation", () => {
    const step = { tool: "propose_payee_category", args: { payee: "ong" }, result: { pendingAction: { payee: "ONG BEE LIAN" } } };
    expect(statementHref([step])).toBe("/dashboard/statements?q=ONG+BEE+LIAN&all=1#match");
  });
  it("prefers the last usable step and falls back to all statements", () => {
    expect(statementHref([{ tool: "get_insights", args: { kind: "alerts" }, result: {} }])).toBe("/dashboard/statements");
    expect(statementHref([
      { tool: "spend_summary", args: { groupBy: "category", category: "Transport" }, result: {} },
      { tool: "get_insights", args: { kind: "alerts" }, result: {} },
    ])).toBe("/dashboard/statements?category=Transport&all=1#match");
  });
});
