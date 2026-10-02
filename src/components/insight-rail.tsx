import type { Insight } from "@/server/insights";
import "@/styles/dashboard-header.css";

// Insights as a slow ticker (like a stock tape). The list is rendered twice so the loop is seamless; the copy is
// hidden from screen readers. It pauses on hover / keyboard focus and becomes a plain list under reduced motion.
export function InsightRail({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  const items = insights.slice(0, 8);
  const row = (hidden: boolean) => (
    <ul className="ticker-row" aria-hidden={hidden || undefined}>
      {items.map((insight, i) => (
        <li key={`${insight.tone}-${i}`} className="ticker-item">
          <span className={`ticker-mark ${insight.tone}`} aria-hidden="true" />
          <span>{insight.text}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="card ticker" aria-labelledby="insights-title">
      <h2 id="insights-title" className="ticker-label">Insights</h2>
      <div className="ticker-view" tabIndex={0} aria-label="Insights, scrolling. Focus to pause.">
        <div className="ticker-track" style={{ animationDuration: `${items.length * 9}s` }}>
          {row(false)}
          {row(true)}
        </div>
      </div>
    </section>
  );
}
