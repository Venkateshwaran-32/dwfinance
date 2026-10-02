import { describe, it, expect } from "vitest";
import { buildSpendTrend, isLargeOneOff, quantile, recurringPayees, type TrendTxn } from "@/lib/spend-trend";

const t = (ym: string, cents: number, payeeKey: string): TrendTxn => ({ date: new Date(`${ym}-15T00:00:00Z`), amountCents: cents, payeeKey });
const months = Array.from({ length: 14 }, (_, i) => `2067-${String((i % 12) + 1).padStart(2, "0")}`).slice(0, 12).concat(["2068-01", "2068-02"]);

describe("large one-off purchases", () => {
  const txns = [
    ...months.map((m) => t(m, -100_00, "food")),
    ...months.map((m) => t(m, -900_00, "rent")),       // S$900 every month: regular, never a one-off
    t("2067-08", -1499_00, "laptop world"),             // one-off
    t("2067-09", -299_99, "headphones"),                // under S$300: everyday
    t("2067-10", 5000_00, "employer"),                  // income: ignored
  ];
  const rec = recurringPayees(txns);
  it("treats a large charge that comes back at about the same amount as a regular bill", () => {
    expect(rec.has("rent")).toBe(true);
    expect(rec.has("laptop world")).toBe(false);
  });
  it("treats repeat large purchases of different sizes (trips) as one-offs", () => {
    const trips = [t("2068-06", -310_00, "agoda"), t("2069-12", -520_00, "agoda"), t("2070-06", -740_00, "agoda"), t("2070-02", -12_00, "agoda")];
    const fees = ["2067-08", "2068-01", "2068-08"].map((m, i) => t(m, -(480_00 + i * 20_00), "hall fees"));
    const r = recurringPayees([...trips, ...fees]);
    expect(r.has("agoda")).toBe(false);
    expect(r.has("hall fees")).toBe(true);
  });
  it("flags only large, non-regular payments", () => {
    expect(isLargeOneOff(t("2067-08", -1499_00, "laptop world"), rec)).toBe(true);
    expect(isLargeOneOff(t("2067-01", -900_00, "rent"), rec)).toBe(false);
    expect(isLargeOneOff(t("2067-09", -299_99, "headphones"), rec)).toBe(false);
  });
  it("splits each month into everyday and one-off, and every cent is counted once", () => {
    const tr = buildSpendTrend(txns, months);
    const aug = tr.find((m) => m.ym === "2067-08")!;
    expect(aug).toMatchObject({ everyday: 1000_00, oneOff: 1499_00, oneOffCount: 1 });
    const spent = txns.filter((x) => x.amountCents < 0).reduce((n, x) => n - x.amountCents, 0);
    expect(tr.reduce((n, m) => n + m.everyday + m.oneOff, 0)).toBe(spent);
  });
});

describe("usual month", () => {
  const vals = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 5000];
  const txns = vals.map((v, i) => t(months[i]!, -v * 10, "groceries")); // S$10 to S$500 a month: under the one-off size except the last
  const tr = buildSpendTrend(txns, months.slice(0, 13));
  it("has no usual month until there are 6 months of history", () => {
    expect(tr.slice(0, 6).every((m) => m.usualTotal === null)).toBe(true);
    expect(tr[6]!.usualTotal).not.toBeNull();
  });
  it("uses the median and middle half of the 12 months before, not the month itself", () => {
    expect(tr[12]!.usualEveryday).toEqual({ median: 65_00, low: 37_50, high: 92_50, unusual: 175_00 });
  });
  it("quantile interpolates", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(3); // rounds 2.5 to 3
    expect(quantile([10], 0.25)).toBe(10);
  });
});
