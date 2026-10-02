"use client";
import { useState } from "react";

const TARIFF = 0.2972; // SGD per kWh incl. GST, SP Group regulated tariff Apr–Jun 2026

export default function UtilitiesPage() {
  const [kwh, setKwh] = useState(320);
  const sgd = kwh * TARIFF;
  return (
    <section style={{ maxWidth: 560 }}>
      <h1>Utilities tracker</h1>
      <p style={{ color: "var(--text-dim)" }}>
        Mock SP Group smart-meter reading → cost at the real regulated tariff
        (<span className="mono">{(TARIFF * 100).toFixed(2)}¢/kWh</span> inc. GST, Apr–Jun 2026).
      </p>
      <div className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>This month&apos;s usage: <span className="mono">{kwh} kWh</span></span>
          <input type="range" min={0} max={1000} value={kwh} onChange={(e) => setKwh(Number(e.target.value))} aria-label="kWh used" />
        </label>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ color: "var(--text-dim)" }}>Estimated bill</span>
          <span className="mono" style={{ fontSize: 28, color: "var(--accent)" }}>${sgd.toFixed(2)}</span>
        </div>
      </div>
      <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 12 }}>Mock data; live SP Group smart-meter integration is a V2 feature.</p>
    </section>
  );
}
