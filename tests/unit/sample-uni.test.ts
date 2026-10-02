import { describe, it, expect, beforeAll } from "vitest";
import type { Transaction } from "@prisma/client";
import { generateYear, renderStatementPdf, tpl, OPENING_CENTS } from "../../scripts/sample-2067";
import { generateUni, UNI, UNI_CARD_MERCHANTS, YEARS, type UniStatement } from "../../scripts/sample-uni";
import { extractStatementText } from "@/server/parse-statement";
import { parseDbsStatement } from "@/server/parse-dbs";
import { cleanMerchant } from "@/server/merchants";
import { categorizeDeterministic } from "@/server/categorize";
import { computeSubscriptions } from "@/server/subscriptions";
import { computeInsights } from "@/server/insights";

let all: UniStatement[];
const txns: Transaction[] = [];
const spend = (s: UniStatement) => s.rows.reduce((n, r) => n + (r.cents < 0 ? -r.cents : 0), 0);
const income = (s: UniStatement) => s.rows.reduce((n, r) => n + (r.cents > 0 ? r.cents : 0), 0);
const of = (y: number) => all.filter((s) => s.year === y);

beforeAll(async () => {
  all = generateUni();
  let id = 0;
  for (const s of all.filter((x) => x.year !== 2067)) {
    const { text } = await extractStatementText(await renderStatementPdf(s));
    const parsed = parseDbsStatement(text);
    expect(parsed.reconciled, `${s.year}-${s.month} reconciles`).toBe(true);
    expect(parsed.issues, `${s.year}-${s.month} passes every check`).toEqual([]);
    expect(parsed.rows.length).toBe(s.rows.length);
    parsed.rows.forEach((r, i) => {
      expect(r.amountCents).toBe(s.rows[i]!.cents);
      expect(r.description).toBe(s.rows[i]!.description);
      expect(r.date.toISOString().slice(0, 7)).toBe(`${s.year}-${String(s.month).padStart(2, "0")}`);
    });
    expect(text).toContain("SYNTHETIC SAMPLE");
    for (const c of categorizeDeterministic(parsed.rows, new Map())) {
      txns.push({ id: `t${id++}`, userId: "u", statementId: "s", date: c.date, description: c.description, counterparty: null, amountCents: c.amountCents,
        category: c.category, subcategory: c.subcategory ?? null, confidence: c.confidence, needsReview: c.needsReview, source: c.source } as Transaction);
    }
  }
}, 60_000);

describe("four synthetic uni years", () => {
  it("is 48 statements, with year 1 exactly the original 2067 data", () => {
    expect(all).toHaveLength(48);
    expect(YEARS.map((y) => of(y).length)).toEqual([12, 12, 12, 12]);
    expect(of(2067).map(({ year: _y, ...s }) => s)).toEqual(generateYear());
    expect(generateUni()).toEqual(all); // deterministic
  });

  it("chains balances across all four years and never goes negative", () => {
    expect(all[0]!.openingCents).toBe(OPENING_CENTS);
    all.forEach((s, i) => {
      if (i > 0) expect(s.openingCents).toBe(all[i - 1]!.closingCents);
      expect(s.closingCents).toBe(s.openingCents + s.rows.reduce((n, r) => n + r.cents, 0));
      expect(Math.min(...s.rows.map((r) => r.balanceCents))).toBeGreaterThanOrEqual(0);
    });
  });

  it("is bumpier after year 1: overspent months, skipped pay, wider swings", () => {
    const later = all.filter((s) => s.year !== 2067);
    expect(later.filter((s) => spend(s) > income(s)).length).toBeGreaterThanOrEqual(10);
    expect(later.filter((s) => !s.rows.some((r) => r.description.includes("GIRO SALARY"))).length).toBeGreaterThanOrEqual(2);
    const spends = later.map(spend);
    expect(Math.max(...spends) / Math.min(...spends)).toBeGreaterThan(3);
    // prices creep up: the hawker costs more in 2070 than in 2068
    const avg = (y: number) => { const r = of(y).flatMap((s) => s.rows).filter((x) => x.description.endsWith("TO: ONG BEE LIAN")); return r.reduce((n, x) => n - x.cents, 0) / r.length; };
    expect(avg(2070)).toBeGreaterThan(avg(2068));
  });

  it("carries the planted story: internship, trips, phone, ang bao, cancelled gym pass", () => {
    const has = (y: number, m: number, needle: string) => of(y)[m - 1]!.rows.some((r) => r.description.includes(needle));
    for (const m of [5, 6, 7]) expect(has(2069, m, `FROM: ${UNI.intern}`)).toBe(true);
    expect(has(2069, 8, UNI.intern)).toBe(false);
    expect(has(2068, 6, "SCOOT") && has(2069, 12, "AGODA") && has(2070, 6, "KLOOK TRAVEL")).toBe(true);
    expect(has(2069, 3, "PHONE HUB")).toBe(true);
    for (const y of [2068, 2069, 2070]) expect(of(y)[1]!.rows.filter((r) => UNI.relatives.some((rel) => r.description.endsWith(`FROM: ${rel}`))).length).toBeGreaterThanOrEqual(2);
    expect(has(2069, 6, "BOULDER BARN CLIMBING")).toBe(true);
    expect(has(2069, 7, "BOULDER BARN CLIMBING")).toBe(false);
    expect(of(2070)[9]!.rows.filter((r) => r.day === 17 && r.cents === -1350 && r.description.includes("SHAW THEATRES JEM")).length).toBeGreaterThanOrEqual(2);
  });

  it("gives every new merchant a clean payee name", () => {
    for (const m of UNI_CARD_MERCHANTS) expect(cleanMerchant(tpl.card(m), null)).toBe(m);
    for (const p of [...UNI.relatives, UNI.friend]) expect(cleanMerchant(tpl.paynowIn("7781042", p), null)).toBe(p);
    for (const c of [UNI.intern, UNI.research]) expect(cleanMerchant(tpl.salary("3390871", c), null)).toBe(c);
  });

  it("puts the latest-month findings in December 2070 for the existing analytics", () => {
    const spotify = computeSubscriptions(txns).items.find((x) => /spotify/i.test(x.name));
    expect(spotify?.priceChange).toMatchObject({ fromCents: 1098, toCents: 1398 });
    const subs = computeSubscriptions(txns).items.map((x) => x.name);
    expect(subs).not.toContain("BOULDER BARN CLIMBING"); // cancelled in mid-2069
    expect(computeInsights(txns).some((i) => i.tone === "new" && i.text.includes("SKYLINE CO-LIVING"))).toBe(true);
    const cats = new Map<string, number>();
    for (const t of txns) cats.set(t.category, (cats.get(t.category) ?? 0) + 1);
    expect(cats.get("Telecom")).toBe(24); // SIMBA TELECOM, monthly from 2069
    expect(cats.get("Health")).toBe(1);
  });
});
