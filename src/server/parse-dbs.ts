import "server-only";
import type { RawTxn } from "./categorize";
import { formatCents } from "@/lib/money";

const num = (s: string) => parseFloat(s.replace(/,/g, ""));
const cents = (s: string) => Math.round(num(s) * 100);
const sgd = (c: number) => (c < 0 ? `-${formatCents(-c)}` : formatCents(c));
const POSTING_LAG_DAYS = 10; // seen: up to 3 days on real DBS statements
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type DbsRow = RawTxn & { note?: string }; // note = this line failed a check; the caller sends it to Review
export type DbsParse = {
  rows: DbsRow[];
  reconciled: boolean;      // final running balance equals the statement's stated total
  closing: number | null;
  finalBalance: number | null;
  period: string | null;    // e.g. "Jan 2067", from "Account Summary as at 31 Jan 2067"
  issues: string[];         // plain-English problems found; empty = every check passed
};

// A real calendar date, or null for things like 32/01 or 30/02 (Date.UTC would silently roll them over).
function realDate(d: number, m: number, y: number): Date | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

// Deterministic DBS/POSB "Consolidated Statement" reader. Every transaction line carries the running balance,
// so each signed amount = new balance - previous balance (exact, no guessing which column a number sat in).
// It then checks its own work and reports, rather than hides, anything that does not add up:
//   - each line's printed amount must equal the change in balance (catches mistyped or merged lines),
//   - each page's brought-forward balance must continue the previous page (catches missing or repeated pages),
//   - the last balance must equal the statement's total,
//   - every date must be a real date inside the statement month.
export function parseDbsStatement(text: string): DbsParse {
  const issues: string[] = [];
  const closingM = text.match(/Total:\s*SGD Equivalent\s+(-?[\d,]+\.\d{2})/);
  const closing = closingM ? num(closingM[1]) : null;
  const asAt = text.match(/Account Summary as at\s+\d{1,2}\s+([A-Z][a-z]{2})\s+(\d{4})/);
  const stmtMonth = asAt && MONTHS.includes(asAt[1]) ? { m: MONTHS.indexOf(asAt[1]) + 1, y: +asAt[2] } : null;
  const startM = text.match(/Balance Brought Forward\s+SGD\s+(-?[\d,]+\.\d{2})/);
  let bal: number | null = startM ? cents(startM[1]) : null;
  const rows: DbsRow[] = [];

  // Amount and balance may be printed with no space between them when numbers are long ("9,999.991,234.00").
  const TOKEN = /Balance (Brought|Carried) Forward\s+SGD\s+(-?[\d,]+\.\d{2})|(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s*(-?[\d,]+\.\d{2})(?=\s+\d{2}\/\d{2}\/\d{4}|\s+Balance|\s+Total|\s+Transaction Details|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    if (m[1] !== undefined) {
      const fwd = cents(m[2]);
      if (bal !== null && fwd !== bal) {
        issues.push(m[1] === "Brought"
          ? `The balance jumps from ${sgd(bal)} to ${sgd(fwd)} between pages, so a page may be missing, repeated or out of order.`
          : `A page ends at ${sgd(fwd)} but its lines add up to ${sgd(bal)}.`);
      }
      bal = fwd;
      continue;
    }
    const [, , , dd, mm, yyyy, desc, amountStr, balStr] = m;
    const description = desc.replace(/\s+/g, " ").trim();
    const newBal = cents(balStr);
    // The closing summary ("31/05/2024 1,533.72 Total Balance Carried Forward in SGD: ...") starts with a date like a
    // transaction does. It is a balance, not a payment: check continuity and move on.
    if (/(Carried|Brought) Forward/i.test(description)) {
      if (bal !== null && newBal !== bal) issues.push(`A page ends at ${sgd(newBal)} but its lines add up to ${sgd(bal)}.`);
      bal = newBal;
      continue;
    }
    const printed = cents(amountStr);
    let amountCents: number;
    let note: string | undefined;
    if (bal === null) {
      // No opening balance: the size is known but not whether money went in or out.
      amountCents = -printed;
      note = "Could not tell whether this was money in or out (the statement has no opening balance).";
      issues.push("The statement has no opening balance, so the first line's direction is a guess.");
    } else {
      amountCents = newBal - bal;
      if (Math.abs(amountCents) !== printed) {
        note = `The statement prints ${sgd(printed)} but the balance changed by ${sgd(Math.abs(amountCents))}.`;
        issues.push(`${dd}/${mm}/${yyyy} ${description.slice(0, 40)}: ${note}`);
      }
    }
    bal = newBal;
    const date = realDate(+dd, +mm, +yyyy);
    if (!date) { issues.push(`${dd}/${mm}/${yyyy} is not a real date; that line (${sgd(Math.abs(amountCents))}) was left out.`); continue; }
    // Real statements carry a few lines dated just before the month (card payments posted a day or three late).
    if (stmtMonth && (date < new Date(Date.UTC(stmtMonth.y, stmtMonth.m - 1, 1 - POSTING_LAG_DAYS)) || date >= new Date(Date.UTC(stmtMonth.y, stmtMonth.m, 1)))) {
      note = note ?? `Dated outside the statement month (${MONTHS[stmtMonth.m - 1]} ${stmtMonth.y}).`;
      issues.push(`${dd}/${mm}/${yyyy} ${description.slice(0, 40)} is dated outside the statement month.`);
    }
    rows.push({ date, description, counterparty: null, amountCents, ...(note && { note }) });
  }

  const finalBalance = bal === null ? null : bal / 100;
  const reconciled = closing !== null && bal !== null && bal === Math.round(closing * 100);
  if (rows.length > 0 && !reconciled) {
    issues.push(closing === null
      ? "The statement's total balance could not be found, so the lines could not be checked against it."
      : `The lines add up to a final balance of ${sgd(bal ?? 0)}, but the statement says ${sgd(Math.round(closing * 100))}.`);
  }
  return { rows, reconciled, closing, finalBalance, period: stmtMonth ? `${MONTHS[stmtMonth.m - 1]} ${stmtMonth.y}` : null, issues: [...new Set(issues)] };
}
