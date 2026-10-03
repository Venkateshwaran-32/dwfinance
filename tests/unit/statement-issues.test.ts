import { describe, expect, it } from "vitest";
import { countNeedsChecking, needsChecking, needsCheckingClause } from "@/server/statement-issues";

describe("needsChecking", () => {
  it.each([
    [null, false],
    [undefined, false],
    ["", false],
    ["  \n ", false],
    ["Balance does not reconcile", true],
    ["a\nb", true],
  ])("issues=%j -> %s", (issues, expected) => {
    expect(needsChecking({ issues })).toBe(expected);
  });
});

describe("countNeedsChecking", () => {
  it("returns 0 for an empty list", () => {
    expect(countNeedsChecking([])).toBe(0);
  });

  it("returns 0 when every statement passed", () => {
    expect(countNeedsChecking([{ issues: null }, { issues: null }, { issues: null }])).toBe(0);
  });

  it("counts only statements with non-blank issues", () => {
    const statements = [
      { issues: null },
      { issues: "" },
      { issues: "  \n " },
      { issues: "Balance does not reconcile" },
      { issues: "a\nb" },
    ];
    expect(countNeedsChecking(statements)).toBe(2);
  });
});

describe("needsCheckingClause", () => {
  it.each([
    [0, ""],
    [-3, ""],
    [1, ", 1 needs checking"],
    [2, ", 2 need checking"],
    [48, ", 48 need checking"],
  ])("n=%d -> %j", (n, expected) => {
    expect(needsCheckingClause(n)).toBe(expected);
  });
});
