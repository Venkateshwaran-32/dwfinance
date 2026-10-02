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
  it("routes outgoing rent, hall fees and co-living to Housing", () => {
    const h = (d: string) => ruleCategorize(d, null, -50_000)?.category;
    expect(h("Advice Bill Payment NTU HALL OF RESIDENCE FEES 8326123")).toBe("Housing"); // not Education
    expect(h("Debit Card Transaction SKYLINE CO-LIVING SI SINGAPORE")).toBe("Housing");
    expect(h("GIRO Payment COLIVING SPACES PTE LTD")).toBe("Housing");
    expect(h("PAYNOW TRANSFER TO: LANDLORD TAN")).toBe("Housing");
    expect(h("GIRO MONTHLY RENT BLK 123")).toBe("Housing");
    expect(h("YMCA HOSTEL")).toBe("Housing");
    expect(h("ABC PROPERTY MGMT")).toBe("Housing");
    expect(h("GIRO JURONG-CLEMENTI TOWN COUNCIL")).toBe("Housing");
    expect(h("GIRO HDB LOAN")).toBe("Housing");
  });
  it("does not over-match Housing keywords inside other words", () => {
    expect(ruleCategorize("Debit Card Transaction 7-ELEVEN NTU HALL SI SINGAPORE", null, -500)?.category).toBe("Groceries");
    expect(ruleCategorize("CURRENT ACCOUNT FEE", null, -500)?.category).not.toBe("Housing");
    expect(ruleCategorize("SHDBX ELECTRICAL", null, -500)?.category).not.toBe("Housing");
  });
  it("routes outgoing fees, courses and textbooks to Education", () => {
    const e = (d: string) => ruleCategorize(d, null, -20_000)?.category;
    expect(e("GIRO NTU TUITION FEES")).toBe("Education");
    expect(e("SCHOOL FEES PAYMENT")).toBe("Education");
    expect(e("NANYANG TECHNOLOGICAL UNIVERSITY")).toBe("Education");
    expect(e("NGEE ANN POLYTECHNIC")).toBe("Education");
    expect(e("COURSERA")).toBe("Education");
    expect(e("UDEMY ONLINE")).toBe("Education");
    expect(e("CAMPUS TEXTBOOK CENTRE")).toBe("Education");
    expect(e("SEAB EXAM FEE")).toBe("Education");
    // Picked Education over Shopping: a campus bookstore charge in a student statement is textbooks.
    expect(e("Debit Card Transaction POPULAR BOOKSTORE NTU SI SINGAPORE")).toBe("Education");
    expect(e("Debit Card Transaction POPULAR SI SINGAPORE")).toBe("Shopping"); // plain POPULAR keeps old rule
  });
  it("never turns money IN from a tuition centre into an Education expense", () => {
    expect(ruleCategorize("GIRO SALARY FROM: BRIGHTLEAF TUITION PTE LTD", null, 50_000)?.category).toBe("Income");
    expect(ruleCategorize("INCOMING PAYNOW FROM: BRIGHTLEAF TUITION PTE LTD", null, 50_000)?.category).not.toBe("Education");
    expect(ruleCategorize("AGODA REFUND", null, 12_000)?.category).not.toBe("Travel");
    // Direction unknown -> spend-only rules are skipped, not guessed.
    expect(ruleCategorize("NTU HALL OF RESIDENCE FEES")).toBeNull();
  });
  it("routes airlines, hotels and booking sites to Travel", () => {
    const t = (d: string) => ruleCategorize(d, null, -30_000)?.category;
    for (const d of ["SCOOT", "SINGAPORE AIRLINES", "JETSTAR ASIA", "AIRASIA BERHAD", "AGODA", "BOOKING.COM", "AIRBNB", "KLOOK TRAVEL",
      "TRIP.COM", "EXPEDIA", "MARINA HOTEL", "TRAVELOKA"]) expect(t(`Debit Card Transaction ${d} SI SINGAPORE`), d).toBe("Travel");
  });
  it("routes gadgets to Shopping", () => {
    expect(ruleCategorize("Debit Card Transaction LAPTOP WORLD SI SINGAPORE", null, -149_900)?.category).toBe("Shopping");
    expect(ruleCategorize("Debit Card Transaction PHONE HUB SI SINGAPORE", null, -119_900)?.category).toBe("Shopping");
    expect(ruleCategorize("SIM LIM ELECTRONICS", null, -5000)?.category).toBe("Shopping");
  });
});

describe("money sent to people", () => {
  it("counts PayNow to a person but not a NETS QR stall payment", async () => {
    const { isTransferToPerson } = await import("@/server/merchants");
    expect(isTransferToPerson("Advice FAST Payment / Receipt PAYNOW TRANSFER 5992280 TO: ONG BEE LIAN")).toBe(true);
    expect(isTransferToPerson("Advice Point-Of-Sale Transaction or Proceeds NETS QR PAYMENT 928920994985375 TO: AUNTY MAY NASI LEMAK")).toBe(false);
  });
});
