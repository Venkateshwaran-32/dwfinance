import { describe, it, expect } from "vitest";
import { parseDbsStatement } from "@/server/parse-dbs";
import { keepValidRows, strictIsoDate, regexRows } from "@/server/parse-statement";
import { parseQuery } from "@/server/statement-search";

// Hand-built DBS-style statement text with deliberate mistakes. Each case is something a damaged, edited or
// oddly printed PDF can produce; the reader must either read it correctly or say exactly what is wrong.
const H = "Consolidated Statement Account Summary as at 31 Jan 2067 Savings Account 900-1 Total: SGD Equivalent 1,040.00 Transaction Details Date Description Withdrawal (-) Deposit (+) Balance Balance Brought Forward SGD 1,000.00 ";
const row = (d: string, desc: string, amt: string, bal: string) => `${d} ${desc} ${amt} ${bal} `;
const KOI = row("02/01/2067", "Debit Card Transaction KOI THE NTU SI SINGAPORE", "10.00", "990.00");
const MUM = row("05/01/2067", "Advice FAST Payment / Receipt INCOMING PAYNOW REF 1 FROM: MUM", "100.00", "1,090.00");
const GRAB = row("09/01/2067", "Debit Card Transaction GRAB RIDES SI SINGAPORE", "50.00", "1,040.00");
const END = "Balance Carried Forward SGD 1,040.00";
const amounts = (t: string) => parseDbsStatement(t).rows.map((r) => r.amountCents);

describe("DBS reader: correct statements", () => {
  it("reads a clean statement with no issues", () => {
    const p = parseDbsStatement(H + KOI + MUM + GRAB + END);
    expect(amounts(H + KOI + MUM + GRAB + END)).toEqual([-1000, 10000, -5000]);
    expect(p.reconciled).toBe(true);
    expect(p.issues).toEqual([]);
    expect(p.period).toBe("Jan 2067");
  });
  it("reads an amount printed with no space before the balance", () => {
    const t = H + KOI + "05/01/2067 Advice INCOMING PAYNOW FROM: MUM 100.001,090.00 " + GRAB + END;
    expect(amounts(t)).toEqual([-1000, 10000, -5000]);
    expect(parseDbsStatement(t).issues).toEqual([]);
  });
  it("reads an overdrawn (negative) balance", () => {
    const t = H.replace("1,040.00", "20.00").replace("Forward SGD 1,000.00", "Forward SGD -20.00")
      + row("02/01/2067", "Debit Card Transaction KOI", "10.00", "-30.00") + row("05/01/2067", "Advice INCOMING PAYNOW FROM: MUM", "100.00", "70.00")
      + row("09/01/2067", "Debit Card Transaction GRAB", "50.00", "20.00") + "Balance Carried Forward SGD 20.00";
    expect(amounts(t)).toEqual([-1000, 10000, -5000]);
    expect(parseDbsStatement(t).issues).toEqual([]);
  });
});

