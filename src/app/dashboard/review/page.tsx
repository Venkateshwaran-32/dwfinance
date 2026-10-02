import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { confirmReviewAction, recategorizeAction } from "@/app/actions";
import { CATEGORIES } from "@/server/categorize";
import { cleanMerchant } from "@/server/merchants";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const rows = await db.transaction.findMany({
    where: { userId, needsReview: true },
    orderBy: { date: "desc" },
  });

  return (
    <section style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Review</h1>
        <span style={{ color: "var(--text-dim)" }}>{rows.length} left</span>
        <form action={recategorizeAction} style={{ marginLeft: "auto" }}>
          <button className="btn" type="submit" style={{ background: "transparent", color: "var(--accent)", border: "1px solid var(--border)" }}>
            Re-run auto-categorize
          </button>
        </form>
      </div>
      <p style={{ color: "var(--text-dim)", marginTop: 6 }}>
        Confirm a category once — it&apos;s saved as a rule and applied to every matching transaction, past and future.
      </p>
      {rows.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>Nothing to review. Everything&apos;s categorized.</div>
      ) : (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
          {rows.map((t) => {
            const merchant = cleanMerchant(t.description, t.counterparty);
            const inflow = t.amountCents > 0;
            return (
              <form
                key={t.id}
                action={confirmReviewAction}
                className="card"
                style={{ padding: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}
              >
                <input type="hidden" name="txnId" value={t.id} />

                {/* Amount — the focal point */}
                <div style={{ textAlign: "right", minWidth: 96 }}>
                  <div className="mono" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1, color: inflow ? "var(--pos)" : "var(--text)" }}>
                    {inflow ? "+" : "−"}{formatCents(Math.abs(t.amountCents))}
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                    {t.date.toISOString().slice(0, 10)}
                  </div>
                </div>

                {/* Merchant — clean name big, raw narration small */}
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={merchant}>
                    {merchant}
                  </div>
                  <div style={{ color: "var(--text-dim)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.description}>
                    {t.description} · guess: {t.category}
                  </div>
                </div>

                <select className="input" name="category" defaultValue={t.category} style={{ width: 160 }} aria-label="Category">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button className="btn" type="submit">Confirm</button>
              </form>
            );
          })}
        </div>
      )}
    </section>
  );
}
