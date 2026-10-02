"use client";
import "@/styles/dashboard-cards.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { categoryColor } from "@/lib/category-colors";
import { formatCents } from "@/lib/money";

type Row = { id: string; date: string; merchant: string; category: string; amountCents: number };

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HEAVY_SHARE = 0.1; // the top 10% of spending days in the chosen period get the only fill colour

// Whole dollars inside a day cell (S$12, S$1.5k); exact cents live in the day panel.
function short(cents: number): string {
  const d = cents / 100;
  if (d >= 10000) return `S$${Math.round(d / 1000)}k`;
  if (d >= 1000) return `S$${(d / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `S$${Math.round(d)}`;
}

// One month at a time, like a banking app: each day shows what went out, only the heaviest days are tinted,
// and days with money in carry a small green dot. Tapping a day opens its payments in a side panel.
export function CalendarHeatmap({ rows }: { rows: Row[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const [monthPick, setMonthPick] = useState<string | null>(null); // null = the latest month in range

  const { byDay, monthsList, heavyCut } = useMemo(() => {
    const byDay = new Map<string, { out: number; in: number; count: number }>();
    for (const r of rows) {
      if (r.amountCents === 0) continue;
      const day = r.date.slice(0, 10);
      const e = byDay.get(day) ?? { out: 0, in: 0, count: 0 };
      if (r.amountCents < 0) e.out += -r.amountCents; else e.in += r.amountCents;
      e.count++; byDay.set(day, e);
    }
    const monthsList = [...new Set([...byDay.keys()].map((d) => d.slice(0, 7)))].sort();
    const spends = [...byDay.values()].map((e) => e.out).filter((c) => c > 0).sort((a, b) => a - b);
    const heavyCut = spends.length ? spends[Math.min(spends.length - 1, Math.floor((1 - HEAVY_SHARE) * spends.length))]! : Infinity;
    return { byDay, monthsList, heavyCut };
  }, [rows]);

  const selRows = useMemo(
    () => (sel ? rows.filter((r) => r.date.slice(0, 10) === sel && r.amountCents !== 0).sort((a, b) => a.amountCents - b.amountCents) : []),
    [rows, sel],
  );
  const selOut = selRows.reduce((n, r) => n + (r.amountCents < 0 ? -r.amountCents : 0), 0);
  const selIn = selRows.reduce((n, r) => n + (r.amountCents > 0 ? r.amountCents : 0), 0);

  if (monthsList.length === 0) return null;
  const ym = monthPick && monthsList.includes(monthPick) ? monthPick : monthsList[monthsList.length - 1]!;
  const idx = monthsList.indexOf(ym);
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  let monthOut = 0, monthIn = 0;
  for (let d = 1; d <= days; d++) { const e = byDay.get(`${ym}-${String(d).padStart(2, "0")}`); if (e) { monthOut += e.out; monthIn += e.in; } }

  return (
    <section className="card card-pad">
      <div className="calm-head">
        <h2 className="card-title">Spending calendar</h2>
        <div className="calm-nav">
          <button type="button" className="calm-arrow" onClick={() => setMonthPick(monthsList[idx - 1]!)} disabled={idx === 0} aria-label="Previous month">Prev</button>
          <select className="calm-select" value={ym} onChange={(e) => setMonthPick(e.target.value)} aria-label="Month to show">
            {[...monthsList].reverse().map((x) => <option key={x} value={x}>{MONTHS[Number(x.slice(5, 7)) - 1]} {x.slice(0, 4)}</option>)}
          </select>
          <button type="button" className="calm-arrow" onClick={() => setMonthPick(monthsList[idx + 1]!)} disabled={idx === monthsList.length - 1} aria-label="Next month">Next</button>
        </div>
      </div>
      <p className="card-sub">
        <span className="amount">{formatCents(monthOut)}</span> spent{monthIn ? <> · <span className="amount calm-in-text">{formatCents(monthIn)}</span> in</> : null}
      </p>
      <ul className="calm-key" aria-label="Key">
        <li><span className="calm-key-heavy" aria-hidden="true" />One of your heaviest days</li>
        <li><span className="calm-dot" aria-hidden="true" />Money came in</li>
      </ul>

      <div className="calm-grid" role="grid" aria-label={`${MONTHS[m - 1]} ${y}`}>
        {WD.map((w) => <div key={w} className="calm-wd" aria-hidden="true">{w}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} aria-hidden="true" />;
          const key = `${ym}-${String(d).padStart(2, "0")}`;
          const e = byDay.get(key);
          const heavy = Boolean(e && e.out >= heavyCut && e.out > 0);
          const what = !e ? "no transactions" : [e.out ? `${formatCents(e.out)} spent` : "", e.in ? `${formatCents(e.in)} in` : ""].filter(Boolean).join(", ");
          return (
            <button key={key} type="button" className={`calm-day${heavy ? " heavy" : ""}${!e ? " empty" : ""}${sel === key ? " sel" : ""}`}
              onClick={() => setSel(key)} aria-label={`${d} ${MONTHS[m - 1]}: ${what}${heavy ? ", one of your heaviest days" : ""}`}>
              <span className="calm-num">{d}{e?.in ? <span className="calm-dot" aria-hidden="true" /> : null}</span>
              <span className="calm-amt">{e?.out ? short(e.out) : ""}</span>
            </button>
          );
        })}
      </div>

      <DayPanel day={sel} rows={selRows} selOut={selOut} selIn={selIn} onClose={() => setSel(null)}
        onStep={(dir) => { const all = [...byDay.keys()].sort(); const i = sel ? all.indexOf(sel) : -1; const next = all[i + dir]; if (next) { setSel(next); setMonthPick(next.slice(0, 7)); } }} />
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
