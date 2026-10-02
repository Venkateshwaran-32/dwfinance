import { describe, expect, it } from "vitest";
import type { Transaction } from "@prisma/client";
import { computeAlerts } from "@/server/alerts";

let n = 0;
const spend = (day: string, merchant: string, cents: number, category = "Shopping"): Transaction => ({
  id: `t${String(n++).padStart(5, "0")}`, userId: "u", statementId: "s", date: new Date(`${day}T00:00:00Z`),
  description: `Debit Card Transaction ${merchant} SI SINGAPORE`, counterparty: null, amountCents: -cents, category,
  subcategory: null, confidence: 0.9, needsReview: false, source: "rule",
} as Transaction);

// Ordinary weeks: small food and transport spends most days of 2067.
const background = (): Transaction[] => Array.from({ length: 200 }, (_, i) => {
  const d = new Date(Date.UTC(2067, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
  return spend(d, i % 2 ? "CANTEEN 2 MIXED RICE" : "KOI THE NTU", 500 + (i % 5) * 120, "Food");
});

describe("computeAlerts", () => {
  it("merges a big purchase and the spending spike it caused into one alert with reasons and a link", () => {
    const alerts = computeAlerts([...background(), spend("2067-05-06", "LAPTOP WORLD", 149_900)]);
    const laptop = alerts.filter((a) => a.date === "2067-05-06");
    expect(laptop).toHaveLength(1);
    expect(laptop[0]).toMatchObject({
      title: "LAPTOP WORLD", amountCents: -149_900, dateLabel: "6 May 2067", kind: "big",
      href: "/dashboard/statements?from=2067-05-06&to=2067-05-06&adv=1",
    });
    expect(laptop[0]!.reasons).toEqual(["Large one-off", "Biggest spending day of May 2067"]);
  });

  it("folds rent, the spike and the first payment to a new payee into one alert", () => {
    const alerts = computeAlerts([...background(), spend("2067-07-19", "SKYLINE CO-LIVING", 90_000, "Housing")]);
    expect(alerts.filter((a) => a.date === "2067-07-19")).toHaveLength(1);
    const rent = alerts.find((a) => a.date === "2067-07-19")!;
    expect(rent.kinds).toEqual(["big", "spike", "new-merchant"]);
    expect(rent.title).toBe("SKYLINE CO-LIVING");
  });

  it("keeps a lone new merchant as an informational alert", () => {
    const alerts = computeAlerts([...background(), spend("2067-07-09", "BOULDER BARN CLIMBING", 6800, "Leisure")]);
    expect(alerts.find((a) => a.kind === "new-merchant")?.title).toBe("New merchant: BOULDER BARN CLIMBING");
  });

  it("flags a same-day double charge but not the same cheap lunch two days running", () => {
    const alerts = computeAlerts([
      ...background(),
      spend("2067-06-18", "DECATHLON", 12_900), spend("2067-06-18", "DECATHLON", 12_900),
      spend("2067-06-20", "HAPPY DUCK NOODLE STALL", 630, "Food"), spend("2067-06-21", "HAPPY DUCK NOODLE STALL", 630, "Food"),
    ]);
    expect(alerts.some((a) => a.kind === "duplicate" && a.title === "DECATHLON")).toBe(true);
    expect(alerts.some((a) => a.title.includes("HAPPY DUCK"))).toBe(false);
  });

  it("does not flag a large bill paid regularly at about the same amount, and caps the list at 6", () => {
    const hall = ["2067-01-06", "2067-03-06", "2067-05-06"].map((d) => spend(d, "NTU HALL OF RESIDENCE FEES", 50_000, "Bills"));
    const gadgets = Array.from({ length: 9 }, (_, i) => spend(`2067-0${(i % 6) + 1}-${String(10 + i).padStart(2, "0")}`, `SHOP ${i}`, 40_000 + i * 1000));
    const alerts = computeAlerts([...background(), ...hall, ...gadgets]);
    expect(alerts).toHaveLength(6);
    expect(alerts.some((a) => a.title.includes("HALL"))).toBe(false);
    expect(alerts.map((a) => a.amountCents)).toEqual([...alerts.map((a) => a.amountCents)].sort((a, b) => a - b));
  });
});
