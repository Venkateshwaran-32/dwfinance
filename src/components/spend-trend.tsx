"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Area, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { formatCents } from "@/lib/money";
import { LARGE_ONE_OFF_CENTS, type TrendMonth } from "@/lib/spend-trend";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AXIS = { fill: "var(--text-dim)", fontSize: 12 };
const label = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
// Round axis steps (S$500, S$1,000 ...) instead of whatever the chart library picks.
function ticks(max: number): number[] {
  const step = [100_00, 250_00, 500_00, 1000_00, 2500_00, 5000_00].find((s) => max / s <= 5) ?? 10000_00;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}
const axisSgd = (c: number) => (c >= 100000 ? `S$${(c / 100000).toFixed(c % 100000 ? 1 : 0)}k` : `S$${c / 100}`);

type Row = TrendMonth & { label: string; shown: number; band: [number, number] | null; median: number | null; above: boolean; vsUsual: number | null };

export function SpendTrendCard({ data }: { data: TrendMonth[] }) {
  const router = useRouter();
  const [view, setView] = useState<"range" | "year">("range");
  const [withLarge, setWithLarge] = useState(true);
  const hasLarge = data.some((m) => m.oneOff > 0);

  const rows: Row[] = data.map((m) => {
    const u = withLarge ? m.usualTotal : m.usualEveryday;
    const shown = m.everyday + (withLarge ? m.oneOff : 0);
    return { ...m, label: label(m.ym), shown, band: u ? [u.low, u.high] : null, median: u?.median ?? null, above: Boolean(u && shown > u.unusual), vsUsual: u && u.median > 0 ? Math.round(((shown - u.median) / u.median) * 100) : null };
  });
  const max = Math.max(1, ...rows.map((r) => Math.max(r.shown, r.band?.[1] ?? 0)));
  const yTicks = ticks(max);
  const latest = [...rows].reverse().find((r) => r.median !== null);
  const firstYear = rows.slice(0, 12), lastYear = rows.slice(-12);
  const trendNote = rows.length >= 24 ? (() => {
    const a = firstYear.reduce((n, r) => n + r.shown, 0) / firstYear.length, b = lastYear.reduce((n, r) => n + r.shown, 0) / lastYear.length;
    return `Average month: ${formatCents(Math.round(a))} in the first 12 months, ${formatCents(Math.round(b))} in the last 12 (${b >= a ? "+" : ""}${Math.round(((b - a) / a) * 100)}%).`;
  })() : null;

  return (
    <section className="card card-pad">
      <div className="where-head">
        <h2 className="card-title">Monthly spend</h2>
        <div className="view-tabs" role="tablist" aria-label="Ways to view monthly spend">
          <button type="button" role="tab" aria-selected={view === "range"} className="view-tab" onClick={() => setView("range")}>Normal range</button>
          <button type="button" role="tab" aria-selected={view === "year"} className="view-tab" onClick={() => setView("year")}>By year</button>
        </div>
      </div>
      <div className="trend-tools">
        {hasLarge && (
          <label className="trend-toggle">
            <input type="checkbox" checked={withLarge} onChange={(e) => setWithLarge(e.target.checked)} />
            Include large one-offs
            <span className="trend-hint">single payments of {formatCents(LARGE_ONE_OFF_CENTS)}+ to a payee you don&apos;t pay regularly</span>
          </label>
        )}
        <a className="trend-link" href="/dashboard/statements?oneoff=1&group=none&sort=largest">See all large one-offs</a>
      </div>

      {view === "range" ? (
        <>
          <ul className="trend-key" aria-hidden="true">
            <li><span className="k k-every" />Everyday</li>
            {withLarge && hasLarge && <li><span className="k k-large" />Large one-offs</li>}
            <li><span className="k k-above" />Unusually high</li>
            <li><span className="k k-band" />Normal range</li>
            <li><span className="k k-median" />Usual month</li>
          </ul>
          <div className="trend-chart" role="img" aria-label={`Monthly spending for ${rows.length} months against your normal range.${latest ? ` Usual month recently: ${formatCents(latest.median!)}.` : ""}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={rows.length > 24 ? 2 : "20%"}
                onClick={(s) => { const ym = rows[Number(s?.activeTooltipIndex)]?.ym; if (ym) router.push(`/dashboard/statements?month=${ym}`); }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={18} />
                <YAxis tick={AXIS} ticks={yTicks} domain={[0, yTicks[yTicks.length - 1]!]} tickFormatter={(v) => axisSgd(Number(v))} tickLine={false} axisLine={false} width={56} />
                <Tooltip content={<TrendTip withLarge={withLarge} />} cursor={{ fill: "var(--surface-2)" }} />
                <Area dataKey="band" type="step" stroke="none" fill="var(--band)" isAnimationActive={false} connectNulls={false} />
                <Bar dataKey="everyday" stackId="m" isAnimationActive={false}>
                  {rows.map((r) => <Cell key={r.ym} fill={r.above ? "var(--ink)" : "var(--bar-calm)"} cursor="pointer" />)}
                </Bar>
                {withLarge && <Bar dataKey="oneOff" stackId="m" fill="var(--bar-large)" isAnimationActive={false} cursor="pointer" />}
                <Line dataKey="median" type="step" stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="trend-note">
            The grey band is your normal range (the middle half of the 12 months before each month) and the dashed line your usual month. Black bars are far above the band, using a standard statistical test for outliers.
            {trendNote ? ` ${trendNote}` : ""} Click a month to see its payments.
          </p>
        </>
      ) : (
        <ByYear rows={rows} withLarge={withLarge} />
      )}
    </section>
  );
}

const rangeNote = (r: Row) => (r.band && r.shown > r.band[1] ? ", above your normal range" : r.band && r.shown < r.band[0] ? ", below your normal range" : "");

function TrendTip({ active, payload, withLarge }: { active?: boolean; payload?: { payload: Row }[]; withLarge: boolean }) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  return (
    <div className="trend-tip">
      <strong>{MON[Number(r.ym.slice(5, 7)) - 1]} {r.ym.slice(0, 4)}: {formatCents(r.shown)}</strong>
      {withLarge && r.oneOff > 0 && <span>Everyday {formatCents(r.everyday)} + large one-offs {formatCents(r.oneOff)}{r.biggestOneOff ? ` (biggest: ${r.biggestOneOff.label}, ${formatCents(r.biggestOneOff.cents)})` : ""}</span>}
      {r.vsUsual !== null && r.median !== null
        ? <span>{r.vsUsual === 0 ? "Same as" : `${Math.abs(r.vsUsual)}% ${r.vsUsual > 0 ? "above" : "below"}`} your usual month ({formatCents(r.median)}){r.above ? ". Unusually high for you" : rangeNote(r)}</span>
        : <span>Not enough history yet for a usual month</span>}
    </div>
  );
}

// Seasonality: Jan to Dec, one line per year, older years lighter.
function ByYear({ rows, withLarge }: { rows: Row[]; withLarge: boolean }) {
  const years = [...new Set(rows.map((r) => r.ym.slice(0, 4)))];
  const data = MON.map((m, i) => {
    const o: Record<string, number | string | null> = { m };
    for (const y of years) { const r = rows.find((x) => x.ym === `${y}-${String(i + 1).padStart(2, "0")}`); o[y] = r ? r.shown : null; }
    return o;
  });
  const max = Math.max(1, ...rows.map((r) => r.shown)); const yTicks = ticks(max);
  const shade = (i: number) => (i === years.length - 1 ? "var(--ink)" : `color-mix(in srgb, var(--ink) ${Math.round(25 + (50 * i) / Math.max(1, years.length - 1))}%, var(--surface))`);
  return (
    <>
      <ul className="trend-key" aria-hidden="true">{years.map((y, i) => <li key={y}><span className="k k-line" style={{ background: shade(i) }} />{y}</li>)}</ul>
      <div className="trend-chart" role="img" aria-label={`Spending per month, one line per year: ${years.join(", ")}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="m" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} ticks={yTicks} domain={[0, yTicks[yTicks.length - 1]!]} tickFormatter={(v) => axisSgd(Number(v))} tickLine={false} axisLine={false} width={56} />
            <Tooltip formatter={(v, n) => [v == null ? "no data" : formatCents(Number(v)), String(n)]} itemSorter={(i) => -Number(i.name)}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 13 }} />
            {years.map((y, i) => <Line key={y} dataKey={y} type="linear" stroke={shade(i)} strokeWidth={i === years.length - 1 ? 2.5 : 1.5} dot={{ r: 2.5 }} isAnimationActive={false} connectNulls={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="trend-note">Each line is one year, January to December{withLarge ? "" : ", everyday spending only"}. Lines that rise and fall together show a seasonal pattern.</p>
    </>
  );
}
