"use client";
import "@/styles/dashboard-cards.css";
import { useState } from "react";
import Link from "next/link";
import { SpendTrendCard } from "./spend-trend";
import type { TrendMonth } from "@/lib/spend-trend";
import { Treemap, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, type TreemapNode } from "recharts";
import { categoryColor, INK } from "@/lib/category-colors";
import { formatCents } from "@/lib/money";

type Merch = { name: string; cents: number; count: number };
type Monthly = { ym: string; label: string; byCat: Record<string, number> };
type Compare = { curLabel: string; prevLabel: string; rows: { name: string; cur: number; prev: number }[] } | null;
const VIEWS = [["share", "Share"], ["time", "Over time"], ["compare", "Compare"], ["pattern", "Pattern"]] as const;
type View = (typeof VIEWS)[number][0];

const TIP = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)", fontSize: 13 } as const;
const AXIS_TICK = { fill: "var(--text-dim)", fontSize: 12 };

// Compact axis ticks: S$850, S$1.2k, S$12k.
function compactSgd(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1000) return `S$${(d / 1000).toFixed(Math.abs(d) >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `S$${Math.round(d)}`;
}

export function DashboardCharts({
  categories, trend, breakdown, trendLabel = "Monthly spend", monthly, compare, spendTrend,
}: {
  spendTrend: TrendMonth[] | null; // null = short period, show the daily line instead
  monthly: Monthly[];
  compare: Compare;
  categories: { name: string; value: number }[];
  trend: { day: string; cents: number }[];
  breakdown: Record<string, Merch[]>;
  trendLabel?: string;
}) {
  const ranked = [...categories].filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<View>("share");
  const [focus, setFocus] = useState<string | null>(null); // Over time: one category isolated, or null for all
  const sel = picked && ranked.some((c) => c.name === picked) ? picked : (ranked[0]?.name ?? "");
  const total = ranked.reduce((s, c) => s + c.value, 0) || 1;
  const maxCat = ranked[0]?.value || 1;
  const inside = (breakdown[sel] ?? []).slice(0, 6);
  const maxIn = inside.reduce((m, x) => Math.max(m, x.cents), 0) || 1;
  const selColor = categoryColor(sel);
  const summary = ranked.slice(0, 3).map((c) => `${c.name} ${formatCents(c.value)}`).join(", ");

  const renderCell = (node: TreemapNode) => {
    if (node.depth !== 1) return <g />;
    const { x, y, width, height, name } = node;
    const isSel = name === sel;
    const w = Math.max(0, width - 2);
    const h = Math.max(0, height - 2);
    const showText = width >= 70 && height >= 40;
    return (
      <g style={{ cursor: "pointer" }}>
        <rect
          x={x + 1} y={y + 1} width={w} height={h} rx={10} ry={10}
          fill={categoryColor(name)} stroke={isSel ? INK : "none"} strokeWidth={isSel ? 2 : 0}
        />
        {showText && (
          <>
            <text x={x + 12} y={y + 24} fill={INK} fontSize={13} fontWeight={600} className="tm-label">{name}</text>
            <text x={x + 12} y={y + 42} fill={INK} fontSize={12} className="tm-label tm-amount">{formatCents(node.value)}</text>
          </>
        )}
      </g>
    );
  };

  return (
    <div className="dash">
      <section className="card card-pad">
        <div className="where-head">
          <h2 className="card-title">Where it went</h2>
          <div className="view-tabs" role="tablist" aria-label="Ways to view spending">
            {VIEWS.map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className="view-tab" onClick={() => setView(v)}>{label}</button>
            ))}
          </div>
        </div>
        {ranked.length === 0 ? (
          <p className="dc-empty">No spending in this period.</p>
        ) : view === "time" ? (
          <TimeView monthly={monthly} cats={ranked.map((c) => c.name)} focus={focus} setFocus={setFocus} />
        ) : view === "compare" ? (
          <CompareView compare={compare} />
        ) : view === "pattern" ? (
          <PatternView monthly={monthly} cats={ranked.map((c) => c.name)} />
        ) : (
          <>
            <div className="where-grid">
              <div className="where-bars" role="list" aria-label="Spending by category">
                {ranked.map((c) => {
                  const on = c.name === sel;
                  return (
                    <div role="listitem" key={c.name}>
                      <button type="button" className={`rank-row${on ? " on" : ""}`} aria-pressed={on} onClick={() => setPicked(c.name)}>
                        <span className="rank-name">
                          <span className="cat-dot" style={{ background: categoryColor(c.name) }} aria-hidden="true" />
                          <span className="dc-ellipsis">{c.name}</span>
                        </span>
                        <span className="amount rank-amt">{formatCents(c.value)}</span>
                        <span className="rank-pct">{Math.round((c.value / total) * 100)}%</span>
                        <span className="rank-track" aria-hidden="true">
                          <span className="rank-fill" style={{ width: `${(c.value / maxCat) * 100}%`, background: categoryColor(c.name) }} />
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="where-tree" role="img" aria-label={`Spending treemap. Largest: ${summary}.`}>
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={ranked} dataKey="value" nameKey="name" aspectRatio={4 / 3}
                    isAnimationActive={false} content={renderCell}
                    onClick={(n) => { if (n?.name) setPicked(String(n.name)); }}
                  />
                </ResponsiveContainer>
              </div>
            </div>

            <div className="payees">
              <h3 className="payees-title">Top payees in {sel}</h3>
              {inside.length === 0 ? (
                <p className="dc-empty">No spending in this category.</p>
              ) : (
                <ul className="dc-list">
                  {inside.map((m) => (
                    <li key={m.name} className="payee-row">
                      <span className="payee-bar" style={{ width: `${(m.cents / maxIn) * 100}%`, background: selColor }} aria-hidden="true" />
                      <span className="payee-name dc-ellipsis">{m.name} <span className="dc-dim">x{m.count}</span></span>
                      <span className="amount">{formatCents(m.cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      {spendTrend ? <SpendTrendCard data={spendTrend} /> : <section className="card card-pad">
        <h2 className="card-title">{trendLabel}</h2>
        <div className="trend-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickFormatter={(v) => compactSgd(Number(v))} tickLine={false} axisLine={false} width={56} />
              <Tooltip formatter={(v) => [formatCents(Number(v)), "Spend"]} contentStyle={TIP} />
              <Line type="monotone" dataKey="cents" name="Spend" stroke="var(--ink)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>}
    </div>
  );
}

// Over time: one stacked bar per month, same category colours. Click a category chip to isolate it.
function TimeView({ monthly, cats, focus, setFocus }: { monthly: Monthly[]; cats: string[]; focus: string | null; setFocus: (c: string | null) => void }) {
  const data = monthly.map((m) => ({ label: m.label, ...m.byCat }));
  const shown = focus && cats.includes(focus) ? [focus] : cats;
  return (
    <div className="view-body">
      <div className="view-chips" role="group" aria-label="Show one category">
        <button type="button" className="view-chip" aria-pressed={!focus} onClick={() => setFocus(null)}>All categories</button>
        {cats.map((c) => (
          <button key={c} type="button" className="view-chip" aria-pressed={focus === c} onClick={() => setFocus(focus === c ? null : c)}>
            <span className="cat-dot" style={{ background: categoryColor(c) }} aria-hidden="true" />{c}
          </button>
        ))}
      </div>
      <div className="time-chart" role="img" aria-label={`Spending per month by category, ${monthly.length} months.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={monthly.length > 24 ? 2 : "18%"}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={18} />
            <YAxis tick={AXIS_TICK} tickFormatter={(v) => compactSgd(Number(v))} tickLine={false} axisLine={false} width={56} />
            <Tooltip formatter={(v, n) => [formatCents(Number(v)), String(n)]} contentStyle={TIP} cursor={{ fill: "var(--surface-2)" }} itemSorter={(i) => -Number(i.value)} />
            {shown.map((c) => <Bar key={c} dataKey={c} stackId="spend" fill={categoryColor(c)} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {monthly.length < 2 && <p className="dc-empty">Pick a longer period at the top to see how spending changes month to month.</p>}
    </div>
  );
}

