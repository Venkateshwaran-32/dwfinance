import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway SQLite per run — never touches prisma/dev.db.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dwfinance-rules-"));
const DATABASE_URL = `file:${path.join(dir, "test.db")}`;

type Rules = typeof import("@/server/rules");
type Db = typeof import("@/lib/db")["db"];
let rules: Rules;
let db: Db;
let userA = "";
let userB = "";

const paynow = (ref: string, who: string) => `Advice FAST Payment / Receipt PAYNOW TRANSFER ${ref} TO: ${who} PAYNOW TRANSFER OTHER`;

beforeAll(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    cwd: path.resolve(__dirname, "../.."), env: { ...process.env, DATABASE_URL }, stdio: "pipe",
  });
  process.env.DATABASE_URL = DATABASE_URL;
  ({ db } = await import("@/lib/db"));
  rules = await import("@/server/rules");

  const a = await db.user.create({ data: { email: "a@test.local", passwordHash: "x" } });
  const b = await db.user.create({ data: { email: "b@test.local", passwordHash: "x" } });
  userA = a.id; userB = b.id;
  const sa = await db.statement.create({ data: { userId: userA, period: "2026-03" } });
  const sb = await db.statement.create({ data: { userId: userB, period: "2026-03" } });
  const row = (userId: string, statementId: string, day: number, description: string, category: string, needsReview = true) => ({
    userId, statementId, date: new Date(Date.UTC(2026, 2, day)), description, amountCents: -1200, category, needsReview, source: "fallback",
  });
  await db.transaction.createMany({
    data: [
      row(userA, sa.id, 1, paynow("9540195", "ONG BEE LIAN"), "Food & Dining"),
      row(userA, sa.id, 2, paynow("8069662", "ONG BEE LIAN"), "Transfers"),
      row(userA, sa.id, 3, paynow("1234567", "ONG BEE LIAN"), "Other"),
      row(userA, sa.id, 4, paynow("7654321", "TAN AH KOW"), "Transfers"),
      row(userA, sa.id, 5, "Debit Card Transaction NTUC FAIRPRICE BISHAN SI SINGAPORE", "Groceries", false),
      row(userB, sb.id, 1, paynow("5555555", "ONG BEE LIAN"), "Transfers"),
    ],
  });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("payee rules (teach once, sticks forever)", () => {
  let key = "";

  it("resolves free text to the payee group across different ref numbers", async () => {
    const c = await rules.resolvePayee(userA, "ong bee lian");
    expect(c[0].count).toBe(3);
    expect(c[0].payee.toUpperCase()).toContain("ONG BEE LIAN");
    expect(c.length).toBeLessThanOrEqual(5);
    key = c[0].matchKey;
    expect(await rules.resolvePayee(userA, "   ")).toEqual([]);
  });

  it("previews without writing", async () => {
    const before = await db.transaction.findMany({ where: { userId: userA }, orderBy: { id: "asc" } });
    const p = await rules.previewPayeeRule(userA, key, "Food & Dining");
    expect(p.count).toBe(3);
    expect(p.alreadyCount).toBe(0); // the Food & Dining row is still an unconfirmed guess (needsReview)
    expect(p.samples).toHaveLength(3);
    expect(p.samples[0].date).toBe("2026-03-03"); // newest first
    const after = await db.transaction.findMany({ where: { userId: userA }, orderBy: { id: "asc" } });
    expect(after).toEqual(before);
    expect(await db.merchantRule.count()).toBe(0);
  });

  it("applies to exactly the matching rows of this user only, idempotently", async () => {
    expect(await rules.applyPayeeRule(userA, key, "Food & Dining")).toEqual({ updated: 3 });
    const ong = await db.transaction.findMany({ where: { userId: userA, description: { contains: "ONG BEE LIAN" } } });
    expect(ong.every((t) => t.category === "Food & Dining" && t.source === "user" && !t.needsReview && t.confidence === 1)).toBe(true);
    const tan = await db.transaction.findFirstOrThrow({ where: { userId: userA, description: { contains: "TAN AH KOW" } } });
    expect([tan.category, tan.source, tan.needsReview]).toEqual(["Transfers", "fallback", true]);
    const ntuc = await db.transaction.findFirstOrThrow({ where: { userId: userA, description: { contains: "NTUC" } } });
    expect([ntuc.category, ntuc.source]).toEqual(["Groceries", "fallback"]);
    const other = await db.transaction.findFirstOrThrow({ where: { userId: userB } });
    expect([other.category, other.source, other.needsReview]).toEqual(["Transfers", "fallback", true]);
    expect(await db.merchantRule.findUnique({ where: { userId_matchKey: { userId: userA, matchKey: key } } })).toMatchObject({ category: "Food & Dining" });

    expect(await rules.applyPayeeRule(userA, key, "Food & Dining")).toEqual({ updated: 3 });
    expect(await db.merchantRule.count({ where: { userId: userA } })).toBe(1);
    expect(await db.merchantRule.count({ where: { userId: userB } })).toBe(0);
  });

  it("rejects invalid category and matchKey", async () => {
    await expect(rules.previewPayeeRule(userA, key, "Crypto")).rejects.toThrow();
    await expect(rules.applyPayeeRule(userA, key, "Crypto")).rejects.toThrow();
    await expect(rules.applyPayeeRule(userA, "", "Other")).rejects.toThrow();
    await expect(rules.applyPayeeRule(userA, "x".repeat(65), "Other")).rejects.toThrow();
  });

  it("saved rule categorizes a future upload with a new ref number", async () => {
    const { categorizeDeterministic } = await import("@/server/categorize");
    const saved = await db.merchantRule.findMany({ where: { userId: userA } });
    const map = new Map(saved.map((r) => [r.matchKey, { category: r.category }]));
    const [out] = categorizeDeterministic(
      [{ description: paynow("3141592", "ONG BEE LIAN"), counterparty: null, amountCents: -4500, date: new Date() }], map,
    );
    expect(out.category).toBe("Food & Dining");
    expect(out.source).toBe("user");
  });
});
