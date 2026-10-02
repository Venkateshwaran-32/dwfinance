"use client";
import { useRouter, usePathname } from "next/navigation";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// Choose the period the whole dashboard covers: quick presets (all time, each year, last 12 / 3 months) or any
// start and end month. The choice lives in the URL (?from=YYYY-MM&to=YYYY-MM) so a view can be bookmarked.
export function PeriodPicker({ months, from, to }: { months: string[]; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const first = months[0]!, last = months[months.length - 1]!;
  const go = (f: string, t: string) => router.push(f === first && t === last ? pathname : `${pathname}?from=${f}&to=${t}`);

  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const lastN = (n: number) => months[Math.max(0, months.length - n)]!;
  const presets: { name: string; from: string; to: string }[] = [
    { name: "All time", from: first, to: last },
    ...(years.length > 1 ? years.map((y) => ({ name: y, from: months.find((m) => m.startsWith(y))!, to: [...months].reverse().find((m) => m.startsWith(y))! })) : []),
    ...(months.length > 12 ? [{ name: "Last 12 months", from: lastN(12), to: last }] : []),
    ...(months.length > 3 ? [{ name: "Last 3 months", from: lastN(3), to: last }] : []),
  ];

  return (
    <div className="period" role="group" aria-label="Period shown">
      <div className="period-presets">
        {presets.map((p) => (
          <button key={p.name} type="button" className="period-pill" aria-pressed={p.from === from && p.to === to} onClick={() => go(p.from, p.to)}>{p.name}</button>
        ))}
      </div>
      <div className="period-range">
        <label><span className="sr-only">From month</span>
          <select value={from} onChange={(e) => go(e.target.value, e.target.value > to ? e.target.value : to)}>
            {months.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </label>
        <span aria-hidden="true">to</span>
        <label><span className="sr-only">To month</span>
          <select value={to} onChange={(e) => go(e.target.value < from ? e.target.value : from, e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
