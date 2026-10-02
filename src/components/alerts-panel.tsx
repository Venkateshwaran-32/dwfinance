"use client";

import "@/styles/dashboard-cards.css";
import { formatCents } from "@/lib/money";
import type { Alert } from "@/server/alerts";

// Red dot only for genuine needs-attention kinds; a new merchant is informational.
const KINDS: Record<Alert["kind"], { label: string; attention: boolean }> = {
  big: { label: "Big charge", attention: true },
  duplicate: { label: "Possible duplicate", attention: true },
  "new-merchant": { label: "New merchant", attention: false },
  spike: { label: "Spending spike", attention: true },
};

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <section className="card card-pad">
      <h2 className="card-title">Flags &amp; alerts</h2>
      <p className="card-sub">Unusual spending patterns</p>

      {alerts.length === 0 ? (
        <p className="dc-empty">Nothing unusual. Looks clean.</p>
      ) : (
        <ul className="dc-list">
          {alerts.map((alert, index) => {
            const kind = KINDS[alert.kind];
            return (
              <li key={`${alert.kind}-${alert.date}-${alert.title}-${index}`} className="dc-row alert-row">
                <span className={`attn-dot${kind.attention ? "" : " quiet"}`} aria-hidden="true" />
                <span className="dc-main">
                  <span className="dc-name">{alert.title}</span>
                  <span className="dc-meta">
                    <span className="dc-kind">{kind.label}</span> · {alert.date}{alert.detail ? ` · ${alert.detail}` : ""}
                  </span>
                </span>
                <span className="amount dc-amt">{formatCents(alert.amountCents)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
