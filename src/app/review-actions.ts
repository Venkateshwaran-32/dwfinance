"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { CATEGORIES } from "@/server/categorize";
import { normalizeKey } from "@/server/merchants";
import { applyPayeeRule } from "@/server/rules";

const MAX_KEY = 48;

// Confirm one category for every payment to a payee. Saved as a MerchantRule, so future uploads match too.
export async function confirmPayeeAction(form: FormData): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const matchKey = form.get("matchKey");
  const category = form.get("category");
  if (typeof matchKey !== "string" || !matchKey.trim() || matchKey.length > MAX_KEY) return;
  if (typeof category !== "string" || !(CATEGORIES as readonly string[]).includes(category)) return;
  // Ownership: only create a rule for a payee this user actually has. Keys are computed in JS (SQLite can't).
  const rows = await db.transaction.findMany({ where: { userId }, select: { description: true, counterparty: true } });
  if (!rows.some((r) => normalizeKey(r.description, r.counterparty) === matchKey)) return;
  await applyPayeeRule(userId, matchKey, category);
  revalidatePath("/dashboard/review");
  revalidatePath("/dashboard");
}
