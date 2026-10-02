import "server-only";
import { z } from "zod";
import { log } from "@/lib/logger";
import { ruleCategorize, isPayNowToPerson, normalizeKey, type Cat } from "./merchants";
import { ChatError, chatJson as chat, loadedModel } from "./llm";
import { strictIsoDate } from "./parse-statement";

export type RawTxn = { description: string; counterparty?: string | null; amountCents: number; date: Date; note?: string }; // note = failed a check
export type Categorized = RawTxn & {
  category: string; subcategory?: string; confidence: number; needsReview: boolean;
  source: "rule" | "ai" | "fallback" | "user";
};

const CATEGORIES = [
  "Groceries", "Transport", "Food & Dining", "Utilities", "Telecom", "Shopping",
  "Subscriptions", "Health", "Income", "Cash", "Transfers", "Other",
] as const;

const aiResult = z.object({
  index: z.number(), category: z.enum(CATEGORIES), subcategory: z.string().optional(),
  confidence: z.number().min(0).max(1), needsReview: z.boolean(),
});

// Deterministic-first ladder (simple/regex path): saved rules -> SG rules -> local AI -> heuristic.
export async function categorize(rows: RawTxn[], savedRules: Map<string, Cat>): Promise<Categorized[]> {
  const out: Categorized[] = [];
  const ambiguous: { i: number; row: RawTxn }[] = [];
  rows.forEach((row, i) => {
    const saved = savedRules.get(normalizeKey(row.description, row.counterparty));
    if (saved) { out[i] = { ...row, ...saved, confidence: 1, needsReview: false, source: "user" }; return; }
    const rule = ruleCategorize(row.description, row.counterparty);
    if (rule) { out[i] = { ...row, ...rule, confidence: 0.9, needsReview: false, source: "rule" }; return; }
    ambiguous.push({ i, row });
    out[i] = { ...row, ...heuristic(row), source: "fallback" };
  });
  if (ambiguous.length) {
    try {
      const aiCats = await aiCategorize(ambiguous.map((a) => a.row));
      for (const r of aiCats) { const t = ambiguous[r.index]; if (t) out[t.i] = { ...t.row, category: r.category, subcategory: r.subcategory, confidence: r.confidence, needsReview: r.needsReview, source: "ai" }; }
    } catch (e) { log.warn("local AI categorize unavailable, keeping heuristic", String(e)); }
  }
  return out;
}

// Deterministic categorization (saved rule -> SG keyword rule -> heuristic), NO AI call.
// Used for the fast DBS parser path so a clean statement never waits on the local model.
export function categorizeDeterministic(rows: RawTxn[], savedRules: Map<string, Cat>): Categorized[] {
  return rows.map((row) => {
    const saved = savedRules.get(normalizeKey(row.description, row.counterparty));
    if (saved) return { ...row, ...saved, confidence: 1, needsReview: false, source: "user" };
    const rule = ruleCategorize(row.description, row.counterparty);
    if (rule) return { ...row, ...rule, confidence: 0.9, needsReview: false, source: "rule" };
    return { ...row, ...heuristic(row), source: "fallback" };
  });
}

function heuristic(row: RawTxn): { category: string; subcategory?: string; confidence: number; needsReview: boolean } {
  if (isPayNowToPerson(row.description, row.counterparty)) {
    const food = Math.abs(row.amountCents) <= 2000;
    return { category: food ? "Food & Dining" : "Transfers", subcategory: "PayNow", confidence: 0.4, needsReview: true };
  }
  if (row.amountCents > 0) return { category: "Income", confidence: 0.5, needsReview: true };
  return { category: "Other", confidence: 0.3, needsReview: true };
}

// --- Per-row AI categorizer (the "AI brain" that reasons about leftovers) ---
async function aiCategorize(rows: RawTxn[]): Promise<z.infer<typeof aiResult>[]> {
  const model = await loadedModel();
  const items = rows.map((r, index) => ({ index, description: r.description, counterparty: r.counterparty ?? null, amountSGD: r.amountCents / 100 }));
  const data = await chat(model, 3000,
    `Categorize Singapore bank transactions into exactly one of: ${CATEGORIES.join(", ")}.
Use common sense on the merchant name, even inside NETS QR / PayNow narration:
- stalls, hawkers, kopitiam, food courts, "drink stall", "beverages", bakeries, restaurants, cafes -> Food & Dining
- NTUC/FairPrice/Sheng Siong/Giant/7-Eleven/Cheers -> Groceries
- Grab/Gojek/MRT/bus/EZ-Link/petrol -> Transport
- PayNow/transfer to a NAMED INDIVIDUAL (a person's name) -> Transfers, needsReview=true, confidence<=0.6
Only use "Other" when the name is genuinely meaningless. JSON only.`,
    JSON.stringify(items),
    { type: "object", additionalProperties: false, properties: { results: { type: "array", items: { type: "object", additionalProperties: false, properties: { index: { type: "integer" }, category: { type: "string", enum: [...CATEGORIES] }, confidence: { type: "number" }, needsReview: { type: "boolean" } }, required: ["index", "category", "confidence", "needsReview"] } } }, required: ["results"] });
  const parsed = JSON.parse(data) as { results?: unknown[] };
  return (parsed.results ?? []).map((r) => aiResult.parse(r));
}

