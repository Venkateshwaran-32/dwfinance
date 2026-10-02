"use client";

import "@/styles/dashboard-cards.css";
import Link from "next/link";
import { formatCents } from "@/lib/money";
import type { Alert } from "@/server/alerts";

// Red dot only for genuine needs-attention kinds; a new merchant on its own is informational.
const ATTENTION: Record<Alert["kind"], boolean> = { big: true, duplicate: true, "new-merchant": false, spike: true };

// Titles wrap to at most two lines instead of being cut off with "..." in a narrow card.
const TITLE_STYLE = {
  whiteSpace: "normal", overflowWrap: "anywhere", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
} as const;
const META_STYLE = { whiteSpace: "normal" } as const;

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <section className="card card-pad">
      <h2 className="card-title">Flags &amp; alerts</h2>
      <p className="card-sub">Unusual spending, one row per day. Tap a row to see that day.</p>

      {alerts.length === 0 ? (
        <p className="dc-empty">Nothing unusual. Looks clean.</p>
      ) : (
        <ul className="dc-list">
          {alerts.map((alert) => (
            <li key={`${alert.date}-${alert.title}`} className="dc-row" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
              <Link
                href={alert.href}
                className="alert-row"
                style={{ display: "grid", gap: 12, alignItems: "center", color: "inherit", textDecoration: "none" }}
                aria-label={`${alert.title}, ${formatCents(alert.amountCents)} on ${alert.dateLabel}: ${alert.detail}. Open in Statements.`}
              >
                <span className={`attn-dot${ATTENTION[alert.kind] ? "" : " quiet"}`} aria-hidden="true" />
                <span className="dc-main">
                  <span className="dc-name" style={TITLE_STYLE}>{alert.title}</span>
                  <span className="dc-meta" style={META_STYLE}>{alert.dateLabel} · {alert.detail}</span>
                </span>
                <span className="amount dc-amt">{formatCents(alert.amountCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
