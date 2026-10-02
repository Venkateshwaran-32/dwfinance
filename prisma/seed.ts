// Demo account pre-loaded with 2 months of synthetic transactions.
// Standalone (no server-only imports): own PrismaClient + bcryptjs + the shared sample data.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { genRows } from "../scripts/sample-data";

const db = new PrismaClient();
const EMAIL = "demo@dwfinance.local";
const PASSWORD = "Password123!";

async function main() {
  await db.user.deleteMany({ where: { email: EMAIL } }); // idempotent (cascades to statements/txns/rules)
  const user = await db.user.create({
    data: { email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 12) },
  });
  const statement = await db.statement.create({ data: { userId: user.id, period: "2026-04-01 to 2026-05-31" } });
  await db.transaction.createMany({
    data: genRows().map((r) => ({
      userId: user.id, statementId: statement.id, date: new Date(r.date), description: r.description,
      counterparty: r.counterparty, amountCents: r.amountCents, category: r.category,
      needsReview: r.needsReview, source: r.needsReview ? "fallback" : "rule",
      confidence: r.needsReview ? 0.4 : 0.9,
    })),
  });
  console.log(`seeded ${EMAIL} / ${PASSWORD} with ${genRows().length} transactions`);
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