// --- AI EXTRACTION for real statements: CHUNKED so each call stays well under node's 5-min fetch timeout ---
const aiTxn = z.object({ date: z.string(), description: z.string(), counterparty: z.string().optional().nullable(), amountSGD: z.number() });

const EXTRACT_SYS = `Read raw text from a Singapore bank statement (DBS/POSB/OCBC/UOB) and return EVERY transaction in this fragment.
amountSGD: negative for debit/withdrawal/DR/payment, positive for credit/deposit/CR.
date: YYYY-MM-DD (use 2026 if only day/month shown). counterparty: payee/merchant name (or "").
Ignore opening/closing balances, totals, headers, interest summaries. No transactions in the fragment -> empty list. JSON only.`;

const EXTRACT_SCHEMA = { type: "object", additionalProperties: false, properties: { transactions: { type: "array", items: { type: "object", additionalProperties: false, properties: { date: { type: "string" }, description: { type: "string" }, counterparty: { type: "string" }, amountSGD: { type: "number" } }, required: ["date", "description", "counterparty", "amountSGD"] } } }, required: ["transactions"] };

// Smaller chunks = each call generates less JSON = finishes well under the timeout (reliable).
function chunkText(t: string, size = 4200, overlap = 400): string[] {
  if (t.length <= size) return [t];
  const out: string[] = [];
  for (let i = 0; i < t.length; i += size - overlap) out.push(t.slice(i, i + size));
  return out;
}

const PING_SCHEMA = { type: "object", additionalProperties: false, properties: { ok: { type: "string" } }, required: ["ok"] };

export async function aiExtractStatement(text: string, savedRules: Map<string, Cat>, onProgress?: () => void | Promise<void>): Promise<Categorized[]> {
  const model = await loadedModel();

  // Pre-flight: confirm a chat model actually responds, so a misconfig fails in ~30s not 40 min.
  try {
    await chat(model, 4, "Health check. Reply with JSON only.", "ping", PING_SCHEMA, 30000);
  } catch (e) {
    if (e instanceof ChatError && e.reason === "unreachable")
      throw new Error("LM Studio isn't reachable on :1234 — open LM Studio and start the local server.");
    throw new Error("LM Studio is running but the model didn't respond — load a chat model (e.g. qwen) in LM Studio, not just the embedding model.");
  }

  const chunks = chunkText(text.slice(0, 160000));
  log.info("extract", `${text.length} chars -> ${chunks.length} chunks`);
  const seen = new Set<string>();
  const rows: RawTxn[] = [];
  let timeouts = 0;
  for (const ch of chunks) {
    let data: string | null = null;
    for (let attempt = 0; attempt < 2 && data === null; attempt++) {
      await onProgress?.(); // heartbeat before each model call (≤180s apart)
      try { data = await chat(model, 2600, EXTRACT_SYS, ch, EXTRACT_SCHEMA, 180000); }
      catch (e) { if (e instanceof ChatError && e.reason === "timeout") timeouts++; log.warn("extract chunk failed", String(e)); }
    }
    if (data === null) continue;
    let parsed: { transactions?: unknown[] };
    try { parsed = JSON.parse(data); } catch { log.warn("extract chunk bad JSON"); continue; }
    for (const t of parsed.transactions ?? []) {
      const r = aiTxn.safeParse(t); if (!r.success) continue;
      const cents = Math.round(r.data.amountSGD * 100);
      const k = `${r.data.date}|${cents}|${(r.data.counterparty || r.data.description).slice(0, 24)}`;
      if (seen.has(k)) continue; seen.add(k);
      rows.push({ date: strictIsoDate(r.data.date), description: r.data.description, counterparty: r.data.counterparty ?? null, amountCents: cents });
    }
  }
  log.info("extract done", `${rows.length} rows, ${timeouts} timeouts`);
  if (rows.length === 0) {
    if (timeouts > 0) throw new Error("The local model was too slow — chunks timed out. Try a smaller/faster model in LM Studio (e.g. a 7B), or a shorter statement.");
    throw new Error("Couldn't read transactions from this statement — the layout may be unusual or the PDF is a scanned image.");
  }
  // Full ladder: saved rules -> SG keyword rules -> local AI reasons about the rest -> heuristic.
  return categorize(rows, savedRules);
}

export { CATEGORIES };
