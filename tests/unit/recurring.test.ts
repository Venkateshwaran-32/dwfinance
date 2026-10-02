import { describe, expect, it } from "vitest";
import { cadenceFromGap, computeRecurring, type RecurringInput } from "@/lib/recurring";

const DAY = 86_400_000;
const start = Date.UTC(2067, 0, 1);
const pay = (name: string, dayOffset: number, cents: number, category = "Other"): RecurringInput =>
  ({ name, date: new Date(start + dayOffset * DAY), amountCents: -cents, category });
const series = (name: string, every: number, count: number, cents: number | ((i: number) => number), category?: string) =>
  Array.from({ length: count }, (_, i) => pay(name, i * every, typeof cents === "number" ? cents : cents(i), category));
const find = (rows: RecurringInput[], name: string) => computeRecurring(rows).find((r) => r.name === name);

describe("cadenceFromGap", () => {
  it.each([
    [1, "daily"], [2, "daily"], [3, "a few times a week"], [7, "weekly"], [14, "fortnightly"], [21, "every 3 weeks"],
    [30, "monthly"], [61, "every 2 months"], [91, "every 3 months"], [183, "every 6 months"], [365, "yearly"],
  ])("%s days -> %s", (gap, label) => expect(cadenceFromGap(gap)).toBe(label));
});

describe("computeRecurring", () => {
  it("labels an almost-daily payee daily, not weekly", () => {
    // 708 payments over ~4 years: mostly 1-2 days apart, the odd 5-day gap pulled the old average over 2 days.
    const rows = Array.from({ length: 708 }, (_, i) => pay("ONG BEE LIAN", Math.floor(i * 2.06), 400 + (i % 7) * 50));
    expect(find(rows, "ONG BEE LIAN")).toMatchObject({ cadence: "daily", count: 708 });
  });

  it("uses the median gap, so bursts and long pauses do not distort the rhythm", () => {
    // Fortnightly orders with a few 3-month pauses: the average gap is ~monthly, the habit is fortnightly.
    const offsets = [0, 14, 28, 42, 140, 154, 168, 182, 280, 294, 308, 322];
    const rows = offsets.map((d, i) => pay("SHOPEE", d, 2000 + i * 137));
    expect(find(rows, "SHOPEE")?.cadence).toBe("fortnightly");
  });

  it("drops trips and gadgets: large charges that do not repeat at the same amount", () => {
    // The demo account's trips: one cheap flight under S$300 does not make the airline a regular payee.
    const rows = [pay("AGODA", 524, 31_000), pay("AGODA", 1072, 52_000), pay("AGODA", 1255, 74_000),
      pay("SCOOT", 523, 26_800), pay("SCOOT", 1071, 41_200), pay("SCOOT", 1254, 68_000)];
    expect(computeRecurring(rows)).toEqual([]);
  });

  it("drops a few smaller trip bookings at different amounts even when roughly yearly", () => {
    const rows = [pay("KLOOK TRAVEL", 525, 14_500), pay("KLOOK TRAVEL", 1073, 18_800), pay("KLOOK TRAVEL", 1256, 26_000)];
    expect(computeRecurring(rows)).toEqual([]);
  });

  it("keeps a large bill that repeats at about the same amount (rent, hall fees)", () => {
    const rows = series("NTU HALL OF RESIDENCE FEES", 183, 7, (i) => (i % 2 ? 53_000 : 50_000));
    expect(find(rows, "NTU HALL OF RESIDENCE FEES")).toMatchObject({ count: 7, cadence: "every 6 months" });
  });

  it("drops a few payments with an irregular rhythm, keeps a regular one", () => {
    const irregular = [pay("CAFE X", 0, 800), pay("CAFE X", 2, 800), pay("CAFE X", 400, 800)];
    const regular = series("SIMBA TELECOM", 30, 3, 1000);
    const out = computeRecurring([...irregular, ...regular]).map((r) => r.name);
    expect(out).toEqual(["SIMBA TELECOM"]);
  });

  it("keeps 6+ payments even when the rhythm is uneven", () => {
    const offsets = [0, 1, 2, 90, 200, 201];
    expect(find(offsets.map((d) => pay("GRAB RIDES", d, 1500)), "GRAB RIDES")).toBeDefined();
  });

  it("ignores income, sorts by total, caps the list and returns the latest payments first", () => {
    const rows = [
      ...series("NETFLIX.COM", 30, 20, 1798, "Subscriptions"),
      ...series("BUS/MRT", 1, 30, 200, "Transport"),
      { name: "SALARY", date: new Date(start), amountCents: 300_000, category: "Income" },
    ];
    const out = computeRecurring(rows, { limit: 1, maxInstances: 3 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "NETFLIX.COM", total: 1798 * 20, avg: 1798, cadence: "monthly", category: "Subscriptions" });
    expect(out[0]!.instances.map((x) => x.date)).toEqual(["2068-07-24", "2068-06-24", "2068-05-25"]);
  });
});
