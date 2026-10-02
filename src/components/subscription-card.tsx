"use client";

import "@/styles/dashboard-cards.css";
import { formatCents } from "@/lib/money";
import type { SubscriptionSummary } from "@/server/subscriptions";

export function SubscriptionCard({
  summary,
  incomeMonthlyCents,
}: {
  summary: SubscriptionSummary;
  incomeMonthlyCents: number;
}) {
  const incomeShare = incomeMonthlyCents > 0
    ? Math.round((summary.totalMonthlyCents / incomeMonthlyCents) * 100)
    : null;

  return (
    <section className="card card-pad">
      <h2 className="card-title">Subscriptions &amp; commitments</h2>
      <p className="card-sub">Detected recurring charges</p>

      <div className="num-hero dc-hero">
        {formatCents(summary.totalMonthlyCents)}
        <small>/mo</small>
      </div>
      {incomeShare !== null && <p className="card-sub">{incomeShare}% of monthly income</p>}

      {summary.items.length === 0 ? (
        <p className="dc-empty">No recurring charges detected yet.</p>
      ) : (
        <ul className="dc-list">
          {summary.items.map((sub) => (
            <li key={`${sub.name}-${sub.lastDate}`} className="dc-row">
              <div className="dc-main">
                <span className="dc-name">{sub.name}</span>
                <span className="dc-meta">
                  {sub.cadence}
                  {sub.nextDate ? ` · next ${sub.nextDate}` : ""}
                  {" · "}
                  {sub.count} charges
                </span>
                {sub.priceChange && (
                  <span className="dc-flag">
                    Price up from <span className="amount">{formatCents(sub.priceChange.fromCents)}</span> to{" "}
                    <span className="amount">{formatCents(sub.priceChange.toCents)}</span>
                  </span>
                )}
              </div>
              <span className="amount dc-amt">{formatCents(sub.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