describe("DBS reader: broken statements are reported, never silently accepted", () => {
  const issuesOf = (t: string) => parseDbsStatement(t).issues.join(" | ");
  it("flags a line whose printed amount disagrees with the balance change", () => {
    const p = parseDbsStatement(H + KOI + row("05/01/2067", "Advice INCOMING PAYNOW FROM: MUM", "999.00", "1,090.00") + GRAB + END);
    expect(p.rows[1]!.note).toMatch(/prints S\$999\.00 but the balance changed by S\$100\.00/);
    expect(p.issues).toHaveLength(1);
  });
  it("flags a missing page (the balance jumps)", () => {
    expect(issuesOf(H + KOI + "Balance Carried Forward SGD 990.00 Balance Brought Forward SGD 1,090.00 " + GRAB + END)).toMatch(/page may be missing/);
  });
  it("flags a repeated page", () => {
    const t = H + KOI + MUM + "Balance Carried Forward SGD 1,090.00 Balance Brought Forward SGD 990.00 " + MUM + GRAB.replace("1,040.00", "1,140.00") + "Balance Carried Forward SGD 1,140.00";
    expect(issuesOf(t)).toMatch(/page may be missing, repeated/);
    expect(parseDbsStatement(t).reconciled).toBe(false);
  });
  it("flags a total that does not match", () => {
    expect(issuesOf(H.replace("Equivalent 1,040.00", "Equivalent 1,090.00") + KOI + MUM + GRAB + END)).toMatch(/statement says S\$1,090\.00/);
  });
  it("flags a statement with no total", () => {
    expect(issuesOf(H.replace("Total: SGD Equivalent 1,040.00 ", "") + KOI + MUM + GRAB + END)).toMatch(/total balance could not be found/);
  });
  it("flags a missing opening balance and marks the first line as a guess", () => {
    const p = parseDbsStatement(H.replace("Balance Brought Forward SGD 1,000.00 ", "") + MUM.replace("1,090.00", "1,100.00") + row("09/01/2067", "Debit Card Transaction GRAB", "60.00", "1,040.00") + END);
    expect(p.rows[0]!.note).toMatch(/money in or out/);
    expect(p.issues.join()).toMatch(/no opening balance/);
  });
  it("leaves out impossible dates instead of rolling them into the next month", () => {
    for (const bad of ["32/01/2067", "30/02/2067", "05/13/2067"]) {
      const p = parseDbsStatement(H + KOI + MUM.replace("05/01/2067", bad) + GRAB + END);
      expect(p.rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2067-01-02", "2067-01-09"]);
      expect(p.issues.join()).toContain(`${bad} is not a real date`);
    }
  });
  it("accepts lines dated a few days before the month (normal posting delay)", () => {
    expect(parseDbsStatement(H.replace("Equivalent 1,040.00", "Equivalent 1,040.00") + row("29/12/2066", "Debit Card Transaction KOI", "10.00", "990.00") + MUM + GRAB + END).issues).toEqual([]);
  });
  it("does not read the closing summary line as a S$0.00 transaction", () => {
    const t = H + KOI + MUM + GRAB + "31/01/2067 1,040.00 Total Balance Carried Forward in SGD: 60.00 100.00 1,040.00 Transaction Details";
    expect(amounts(t)).toEqual([-1000, 10000, -5000]);
    expect(parseDbsStatement(t).issues).toEqual([]);
  });
  it("flags a line dated outside the statement month", () => {
    const p = parseDbsStatement(H + KOI + MUM.replace("05/01/2067", "05/01/1999") + GRAB + END);
    expect(p.rows[1]!.note).toMatch(/outside the statement month/);
  });
});

describe("other reading paths refuse impossible values", () => {
  it("strictIsoDate accepts real days only", () => {
    expect(strictIsoDate("2067-01-05").toISOString().slice(0, 10)).toBe("2067-01-05");
    for (const bad of ["2067-02-30", "2067-13-45", "2067-1-5", "abc", ""]) expect(isNaN(strictIsoDate(bad).getTime())).toBe(true);
  });
  it("drops pipe-format rows with impossible dates instead of crashing the upload", () => {
    const rows = regexRows("2067-13-45 | COFFEE | - | -3.50\n2067-02-30 | TEA | - | -2.00\n2067-01-05 | RENT | LANDLORD | -1,200.00");
    const kept = keepValidRows(rows);
    expect(kept.rows.map((r) => r.amountCents)).toEqual([-120000]);
    expect(kept.dropped).toBe(2);
  });
  it("drops non-finite amounts and absurd years", () => {
    const d = new Date(Date.UTC(2067, 0, 1));
    const kept = keepValidRows([{ date: d, description: "a", amountCents: NaN }, { date: new Date(Date.UTC(1850, 0, 1)), description: "b", amountCents: 1 }, { date: d, description: "c", amountCents: -5 }]);
    expect(kept.rows.map((r) => r.description)).toEqual(["c"]);
  });
});

describe("search box", () => {
  it("treats an unclosed quote as a phrase", () => {
    expect(parseQuery('"ong bee').include).toEqual(["ong bee"]);
  });
});
