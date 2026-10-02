"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword, createSession, clearSession, getSessionUserId } from "@/lib/auth";
import { log } from "@/lib/logger";
import { env, fastAccessEnabled } from "@/lib/env";
import { CATEGORIES } from "@/server/categorize";

const credsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
});

export type ActionState = { error?: string };

export async function signupAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = credsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and a password of at least 8 characters." };
  const { email, password } = parsed.data;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists." };
  const user = await db.user.create({ data: { email, passwordHash: await hashPassword(password) } });
  await createSession(user.id);
  log.info("signup ok");
  redirect("/dashboard");
}

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = credsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const { email, password } = parsed.data;
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Wrong email or password." }; // same message either way (no user enumeration)
  }
  await createSession(user.id);
  redirect("/dashboard");
}

// "Fast access": one click straight into the dashboard, no password. This is a local desktop app with a
// single owner, so on a dev build we sign into the owner's account directly. Disabled in production.
export async function fastAccessAction(): Promise<void> {
  if (!fastAccessEnabled) redirect("/login");
  // No password here, so only ever from this computer. The app also binds to 127.0.0.1; this is the second lock
  // in case someone starts it with a network-facing --hostname.
  const host = ((await headers()).get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) redirect("/login");
  let user = env.FAST_ACCESS_EMAIL
    ? await db.user.findUnique({ where: { email: env.FAST_ACCESS_EMAIL } })
    : null;
  if (!user) {
    // Pick the real owner account: skip test fixtures (*@t.local), prefer the one with the most data.
    const candidates = await db.user.findMany({
      where: { NOT: { email: { endsWith: "@t.local" } } },
      select: { id: true, email: true, _count: { select: { transactions: true } } },
    });
    candidates.sort((a, b) => b._count.transactions - a._count.transactions);
    user = candidates[0] ? await db.user.findUnique({ where: { id: candidates[0].id } }) : null;
  }
  if (!user) {
    user = await db.user.create({
      data: { email: "local@dwfinance.local", passwordHash: await hashPassword(crypto.randomUUID()) },
    });
  }
  await createSession(user.id);
  log.info("fast access ok");
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/");
}

// Re-run the (now smarter) keyword categorizer over the user's existing transactions.
// Instant, no AI — fixes obvious ones (drink stall, beverages, food court...) that were stuck in Other.
export async function recategorizeAction(): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const { ruleCategorize, normalizeKey } = await import("@/server/merchants");
  const txns = await db.transaction.findMany({ where: { userId } });
  const rules = await db.merchantRule.findMany({ where: { userId } });
  const ruleMap = new Map(rules.map((r) => [r.matchKey, r.category]));
  let fixed = 0;
  for (const t of txns) {
    if (t.source === "user") continue; // never override a manual confirm
    const saved = ruleMap.get(normalizeKey(t.description, t.counterparty));
    const next = saved ?? ruleCategorize(t.description, t.counterparty)?.category;
    if (next && (next !== t.category || t.needsReview)) {
      await db.transaction.update({
        where: { id: t.id },
        data: { category: next, needsReview: false, source: saved ? "user" : "rule", confidence: 0.9 },
      });
      fixed++;
    }
  }
  log.info(`recategorize fixed ${fixed}`);
  revalidatePath("/dashboard/review");
  revalidatePath("/dashboard");
}

export async function confirmReviewAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const txnId = String(form.get("txnId") ?? "");
  const category = String(form.get("category") ?? "");
  if (!txnId || !category) return;
  const txn = await db.transaction.findFirst({ where: { id: txnId, userId } }); // ownership scoped
  if (!txn) return;
  if (!(CATEGORIES as readonly string[]).includes(category)) return;
  // Match by normalized payee key, not exact description: DBS narration carries a fresh reference number
  // per payment, so an exact match only fixed the one row that was confirmed.
  const { normalizeKey } = await import("@/server/merchants");
  const { applyPayeeRule } = await import("@/server/rules");
  await applyPayeeRule(userId, normalizeKey(txn.description, txn.counterparty), category);
  revalidatePath("/dashboard/review");
  revalidatePath("/dashboard");
}

// Delete one uploaded statement and its transactions (cascade). Saved category rules are kept, so
// re-uploading the same PDF later re-adds every row already categorised the way the user taught it.
export async function deleteStatementAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const statementId = String(form.get("statementId") ?? "");
  if (!statementId) return;
  const { count } = await db.statement.deleteMany({ where: { id: statementId, userId } }); // ownership scoped
  log.info(`statement deleted ${count}`);
  revalidatePath("/dashboard", "layout");
}
