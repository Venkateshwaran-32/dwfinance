import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import type { Transaction } from "@prisma/client";
import { generateYear, renderStatementPdf, TEMPLATE_EXPECTATIONS, OPENING_CENTS, type MonthStatement } from "../../scripts/sample-2067";
import { extractStatementText } from "@/server/parse-statement";
import { parseDbsStatement } from "@/server/parse-dbs";
import { cleanMerchant } from "@/server/merchants";
import { categorizeDeterministic } from "@/server/categorize";
import { computeSubscriptions } from "@/server/subscriptions";
import { computeAlerts } from "@/server/alerts";

type Parsed = ReturnType<typeof parseDbsStatement> & { text: string };
// Names that must never appear in the synthetic data. The list itself is private, so it lives in a
// git-ignored file (tests/unit/real-names.local.json, a JSON array of strings); without it this check is skipped.
const REAL_NAMES_FILE = join(__dirname, "real-names.local.json");
const REAL_NAMES: string[] = existsSync(REAL_NAMES_FILE) ? JSON.parse(readFileSync(REAL_NAMES_FILE, "utf8")) : [];

let year: MonthStatement[];
let parsed: Parsed[];
let txns: Transaction[];

beforeAll(async () => {
  year = generateYear();
  parsed = await Promise.all(year.map(async (s) => {
    const { text } = await extractStatementText(await renderStatementPdf(s));
    return { ...parseDbsStatement(text), text };
  }));
  let id = 0;
  txns = parsed.flatMap((p) => categorizeDeterministic(p.rows, new Map()).map((c) => ({
    id: `t${String(id++).padStart(5, "0")}`, userId: "u", statementId: "s", date: c.date, description: c.description,
    counterparty: c.counterparty ?? null, amountCents: c.amountCents, category: c.category, subcategory: c.subcategory ?? null,
    confidence: c.confidence, needsReview: c.needsReview, source: c.source,
  })));
}, 30_000);

describe("synthetic 2067 statements", () => {
  it("parse + reconcile every month through the unchanged DBS parser", () => {
    expect(parsed).toHaveLength(12);
    parsed.forEach((p, i) => {
      const s = year[i]!;
      expect(p.text).toContain("SYNTHETIC SAMPLE");
      expect(p.rows.length).toBeGreaterThanOrEqual(60);
      expect(p.rows.length).toBeLessThanOrEqual(110);
      expect(p.rows.length).toBe(s.rows.length);
      expect(p.reconciled).toBe(true);
      expect(p.closing).toBe(p.finalBalance);
      expect(Math.round(p.closing! * 100)).toBe(s.closingCents);
      p.rows.forEach((r, j) => {
        expect(r.date.getUTCFullYear()).toBe(2067);
        expect(r.date.getUTCMonth()).toBe(i);
        expect(r.amountCents).toBe(s.rows[j]!.cents);
        expect(r.description).toBe(s.rows[j]!.description);
      });
    });
  });

  it("chains balances month to month from S$1,850.00 and never goes negative", () => {
    expect(year[0]!.openingCents).toBe(OPENING_CENTS);
    for (let i = 0; i < 11; i++) expect(year[i + 1]!.openingCents).toBe(year[i]!.closingCents);
    for (const s of year) for (const r of s.rows) expect(r.balanceCents).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic (byte-stable PDFs)", async () => {
    const a = await renderStatementPdf(generateYear()[0]!);
    const b = await renderStatementPdf(generateYear()[0]!);
    expect(a.equals(b)).toBe(true);
  });

  it("every narration template cleans to the intended payee", () => {
    for (const t of TEMPLATE_EXPECTATIONS) expect(cleanMerchant(t.description)).toBe(t.payee);
  });

  it("uses no real names", () => {
    const all = parsed.map((p) => p.text.toUpperCase()).join(" ");
    for (const n of REAL_NAMES) expect(all).not.toContain(n);
  });

  it("plants the stories the analytics should find", () => {
    const subs = computeSubscriptions(txns);
    const netflix = subs.items.find((s) => s.name === "NETFLIX.COM");
    expect(netflix?.priceChange).toEqual({ fromCents: 1398, toCents: 1798 });

    // computeAlerts slices to 8 by amount; the planted Boulder Barn (2 x 68.00) and DECATHLON (129.00) sizes keep both in the top 8.
    const alerts = computeAlerts(txns);
    expect(alerts.some((a) => a.kind === "duplicate" && a.title.includes("DECATHLON"))).toBe(true);
    const fresh = alerts.filter((a) => a.kind === "new-merchant").map((a) => a.title);
    expect(fresh).toEqual(["New merchant: BOULDER BARN CLIMBING"]);

    const ong = txns.filter((t) => cleanMerchant(t.description) === "ONG BEE LIAN");
    expect(ong.length).toBeGreaterThan(150);
    expect(ong.every((t) => t.needsReview)).toBe(true);
    expect(txns.some((t) => cleanMerchant(t.description) === "LAPTOP WORLD" && t.amountCents === -149_900)).toBe(true);
  });
});
