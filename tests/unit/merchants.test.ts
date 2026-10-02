import { describe, it, expect } from "vitest";
import { ruleCategorize, isPayNowToPerson, normalizeKey } from "@/server/merchants";

describe("merchant rules (deterministic first pass)", () => {
  it("categorizes known SG merchants", () => {
    expect(ruleCategorize("NTUC FAIRPRICE", "NTUC FAIRPRICE")?.category).toBe("Groceries");
    expect(ruleCategorize("GRAB RIDE", "GRAB")?.category).toBe("Transport");
    expect(ruleCategorize("SP GROUP UTILITIES", "SP GROUP")?.category).toBe("Utilities");
    expect(ruleCategorize("SINGTEL MOBILE", "SINGTEL")?.category).toBe("Telecom");
  });
  it("returns null for PayNow-to-individual (the DBS gap) so it routes to AI/review", () => {
    expect(ruleCategorize("PAYNOW TRANSFER", "Tan Wei Jie")).toBeNull();
  });
  it("detects PayNow to a named person", () => {
    expect(isPayNowToPerson("PAYNOW TRANSFER", "Tan Wei Jie")).toBe(true);
    expect(isPayNowToPerson("NTUC FAIRPRICE", "NTUC FAIRPRICE")).toBe(false);
  });
  it("normalizes a stable match key", () => {
    expect(normalizeKey("PAYNOW TRANSFER", "Tan Wei Jie")).toBe("tan wei jie");
  });
});
