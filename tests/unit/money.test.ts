import { describe, it, expect } from "vitest";
import { parseAmountToCents, formatCents } from "@/lib/money";

describe("money", () => {
  it("parses signed amounts to integer cents", () => {
    expect(parseAmountToCents("-3.30")).toBe(-330);
    expect(parseAmountToCents("1,234.50")).toBe(123450);
    expect(parseAmountToCents("(3.30)")).toBe(-330); // accounting-style negative
    expect(parseAmountToCents("42.00")).toBe(4200);
  });
  it("rejects garbage as 0 (never NaN)", () => {
    expect(parseAmountToCents("abc")).toBe(0);
  });
  it("formats cents as SGD with 2 decimals", () => {
    expect(formatCents(-330)).toContain("3.30");
    expect(formatCents(123450)).toBe("S$1,234.50");
    expect(formatCents(-330)).toBe("-S$3.30");
  });
});
