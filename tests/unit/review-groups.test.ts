import { describe, it, expect } from "vitest";
import { groupReviewItems, parseShow, RECENT_LIMIT, type ReviewItem } from "@/lib/review-groups";
import { normalizeKey } from "@/server/merchants";

let n = 0;
const r = (iso: string, cents: number, description: string, category = "Transfers", counterparty: string | null = null): ReviewItem =>
  ({ id: `t${n++}`, date: new Date(`${iso}T00:00:00Z`), description, counterparty, amountCents: cents, category });

const ong = (iso: string, cents: number, ref: string, category = "Transfers") =>
  r(iso, cents, `OUTGOING PAYNOW REF ${ref} TO: ONG BEE LIAN`, category);

describe("groupReviewItems", () => {
  it("returns nothing for an empty queue", () => {
    expect(groupReviewItems([])).toEqual([]);
  });

  it("merges payments that differ only by reference number, keyed like applyPayeeRule", () => {
    const items = [ong("2026-01-03", -330, "95001"), ong("2026-02-04", -500, "95002"), ong("2026-03-05", -420, "95003")];
    const [g, ...rest] = groupReviewItems(items);
    expect(rest).toHaveLength(0);
    expect(g.count).toBe(3);
    expect(g.payee).toBe("ONG BEE LIAN");
    expect(g.matchKey).toBe(normalizeKey(items[0].description, null));
    expect(g.matchKey.length).toBeLessThanOrEqual(48);
  });

  it("sorts groups by number of payments, biggest first", () => {
    const items = [
      r("2026-01-01", -1000, "Debit Card Transaction NETFLIX.COM"),
      ...Array.from({ length: 4 }, (_, i) => ong(`2026-01-0${i + 1}`, -400, `9${i}000`)),
      r("2026-01-02", -200, "NETS QR PAYMENT 609001 TO: KOPI STALL"),
      r("2026-01-03", -250, "NETS QR PAYMENT 609002 TO: KOPI STALL"),
    ];
    expect(groupReviewItems(items).map((g) => g.count)).toEqual([4, 2, 1]);
  });

  it("reports the date range and the newest five payments, newest first", () => {
    const items = Array.from({ length: 8 }, (_, i) => ong(`2026-0${i + 1}-15`, -400, `8${i}000`));
    const [g] = groupReviewItems(items.reverse());
    expect(g.firstDate.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(g.lastDate.toISOString().slice(0, 10)).toBe("2026-08-15");
    expect(g.recent).toHaveLength(RECENT_LIMIT);
    expect(g.recent[0].date.toISOString().slice(0, 10)).toBe("2026-08-15");
  });

  it("uses min to max for small groups and trims outliers (p10 to p90) for big ones", () => {
    const small = groupReviewItems([ong("2026-01-01", -330, "1"), ong("2026-01-02", -500, "2")])[0];
    expect([small.lowCents, small.highCents]).toEqual([330, 500]);
    // 20 payments of S$4.00, plus one S$0.10 and one S$250.00 outlier
    const big = groupReviewItems([
      ...Array.from({ length: 20 }, (_, i) => ong("2026-02-01", -400, `x${i}`)),
      ong("2026-02-02", -10, "lo"), ong("2026-02-03", -25000, "hi"),
    ])[0];
    expect([big.lowCents, big.highCents]).toEqual([400, 400]);
  });

  it("suggests the most common current category and tracks money direction", () => {
    const [g] = groupReviewItems([
      ong("2026-01-01", -400, "1", "Food & Dining"), ong("2026-01-02", -400, "2", "Food & Dining"), ong("2026-01-03", 400, "3", "Transfers"),
    ]);
    expect(g.category).toBe("Food & Dining");
    expect(g.flow).toBe("mixed");
    const [inflow] = groupReviewItems([r("2026-01-01", 5000, "INCOMING PAYNOW REF 1 FROM: MISHRA AKSHAT")]);
    expect(inflow.flow).toBe("in");
  });
});

describe("parseShow", () => {
  it("defaults to 50 and steps in 50s, capped at what exists", () => {
    expect(parseShow(undefined, 400)).toBe(50);
    expect(parseShow("abc", 400)).toBe(50);
    expect(parseShow("-5", 400)).toBe(50);
    expect(parseShow("100", 400)).toBe(100);
    expect(parseShow("120", 400)).toBe(150);
    expect(parseShow("99999", 120)).toBe(150);
    expect(parseShow(["100", "200"], 400)).toBe(100);
  });
});
