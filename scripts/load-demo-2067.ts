// Load the synthetic statements (2067-2070; YEARS=2067,2068 to load fewer) into a demo user via the real parse + categorize path.
//   DATABASE_URL=file:./some.db npx tsx --tsconfig scripts/tsconfig.json scripts/load-demo-2067.ts
// Env: EMAIL (default demo2067@dwfinance.local), PASSWORD (default Password123!). Replaces that user.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { MONTHS, fileName } from "./sample-2067";
import { YEARS } from "./sample-uni";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const { db } = await import("@/lib/db");
  const { extractStatementText } = await import("@/server/parse-statement");
  const { parseDbsStatement } = await import("@/server/parse-dbs");
  const { categorizeDeterministic } = await import("@/server/categorize");

  const email = (process.env.EMAIL || "demo2067@dwfinance.local").toLowerCase();
  const password = process.env.PASSWORD || "Password123!";
  const years = process.env.YEARS ? process.env.YEARS.split(",").map(Number).filter((y) => (YEARS as readonly number[]).includes(y)) : [...YEARS];

  // Keep the same user row (and id) across resets so open browser sessions stay valid; wipe only its data.
  const passwordHash = await bcrypt.hash(password.slice(0, 72), 12);
  const user = await db.user.upsert({ where: { email }, create: { email, passwordHash }, update: { passwordHash } });
  await db.$transaction([
    db.transaction.deleteMany({ where: { userId: user.id } }),
    db.statement.deleteMany({ where: { userId: user.id } }),
    db.merchantRule.deleteMany({ where: { userId: user.id } }),
    db.uploadJob.deleteMany({ where: { userId: user.id } }),
  ]);

  let total = 0;
  for (const year of years) for (let m = 1; m <= 12; m++) {
    const path = join(process.cwd(), "public", "sample-statements", String(year), fileName(m, year));
    if (!existsSync(path)) throw new Error(`missing ${path} (run npm run gen:sample2067 first)`);
    const buf = readFileSync(path);
    const { text } = await extractStatementText(buf);
    const parsed = parseDbsStatement(text);
    const rules = await db.merchantRule.findMany({ where: { userId: user.id } });
    const saved = new Map(rules.map((r) => [r.matchKey, { category: r.category, subcategory: r.subcategory ?? undefined }]));
    const cats = categorizeDeterministic(parsed.rows, saved);
    await db.$transaction(async (tx) => {
      const st = await tx.statement.create({ data: { userId: user.id, period: `${MONTHS[m - 1]} ${year}`, fileHash: createHash("sha256").update(buf).digest("hex") } });
      await tx.transaction.createMany({
        data: cats.map((c) => ({
          userId: user.id, statementId: st.id, date: c.date, description: c.description, counterparty: c.counterparty ?? null,
          amountCents: c.amountCents, category: c.category, subcategory: c.subcategory ?? null, confidence: c.confidence,
          needsReview: c.needsReview, source: c.source,
        })),
      });
    });
    total += cats.length;
    if (!parsed.reconciled) throw new Error(`${fileName(m, year)} did not reconcile`);
    console.log(`${fileName(m, year)}  rows=${cats.length}  reconciled=${parsed.reconciled}  closing=${parsed.closing}`);
  }
  console.log(`loaded ${total} transactions for ${email}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
