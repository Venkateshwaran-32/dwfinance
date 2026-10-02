'use client';

import '@/styles/dashboard-cards.css';
import type { HealthSummary } from '@/server/financial-health';

// Scores the period picked on the dashboard; `periodLabel` names it (e.g. "All time · Jan 2067–Dec 2070").
export function FinancialHealthCard({ health, periodLabel }: { health: HealthSummary; periodLabel: string }) {
  // Red only when the score genuinely needs attention.
  const scoreClass = health.score >= 65 ? 'fh-pos' : health.score >= 50 ? '' : 'fh-neg';
  const delta = health.prevSavingsRatePct === null ? null : health.savingsRatePct - health.prevSavingsRatePct;

  return (
    <section className="card card-pad">
      <h2 className="card-title">Financial health</h2>
      <p className="card-sub">{periodLabel}</p>

      <div className="fh-top">
        <div className={`num-hero fh-score ${scoreClass}`}>
          {health.score}
          <small>/100</small>
        </div>
        <div className="dc-main">
          <span className="fh-grade">{health.grade}</span>
          <span className="dc-meta">
            {health.months > 1 ? 'Overall savings rate' : 'Savings rate'} <span className="amount">{formatPct(health.savingsRatePct)}</span>
            {delta !== null ? (
              <>
                {' ('}
                <span className={`amount ${delta >= 0 ? 'fh-pos' : 'fh-neg'}`}>
                  {delta >= 0 ? 'up' : 'down'} {Math.abs(delta)}pp
                </span>
                {` vs ${health.prevLabel ?? 'the period before'})`}
              </>
            ) : null}
          </span>
        </div>
      </div>

      {health.drivers.length === 0 ? (
        <p className="dc-empty">No score drivers yet.</p>
      ) : (
        <ul className="dc-list">
          {health.drivers.map((driver, index) => (
            <li key={`${driver.label}-${index}`} className="dc-row">
              <span className="dc-ellipsis">{driver.label}</span>
              <span className={`amount dc-amt ${driver.points >= 0 ? 'fh-pos' : 'fh-neg'}`}>
                {formatPoints(driver.points)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}

function formatPoints(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}
