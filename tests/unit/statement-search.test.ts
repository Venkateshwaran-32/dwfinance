import { describe, expect, it } from "vitest";
import { buildSearch, csvCell, matches, parseQuery, paymentType, sortRows, type TxnLike } from "@/server/statement-search";

const t = (description: string, amountCents: number, category: string, date = "2067-11-05", needsReview = false): TxnLike =>
  ({ date: new Date(`${date}T00:00:00Z`), description, counterparty: null, amountCents, category, needsReview });

const ONG = t("Advice FAST Payment / Receipt PAYNOW TRANSFER 5992280 TO: ONG BEE LIAN", -390, "Food & Dining", "2067-11-01", true);
const GRAB = t("Debit Card Transaction GRAB RIDES SI SINGAPORE", -2225, "Transport", "2067-11-03");
const GRABFOOD = t("Debit Card Transaction GRABFOOD SI SINGAPORE", -1890, "Food & Dining", "2067-11-04");
const LAPTOP = t("Debit Card Transaction LAPTOP WORLD SI SINGAPORE", -149900, "Other", "2067-08-06");
const PAY = t("Advice GIRO SALARY 8868082 FROM: BRIGHTLEAF TUITION PTE LTD", 69000, "Income", "2067-12-25");
const NETS = t("Advice Point-Of-Sale Transaction or Proceeds NETS QR PAYMENT 676897403205337 TO: SPINE DRINK STALL", -800, "Food & Dining", "2067-12-01");
const ALL = [ONG, GRAB, GRABFOOD, LAPTOP, PAY, NETS];
const hits = (sp: Parameters<typeof buildSearch>[0]) => { const s = buildSearch(sp); return ALL.filter((x) => matches(s, x)); };

describe("parseQuery", () => {
  it("splits words, phrases, exclusions and amount operators", () => {
    expect(parseQuery('grab -food "ong bee" >50')).toEqual({ include: ["grab", "ong bee"], exclude: ["food"], minCents: 5001, maxCents: null });
    expect(parseQuery("10..20")).toMatchObject({ minCents: 1000, maxCents: 2000 });
    expect(parseQuery("20..10")).toMatchObject({ minCents: 1000, maxCents: 2000 });
    expect(parseQuery("=3.90")).toMatchObject({ minCents: 390, maxCents: 390 });
    expect(parseQuery("<=S$10 >=$2")).toMatchObject({ minCents: 200, maxCents: 1000 });
    expect(parseQuery('-"spine drink"')).toMatchObject({ include: [], exclude: ["spine drink"] });
    expect(parseQuery("7-eleven 8868082")).toMatchObject({ include: ["7-eleven", "8868082"], minCents: null }); // bare numbers stay text
  });
});

describe("matches", () => {
  it("is off when nothing is filtered", () => {
    expect(hits({})).toEqual([]);
    expect(buildSearch({ sort: "largest", group: "payee", all: "1" }).active).toBe(false);
  });
  it("requires every word, matches category names, and honours exclusions", () => {
    expect(hits({ q: "grab" })).toEqual([GRAB, GRABFOOD]);
    expect(hits({ q: "grab -food" })).toEqual([GRAB]); // GRABFOOD is excluded by name and by its category
    expect(hits({ q: "transport" })).toEqual([GRAB]);
    expect(hits({ q: '"ong bee lian"' })).toEqual([ONG]);
    expect(hits({ q: "card", not: "grab laptop" })).toEqual([]);
    expect(hits({ dir: "out", not: '"spine drink" grab' })).toEqual([ONG, LAPTOP]);
  });
  it("filters by amount from the box and the fields together (tightest wins)", () => {
    expect(hits({ q: ">100" })).toEqual([LAPTOP, PAY]);
    expect(hits({ q: ">10", max: "20" })).toEqual([GRABFOOD]);
    expect(hits({ q: "=3.90" })).toEqual([ONG]);
  });
  it("filters by direction, review flag, several categories and payment type", () => {
    expect(hits({ dir: "in" })).toEqual([PAY]);
    expect(hits({ review: "1" })).toEqual([ONG]);
    expect(hits({ cats: "Transport,Income,Nonsense" })).toEqual([GRAB, PAY]);
    expect(hits({ category: "Other", cats: "Income" })).toEqual([LAPTOP, PAY]);
    expect(hits({ type: "paynow,nets" })).toEqual([ONG, NETS]);
    expect(hits({ type: "giro" })).toEqual([PAY]);
  });
  it("filters by month or by a custom date range (month wins)", () => {
    expect(hits({ month: "2067-11" })).toEqual([ONG, GRAB, GRABFOOD]);
    expect(hits({ from: "2067-11-03", to: "2067-12-01" })).toEqual([GRAB, GRABFOOD, NETS]);
    expect(hits({ month: "2067-08", from: "2067-11-03" })).toEqual([LAPTOP]);
    expect(buildSearch({ from: "not-a-date" }).active).toBe(false);
  });
});

describe("helpers", () => {
  it("reads the payment type from the narration", () => {
    expect([ONG, GRAB, PAY, NETS].map((x) => paymentType(x.description))).toEqual(["paynow", "card", "giro", "nets"]);
    expect(paymentType("Advice Bill Payment NTU HALL OF RESIDENCE FEES")).toBe("bill");
    expect(paymentType("Advice Funds Transfer FT260604MB53388786")).toBe("transfer");
    expect(paymentType("Interest Earned")).toBe("other");
  });
  it("sorts by date or absolute amount", () => {
    expect(sortRows(ALL, "largest").slice(0, 2)).toEqual([LAPTOP, PAY]);
    expect(sortRows(ALL, "smallest")[0]).toBe(ONG);
    expect(sortRows(ALL, "newest")[0]).toBe(PAY);
    expect(sortRows(ALL, "default")[0]).toBe(LAPTOP);
  });
  it("makes CSV cells safe", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("\"'=HYPERLINK(1)\"");
    expect(csvCell(-3.9)).toBe('"-3.9"');
  });
});
