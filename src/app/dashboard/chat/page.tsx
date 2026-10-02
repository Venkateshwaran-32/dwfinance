import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { cleanMerchant, isPayNowToPerson, normalizeKey } from "@/server/merchants";
import { ChatPanel } from "@/components/chat-panel";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

// Most frequent PayNow-to-person payee (outgoing), used only to seed one suggestion chip.
async function suggestedPayee(userId: string): Promise<string | null> {
  // debt: scans the latest 2000 outgoing txns only; move to a grouped SQL query if users exceed that
  const rows = await db.transaction.findMany({
    where: { userId, amountCents: { lt: 0 } },
    select: { description: true, counterparty: true },
    orderBy: { date: "desc" },
    take: 2000,
  });
  const counts = new Map<string, { name: string; n: number }>();
  for (const r of rows) {
    if (!isPayNowToPerson(r.description, r.counterparty)) continue;
    const key = normalizeKey(r.description, r.counterparty);
    const cur = counts.get(key) ?? { name: cleanMerchant(r.description, r.counterparty), n: 0 };
    cur.n++;
    counts.set(key, cur);
  }
  let best: { name: string; n: number } | null = null;
  for (const v of counts.values()) if (!best || v.n > best.n) best = v;
  return best?.name ?? null;
}

export default async function ChatPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const payee = await suggestedPayee(userId);
  return (
    <section className="chat-page">
      <h1 style={{ margin: "0 0 4px" }}>Ask AI</h1>
      <p style={{ color: "var(--text-dim)", margin: "0 0 14px" }}>
        Questions about your spending, answered by an AI model that runs locally in LM Studio, not in the cloud.
      </p>
      {/* storageKey only namespaces this browser's saved chats per account */}
      <ChatPanel suggestedPayee={payee} storageKey={userId.slice(-12)} hosted={Boolean(env.DEMO_OPEN_EMAIL)} />
    </section>
  );
}
