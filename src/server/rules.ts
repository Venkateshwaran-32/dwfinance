import "server-only";
import { db } from "@/lib/db";
import { CATEGORIES } from "./categorize";
import { cleanMerchant, normalizeKey } from "./merchants";

// "Teach once, sticks forever" payee rules. Matching is by normalizeKey (computed in JS — SQLite can't),
// so DBS rows that differ only by an embedded reference number all resolve to the same payee.
// Every query is scoped by userId; updates go by id list so nothing outside the match is touched.

export type PayeeCandidate = { matchKey: string; payee: string; count: number };
export type PayeePreview = {
  matchKey: string; payee: string; category: string; count: number; alreadyCount: number;
  samples: { date: string; description: string; amountCents: number; category: string }[];
};

const CHUNK = 500;
const MAX_KEY = 64;

function assertCategory(category: string): void {
  if (!(CATEGORIES as readonly string[]).includes(category)) throw new Error(`Invalid category: ${category}`);
}

function assertKey(matchKey: string): void {
  if (typeof matchKey !== "string" || !matchKey.trim() || matchKey.length > MAX_KEY) throw new Error("Invalid matchKey");
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export async function resolvePayee(userId: string, text: string): Promise<PayeeCandidate[]> {
  const q = plain(String(text ?? "").slice(0, 200));
  if (!userId || !q) return [];
  const tokens = q.split(" ");
  const rows = await db.transaction.findMany({ where: { userId }, select: { description: true, counterparty: true } });
  const groups = new Map<string, PayeeCandidate>();
  for (const r of rows) {
    const key = normalizeKey(r.description, r.counterparty);
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { matchKey: key, payee: cleanMerchant(r.description, r.counterparty), count: 1 });
  }
  const scored: { c: PayeeCandidate; score: number }[] = [];
  for (const c of groups.values()) {
    const hay = plain(c.matchKey);
    let score: number;
    if (hay === q) score = 3;
    else {
      const hit = tokens.filter((t) => hay.includes(t)).length;
      if (!hit) continue;
      score = hit === tokens.length ? 2 : hit / tokens.length; // partial overlap stays below 1
    }
    scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || b.c.count - a.c.count || a.c.matchKey.localeCompare(b.c.matchKey));
  return scored.slice(0, 5).map((s) => s.c);
}

async function matchingTxns(userId: string, matchKey: string) {
  const rows = await db.transaction.findMany({
    where: { userId },
    select: { id: true, date: true, description: true, counterparty: true, amountCents: true, category: true, needsReview: true },
    orderBy: { date: "desc" },
  });
  return rows.filter((r) => normalizeKey(r.description, r.counterparty) === matchKey);
}

export async function previewPayeeRule(userId: string, matchKey: string, category: string): Promise<PayeePreview> {
  assertKey(matchKey);
  assertCategory(category);
  const hits = await matchingTxns(userId, matchKey);
  return {
    matchKey,
    payee: hits.length ? cleanMerchant(hits[0].description, hits[0].counterparty) : matchKey,
    category,
    count: hits.length,
    // Only rows the user (or a saved rule) has settled count; a heuristic guess still waiting in review does not.
    alreadyCount: hits.filter((r) => r.category === category && !r.needsReview).length,
    samples: hits.slice(0, 5).map((r) => ({
      date: r.date.toISOString().slice(0, 10), description: r.description, amountCents: r.amountCents, category: r.category,
    })),
  };
}

export async function applyPayeeRule(userId: string, matchKey: string, category: string): Promise<{ updated: number }> {
  assertKey(matchKey);
  assertCategory(category);
  if (!userId) throw new Error("Missing userId");
  const ids = (await matchingTxns(userId, matchKey)).map((r) => r.id);
  const updates = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    updates.push(db.transaction.updateMany({
      where: { userId, id: { in: ids.slice(i, i + CHUNK) } },
      data: { category, needsReview: false, source: "user", confidence: 1 },
    }));
  }
  const res = await db.$transaction([
    db.merchantRule.upsert({
      where: { userId_matchKey: { userId, matchKey } },
      create: { userId, matchKey, category },
      update: { category },
    }),
    ...updates,
  ]);
  const updated = res.slice(1).reduce((n, r) => n + (r as { count: number }).count, 0);
  return { updated };
}
