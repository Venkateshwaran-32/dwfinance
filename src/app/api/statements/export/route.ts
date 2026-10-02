import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { cleanMerchant, normalizeKey } from "@/server/merchants";
import { recurringPayees, isLargeOneOff } from "@/lib/spend-trend";
import { buildSearch, csvCell, matches, paymentType, sortRows, PAY_TYPES, type SearchParams } from "@/server/statement-search";

export const dynamic = "force-dynamic";

// CSV of the user's transactions, using the same filters and sort as the Statements page (same URL params).
export async function GET(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "not authenticated" }, { status: 401 });

  const sp: SearchParams = Object.fromEntries(new URL(req.url).searchParams);
  const s = buildSearch(sp);
  const txns = await db.transaction.findMany({
    where: { userId },
    select: { date: true, description: true, counterparty: true, amountCents: true, category: true, needsReview: true },
  });
  const recurring = s.oneOff ? recurringPayees(txns.map((t) => ({ date: t.date, amountCents: t.amountCents, payeeKey: normalizeKey(t.description, t.counterparty) }))) : new Set<string>();
  const isOneOff = (t: { date: Date; amountCents: number; description: string; counterparty: string | null }) => isLargeOneOff({ date: t.date, amountCents: t.amountCents, payeeKey: normalizeKey(t.description, t.counterparty) }, recurring);
  const rows = sortRows(s.active ? txns.filter((t) => matches(s, t, isOneOff)) : txns, s.sort === "default" ? "newest" : s.sort);

  const typeLabel = (d: string) => PAY_TYPES.find(([k]) => k === paymentType(d))![1];
  const lines = [
    ["Date", "Payee", "Description", "Category", "Amount (SGD)", "Paid by", "Needs review"].map(csvCell).join(","),
    ...rows.map((t) => [
      t.date.toISOString().slice(0, 10), cleanMerchant(t.description, t.counterparty), t.description, t.category,
      (t.amountCents / 100).toFixed(2), typeLabel(t.description), t.needsReview ? "yes" : "no",
    ].map((v, i) => (i === 4 ? `"${v}"` : csvCell(v))).join(",")), // the amount column is numeric by construction: keep its minus sign
  ];
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="dwfinance-transactions.csv"',
      "Cache-Control": "no-store",
    },
  });
}
