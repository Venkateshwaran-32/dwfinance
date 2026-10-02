import "server-only";
import { parseAmountToCents } from "@/lib/money";
import type { RawTxn } from "./categorize";

export class ParseError extends Error {}

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

// Hardened intake: validate size + magic bytes BEFORE parsing untrusted input (ignore client Content-Type).
export function validatePdf(buf: Buffer): void {
  if (buf.byteLength === 0) throw new ParseError("empty file");
  if (buf.byteLength > MAX_BYTES) throw new ParseError("file too large");
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ParseError("not a PDF");
}

// Extract raw text + statement period. (AI extraction in categorize.ts handles real, messy layouts.)
export async function extractStatementText(buf: Buffer): Promise<{ text: string; period: string }> {
  validatePdf(buf);
  let text: string;
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const res = await extractText(pdf, { mergePages: true });
    text = Array.isArray(res.text) ? res.text.join("\n") : res.text;
  } catch {
    throw new ParseError("could not read PDF");
  }
  if (text.replace(/\s/g, "").length < 20) throw new ParseError("no extractable text (scanned/encrypted PDF?)");
  const pm = text.match(/Statement period:\s*([^\n|]+)/i);
  return { text, period: pm ? pm[1].trim() : "Statement" };
}

// Fast path: the simple pipe-delimited format ("YYYY-MM-DD | desc | counterparty | amount").
// Returns [] for real bank statements -> caller falls back to AI extraction.
export function regexRows(text: string): RawTxn[] {
  const rows: RawTxn[] = [];
  const re = /(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(-?[\d,]+\.\d{2})/g;
  for (const m of text.matchAll(re)) {
    const [, date, description, cpRaw, amount] = m;
    rows.push({
      date: new Date(date),
      description: description.trim(),
      counterparty: cpRaw.trim() === "-" ? null : cpRaw.trim(),
      amountCents: parseAmountToCents(amount),
    });
  }
  return rows;
}
