import "server-only";
import type { RawTxn } from "./categorize";

const num = (s: string) => parseFloat(s.replace(/,/g, ""));

// Deterministic DBS/POSB "Consolidated Statement" parser. Every transaction line carries the
// running balance, so each signed amount = newBalance - prevBalance (exact), and the statement
// self-reconciles to the bank's stated closing balance. No AI, milliseconds per file.
export function parseDbsStatement(text: string): {
  rows: RawTxn[];
  reconciled: boolean;
  closing: number | null;
  finalBalance: number | null;
} {
  const closingM = text.match(/Total:\s*SGD Equivalent\s+([\d,]+\.\d{2})/);
  const closing = closingM ? num(closingM[1]) : null;
  const startM = text.match(/Balance Brought Forward\s+SGD\s+([\d,]+\.\d{2})/);
  let bal: number | null = startM ? num(startM[1]) : null;
  const rows: RawTxn[] = [];

  const TOKEN = /Balance (?:Brought|Carried) Forward\s+SGD\s+([\d,]+\.\d{2})|(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?=\s+\d{2}\/\d{2}\/\d{4}|\s+Balance|\s+Total|\s+Transaction Details|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    if (m[1] !== undefined) { bal = num(m[1]); continue; } // brought/carried forward -> balance continuity
    const newBal = num(m[7]);
    const cents = bal === null ? -Math.round(num(m[6]) * 100) : Math.round((newBal - bal) * 100);
    bal = newBal;
    rows.push({
      date: new Date(Date.UTC(+m[4], +m[3] - 1, +m[2])),
      description: m[5].replace(/\s+/g, " ").trim(),
      counterparty: null,
      amountCents: cents,
    });
  }

  const reconciled = closing !== null && bal !== null && Math.abs(bal - closing) < 0.01;
  return { rows, reconciled, closing, finalBalance: bal };
}