// Compare: each category now against the same-length period before, with the change spelled out.
function CompareView({ compare }: { compare: Compare }) {
  if (!compare) return <p className="dc-empty">There is no earlier period to compare with. Pick a later period at the top.</p>;
  const max = Math.max(1, ...compare.rows.map((r) => Math.max(r.cur, r.prev)));
  const totalCur = compare.rows.reduce((n, r) => n + r.cur, 0), totalPrev = compare.rows.reduce((n, r) => n + r.prev, 0);
  const change = (cur: number, prev: number) => {
    const d = cur - prev;
    if (prev === 0) return { text: "new", cls: "up" };
    if (d === 0) return { text: "no change", cls: "" };
    return { text: `${d > 0 ? "up" : "down"} ${formatCents(Math.abs(d))} (${d > 0 ? "+" : "-"}${Math.round((Math.abs(d) / prev) * 100)}%)`, cls: d > 0 ? "up" : "down" };
  };
  const total = change(totalCur, totalPrev);
  return (
    <div className="view-body">
      <p className="cmp-head">
        <strong>{compare.curLabel}</strong> compared with <span className="cmp-prev-label">{compare.prevLabel}</span>:
        total {formatCents(totalCur)}, <span className={`cmp-change ${total.cls}`}>{total.text}</span>
      </p>
      <ul className="dc-list cmp-list">
        {compare.rows.map((r) => {
          const ch = change(r.cur, r.prev);
          return (
            <li key={r.name} className="cmp-row">
              <span className="cmp-name"><span className="cat-dot" style={{ background: categoryColor(r.name) }} aria-hidden="true" />{r.name}</span>
              <span className={`cmp-change ${ch.cls}`}>{ch.text}</span>
              <span className="cmp-bars" aria-hidden="true">
                <span className="cmp-bar" style={{ width: `${(r.cur / max) * 100}%`, background: categoryColor(r.name) }} />
                <span className="cmp-bar prev" style={{ width: `${(r.prev / max) * 100}%` }} />
              </span>
              <span className="cmp-amts"><span className="amount">{formatCents(r.cur)}</span><span className="amount cmp-prev">{formatCents(r.prev)}</span></span>
            </li>
          );
        })}
      </ul>
      <p className="cmp-key"><span className="cmp-swatch" aria-hidden="true" />Coloured bar: {compare.curLabel}. Grey bar: {compare.prevLabel}.</p>
    </div>
  );
}

