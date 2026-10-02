"use client";
import "@/styles/dashboard-cards.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { categoryColor } from "@/lib/category-colors";
import { formatCents } from "@/lib/money";

type Row = { id: string; date: string; merchant: string; category: string; amountCents: number };

const WD = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function CalendarHeatmap({ rows }: { rows: Row[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const [yearPick, setYearPick] = useState<string | null>(null); // null = the latest year in range

  const { byDay, monthsList, monthTotal, cuts } = useMemo(() => {
    const byDay = new Map<string, { out: number; in: number; count: number }>();
    const monthTotal = new Map<string, number>();
    for (const r of rows) {
      if (r.amountCents === 0) continue;
      const day = r.date.slice(0, 10);
      const e = byDay.get(day) ?? { out: 0, in: 0, count: 0 };
      if (r.amountCents < 0) { e.out += -r.amountCents; monthTotal.set(day.slice(0, 7), (monthTotal.get(day.slice(0, 7)) ?? 0) + -r.amountCents); }
      else e.in += r.amountCents;
      e.count++; byDay.set(day, e);
    }
    const monthsList = [...new Set([...byDay.keys()].map((d) => d.slice(0, 7)))].sort(); // ALL months in range
    // Shade by rank, not by share of the biggest day: one huge purchase would otherwise make every other day look pale.
    const spends = [...byDay.values()].map((e) => e.out).filter((c) => c > 0).sort((a, b) => a - b);
    const at = (q: number) => spends[Math.min(spends.length - 1, Math.floor(q * spends.length))] ?? 0;
    return { byDay, monthsList, monthTotal, cuts: [at(0.5), at(0.8), at(0.95)] };
  }, [rows]);

  // 1 = lighter-than-typical day ... 4 = top 5% of spending days.
  const level = (out: number) => (out > cuts[2] ? 4 : out > cuts[1] ? 3 : out > cuts[0] ? 2 : 1);

  const selRows = useMemo(
    () => (sel ? rows.filter((r) => r.date.slice(0, 10) === sel && r.amountCents !== 0).sort((a, b) => a.amountCents - b.amountCents) : []),
    [rows, sel],
  );
  const selOut = selRows.reduce((n, r) => n + (r.amountCents < 0 ? -r.amountCents : 0), 0);
  const selIn = selRows.reduce((n, r) => n + (r.amountCents > 0 ? r.amountCents : 0), 0);

  if (monthsList.length === 0) return null;
  // Several years at once is a wall of squares: show one year at a time, newest first.
  const years = [...new Set(monthsList.map((ym) => ym.slice(0, 4)))];
  const year = yearPick && years.includes(yearPick) ? yearPick : years[years.length - 1]!;
  const shown = years.length > 1 ? monthsList.filter((ym) => ym.startsWith(year)) : monthsList;
  const yearSpend = shown.reduce((n, ym) => n + (monthTotal.get(ym) ?? 0), 0);

  return (
    <section className="card card-pad">
      <h2 className="card-title">Spending calendar</h2>
      <p className="card-sub">
        {years.length > 1 ? `${year} · ` : ""}{shown.length} month{shown.length === 1 ? "" : "s"} · <span className="amount">{formatCents(yearSpend)}</span> spent
      </p>
      {years.length > 1 && (
        <div className="cal-years" role="group" aria-label="Year to show">
          {years.map((y) => (
            <button key={y} type="button" className="cal-year" aria-pressed={y === year} onClick={() => { setYearPick(y); setSel(null); }}>{y}</button>
          ))}
        </div>
      )}
      <ul className="cal-legend" aria-label="Colour key">
        <li><span className="cal-swatch cal-none" aria-hidden="true" />No transactions</li>
        <li>
          <span className="cal-swatch cal-out-1" aria-hidden="true" /><span className="cal-swatch cal-out-2" aria-hidden="true" />
          <span className="cal-swatch cal-out-3" aria-hidden="true" /><span className="cal-swatch cal-out-4" aria-hidden="true" />
          Spending, light to heavy
        </li>
        <li><span className="cal-swatch cal-in" aria-hidden="true" />More money in than out</li>
      </ul>

      <div className="cal-scroll">
        <div className="cal-months">
          {shown.map((ym) => {
            const [y, m] = ym.split("-").map(Number);
            const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
            const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
            const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
            return (
              <div key={ym}>
                <div className="cal-month-head">
                  <strong>{MONTHS[m - 1]} {y}</strong>
                  <span className="amount">{formatCents(monthTotal.get(ym) ?? 0)}</span>
                </div>
                <div className="cal-grid">
                  {WD.map((w, i) => <div key={`h${i}`} className="cal-wd" aria-hidden="true">{w}</div>)}
                  {cells.map((d, i) => {
                    if (d === null) return <div key={`b${i}`} />;
                    const key = `${ym}-${String(d).padStart(2, "0")}`;
                    const e = byDay.get(key);
                    // Green when more came in than went out that day; otherwise red, darker for heavier spending.
                    const tone = !e ? "cal-none" : e.in > e.out ? "cal-in" : `cal-out-${level(e.out)}`;
                    const isSel = sel === key;
                    const what = !e ? "no transactions" : [e.out ? `${formatCents(e.out)} spent` : "", e.in ? `${formatCents(e.in)} in` : ""].filter(Boolean).join(", ");
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`cal-day cal-cell ${tone}${isSel ? " sel" : ""}`}
                        onClick={() => setSel(isSel ? null : key)}
                        aria-pressed={isSel}
                        title={`${key} · ${what}${e ? ` · ${e.count} txns` : ""}`}
                        aria-label={`${key}, ${what}`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DayPanel day={sel} rows={selRows} selOut={selOut} selIn={selIn} onClose={() => setSel(null)}
        onStep={(dir) => { const days = [...byDay.keys()].sort(); const i = sel ? days.indexOf(sel) : -1; const next = days[i + dir]; if (next) { setSel(next); setYearPick(next.slice(0, 4)); } }} />
    </section>
  );
}

// The chosen day's payments, in a panel that slides in from the right (a bottom sheet on phones). A native <dialog>
// gives focus trapping, Escape to close and a backdrop for free.
function DayPanel({ day, rows, selOut, selIn, onClose, onStep }: {
  day: string | null; rows: Row[]; selOut: number; selIn: number; onClose: () => void; onStep: (dir: -1 | 1) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (day && !d.open) d.showModal();
    if (!day && d.open) d.close();
  }, [day]);
  const title = day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const net = selIn - selOut;
  return (
    <dialog ref={ref} className="day-panel" aria-labelledby="day-panel-title" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") onStep(-1); if (e.key === "ArrowRight") onStep(1); }}>
      {day && (
        <div className="day-panel-body">
          <div className="day-panel-head">
            <h3 id="day-panel-title">{title}</h3>
            <button type="button" className="day-panel-x" onClick={onClose} aria-label="Close">Close</button>
          </div>
          <div className="day-panel-totals">
            <div><span>Money out</span><strong className="amount out">{formatCents(selOut)}</strong></div>
            <div><span>Money in</span><strong className="amount in">{formatCents(selIn)}</strong></div>
            <div><span>Net</span><strong className={`amount ${net < 0 ? "out" : "in"}`}>{net < 0 ? "-" : ""}{formatCents(Math.abs(net))}</strong></div>
          </div>
          {rows.length === 0 ? <p className="dc-empty">No transactions this day.</p> : (
            <ul className="day-panel-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <span className="dc-main">
                    <span className="dc-name">{r.merchant}</span>
                    <span className="dc-meta"><span className="cat-dot" style={{ background: categoryColor(r.category), marginRight: 6 }} aria-hidden="true" />{r.category}</span>
                  </span>
                  <span className={`amount ${r.amountCents > 0 ? "in" : "out"}`}>{r.amountCents > 0 ? "+" : "-"}{formatCents(Math.abs(r.amountCents))}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="day-panel-foot">
            <button type="button" className="btn ghost" onClick={() => onStep(-1)}>Previous day</button>
            <button type="button" className="btn ghost" onClick={() => onStep(1)}>Next day</button>
            <Link className="btn" href={`/dashboard/statements?from=${day}&to=${day}&adv=1`}>Open in statements</Link>
          </div>
        </div>
      )}
    </dialog>
  );
}
