import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { getSessionUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { extractStatementText, regexRows, ParseError } from "@/server/parse-statement";
import { parseDbsStatement } from "@/server/parse-dbs";
import { categorize, categorizeDeterministic, aiExtractStatement, type Categorized } from "@/server/categorize";
import { log } from "@/lib/logger";
import { env } from "@/lib/env";
import { cleanMerchant, type Cat } from "@/server/merchants";

// Stable key for cross-upload de-duplication of a single transaction.
const txnKey = (date: Date, cents: number, desc: string, cp: string | null) =>
  `${date.toISOString().slice(0, 10)}|${cents}|${cleanMerchant(desc, cp).toLowerCase().slice(0, 24)}`;

export const runtime = "nodejs";
export const maxDuration = 600; // local AI extraction can take minutes

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "not authenticated" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no file" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "file too large (max 10MB)" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer()); // magic-byte + size validated in extractStatementText
  const fileName = file.name || "statement.pdf";

  // Track the upload as a server-side job so progress survives logout / refresh.
  const job = await db.uploadJob.create({ data: { userId, fileName, status: "processing" } });

  // Process in the background (not awaited) so the response returns immediately and the
  // work continues even if the client disconnects. The client polls /api/upload/status.
  void processStatement(userId, buf, job.id).catch(async () => {
    log.error("background upload crashed");
    await db.uploadJob.update({ where: { id: job.id }, data: { status: "error", error: "unexpected error", finishedAt: new Date() } }).catch(() => {});
  });

  return Response.json({ jobId: job.id }, { status: 202 });
}

async function processStatement(userId: string, buf: Buffer, jobId: string) {
  const fail = (error: string) =>
    db.uploadJob.update({ where: { id: jobId }, data: { status: "error", error, finishedAt: new Date() } }).catch(() => {});

  // De-dup #1: exact same file already uploaded?
  const fileHash = createHash("sha256").update(buf).digest("hex");
  const dupFile = await db.statement.findFirst({ where: { userId, fileHash } });
  if (dupFile) return fail(`You already uploaded this exact statement (on ${dupFile.uploadedAt.toISOString().slice(0, 10)}). Nothing new to add.`);

  let text: string, period: string;
  try {
    ({ text, period } = await extractStatementText(buf));
  } catch (e) {
    if (e instanceof ParseError) return fail(e.message);
    log.error("upload extract failed");
    return fail("could not process file");
  }

  // original PDF is never persisted (data minimization) — we keep only extracted rows.

  const savedRules = new Map<string, Cat>(
    (await db.merchantRule.findMany({ where: { userId } })).map((r) => [r.matchKey, { category: r.category, subcategory: r.subcategory ?? undefined }]),
  );

  const heartbeat = async () => { await db.uploadJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date() } }).catch(() => {}); };
  await heartbeat();

  let categorized: Categorized[];
  try {
    // Primary: deterministic DBS/POSB parser (instant, exact, reconciled, no AI).
    const dbs = parseDbsStatement(text);
    if (dbs.rows.length > 0) {
      log.info("dbs parser", `${dbs.rows.length} rows · reconciled=${dbs.reconciled}`);
      categorized = categorizeDeterministic(dbs.rows, savedRules);
    } else {
      // Fallbacks: simple pipe format -> regex; anything else -> local AI extraction.
      const rows = regexRows(text);
      if (rows.length > 0) categorized = await categorize(rows, savedRules);
      // Shared demo copy: reading an unknown layout with the local model takes minutes of compute per file,
      // so anyone with the link could tie the laptop up. Only the instant DBS/POSB path is open there.
      else if (env.DEMO_OPEN_EMAIL) return fail("This shared demo only reads DBS/POSB statements. Try one of the sample statements.");
      else categorized = await aiExtractStatement(text, savedRules, heartbeat);
    }
  } catch (e) {
    log.error("categorize/extract failed");
    return fail(e instanceof Error ? e.message : "Could not read this statement.");
  }
  if (categorized.length === 0) return fail("no transactions found in statement");

  // De-dup #2: skip transactions already present (handles overlapping statement periods).
  const existing = await db.transaction.findMany({ where: { userId }, select: { date: true, amountCents: true, description: true, counterparty: true } });
  const seen = new Set(existing.map((t) => txnKey(t.date, t.amountCents, t.description, t.counterparty)));
  const fresh = categorized.filter((t) => !seen.has(txnKey(t.date, t.amountCents, t.description, t.counterparty ?? null)));
  if (fresh.length === 0) return fail(`All ${categorized.length} transactions are already in your data — looks like a duplicate or fully-overlapping statement.`);

  const statement = await db.statement.create({ data: { userId, period, fileHash } });
  await db.transaction.createMany({
    data: fresh.map((t) => ({
      userId, statementId: statement.id, date: t.date, description: t.description,
      counterparty: t.counterparty ?? null, amountCents: t.amountCents, category: t.category,
      subcategory: t.subcategory ?? null, confidence: t.confidence, needsReview: t.needsReview, source: t.source,
    })),
  });
  const skipped = categorized.length - fresh.length;
  await db.uploadJob.update({ where: { id: jobId }, data: { status: "done", count: fresh.length, finishedAt: new Date() } });
  log.info("upload ok", `${fresh.length} new txns${skipped ? `, ${skipped} duplicates skipped` : ""}`);
}