// Pattern: categories down, months across, darker = more (each row is scaled to its own busiest month).
// Every square opens that month and category in Statements.
function PatternView({ monthly, cats }: { monthly: Monthly[]; cats: string[] }) {
  return (
    <div className="view-body">
      <div className="pat-scroll">
        <table className="pat">
          <thead>
            <tr>
              <th scope="col" className="pat-corner">Category</th>
              {monthly.map((m) => <th key={m.ym} scope="col" className={m.ym.endsWith("-01") ? "pat-year" : undefined}><span>{m.label.slice(0, 1)}</span>{m.ym.endsWith("-01") || m === monthly[0] ? <em>{m.ym.slice(0, 4)}</em> : null}</th>)}
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => {
              const vals = monthly.map((m) => m.byCat[c] ?? 0).filter((v) => v > 0);
              const rowMax = Math.max(1, ...vals), rowMin = vals.length ? Math.min(...vals) : 0;
              return (
                <tr key={c}>
                  <th scope="row"><span className="cat-dot" style={{ background: categoryColor(c) }} aria-hidden="true" />{c}</th>
                  {monthly.map((m) => {
                    const v = m.byCat[c] ?? 0;
                    const pct = v === 0 ? 0 : rowMax === rowMin ? 70 : Math.round(22 + 78 * ((v - rowMin) / (rowMax - rowMin))); // stretch between the row's quietest and busiest month
                    return (
                      <td key={m.ym} className={m.ym.endsWith("-01") ? "pat-year" : undefined}>
                        {v === 0 ? <span className="pat-cell empty" title={`${c}, ${m.label}: nothing`} /> : (
                          <Link className="pat-cell" href={`/dashboard/statements?month=${m.ym}&category=${encodeURIComponent(c)}`}
                            style={{ background: `color-mix(in srgb, ${categoryColor(c)} ${pct}%, var(--surface))` }}
                            title={`${c}, ${m.label}: ${formatCents(v)}`} aria-label={`${c}, ${m.label}: ${formatCents(v)}. Open in statements.`} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="cmp-key">Darker means more spent that month, measured against that category&apos;s own quietest and busiest months. Click a square to see the payments.</p>
    </div>
  );
}
