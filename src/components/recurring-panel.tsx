"use client";
import "@/styles/dashboard-cards.css";
import { useState } from "react";
import { categoryColor } from "@/lib/category-colors";
import { formatCents } from "@/lib/money";

export type Recurring = {
  name: string; count: number; avg: number; total: number;
  cadence: string; category: string; instances: { date: string; cents: number }[];
};

export function RecurringPanel({ recurring }: { recurring: Recurring[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="card card-pad">
      <h2 className="card-title">Recurring payments</h2>
      {recurring.length === 0 ? (
        <p className="dc-empty">None detected yet.</p>
      ) : (
        <ul className="dc-list">
          {recurring.map((r) => {
            const isOpen = open === r.name;
            return (
              <li key={r.name} className="rec-item">
                <button type="button" className="rec-toggle" onClick={() => setOpen(isOpen ? null : r.name)} aria-expanded={isOpen}>
                  <span className="dc-main">
                    <span className="rec-title">
                      <span className="rec-chev" aria-hidden="true" />
                      <span className="dc-name">{r.name}</span>
                    </span>
                    <span className="dc-meta">
                      <span className="cat-dot" style={{ background: categoryColor(r.category), marginRight: 6 }} aria-hidden="true" />
                      {r.cadence} · {r.category}
                    </span>
                  </span>
                  <span className="dc-amt">
                    <span className="amount">{formatCents(r.total)}</span> <span className="dc-dim">x{r.count}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="rec-detail">
                    <span className="dc-meta">avg <span className="amount">{formatCents(r.avg)}</span> · {r.count} payments · showing last {r.instances.length}</span>
                    {r.instances.map((x, i) => (
                      <div key={`${x.date}-${i}`} className="rec-inst">
                        <span className="dc-dim">{x.date}</span>
                        <span className="amount">{formatCents(x.cents)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
