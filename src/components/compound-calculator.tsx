"use client";
import { useState } from "react";

const sgd = (n: number) =>
  new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);

// Illustrative long-run historical CAGRs — NOT a forecast.
const PRESETS = [
  { sym: "SPY", name: "S&P 500", rate: 10 },
  { sym: "QQQ", name: "Nasdaq-100", rate: 13.5 },
  { sym: "VGT", name: "US Tech", rate: 14 },
  { sym: "VT", name: "World", rate: 8 },
  { sym: "STI", name: "SG STI", rate: 5 },
  { sym: "T-Bills", name: "SG T-Bills", rate: 3.5 },
];

export function CompoundCalculator({ title = "Compound interest calculator" }: { title?: string }) {
  const [p, setP] = useState(10000);
  const [m, setM] = useState(500);
  const [rate, setRate] = useState(10);
  const [years, setYears] = useState(20);
  const [inflation, setInflation] = useState(2.5);
  const [active, setActive] = useState("SPY");

  const r = rate / 100 / 12;
  const n = years * 12;
  const nominal = r === 0 ? p + m * n : p * Math.pow(1 + r, n) + m * ((Math.pow(1 + r, n) - 1) / r);
  const real = nominal / Math.pow(1 + inflation / 100, years); // today's money
  const contributed = p + m * n;
  const gain = nominal - contributed;

  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>{title}</h2>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {PRESETS.map((x) => (
          <button key={x.sym} type="button"
            onClick={() => { setRate(x.rate); setActive(x.sym); }}
            title={`${x.name} · ~${x.rate}%/yr historical`}
            style={{
              border: "1px solid var(--border)", borderRadius: 999, padding: "4px 10px", cursor: "pointer", fontSize: 13,
              background: active === x.sym ? "var(--accent)" : "transparent",
              color: active === x.sym ? "var(--accent-ink)" : "var(--text)",
            }}>
            {x.sym} <span style={{ opacity: 0.7 }}>{x.rate}%</span>
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        <Field label="Starting ($)" value={p} onChange={setP} />
        <Field label="Monthly add ($)" value={m} onChange={setM} />
        <Field label="Return % / yr" value={rate} onChange={(v) => { setRate(v); setActive("custom"); }} step={0.1} />
        <Field label="Years" value={years} onChange={setYears} />
        <Field label="Inflation % / yr" value={inflation} onChange={setInflation} step={0.1} />
      </div>

      <div style={{ display: "flex", gap: 18, marginTop: 16, flexWrap: "wrap" }}>
        <Stat label="Could grow to" value={sgd(nominal)} big />
        <Stat label="In today's money" value={sgd(real)} pos />
        <Stat label="You put in" value={sgd(contributed)} />
        <Stat label="Market gain" value={sgd(gain)} />
      </div>

      <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 10 }}>
        Monthly compounding · ticker %s are long-run historical averages, <strong>not a forecast</strong> · past performance ≠ future results · not financial advice.
      </p>
    </div>
  );
}

function Field({ label, value, onChange, step }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{label}</span>
      <input className="input mono" type="number" min={0} step={step ?? 1} value={value}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))} />
    </label>
  );
}

function Stat({ label, value, big, pos }: { label: string; value: string; big?: boolean; pos?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{label}</div>
      <div className="mono" style={{ fontSize: big ? 26 : 18, color: big ? "var(--accent)" : pos ? "var(--pos)" : "var(--text)" }}>{value}</div>
    </div>
  );
}
