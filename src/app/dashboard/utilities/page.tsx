"use client";
import { useState } from "react";
import { CompoundCalculator } from "@/components/compound-calculator";
import { formatCents } from "@/lib/money";

const TARIFF_CENTS_PER_KWH = 29.72; // SP Group regulated tariff incl. GST, Apr to Jun 2026

export default function UtilitiesPage() {
  const [kwh, setKwh] = useState(320);
  return (
    <div className="tools">
      <h1>Utilities</h1>
      <p className="tools-lede">Small calculators that sit next to your spending. They use the numbers you type, not your statements.</p>
      <CompoundCalculator title="Compound interest calculator" />
      <section className="card card-pad">
        <h2 className="card-title">Electricity bill estimate</h2>
        <p className="card-sub">At the SP Group regulated tariff of {TARIFF_CENTS_PER_KWH} cents per kWh including GST (Apr to Jun 2026).</p>
        <label className="tools-field">
          <span>This month&apos;s usage: <strong>{kwh} kWh</strong></span>
          <input type="range" min={0} max={1000} value={kwh} onChange={(e) => setKwh(Number(e.target.value))} aria-label="Electricity used this month, in kWh" />
        </label>
        <p className="tools-result"><span>Estimated bill</span><strong className="amount">{formatCents(Math.round(kwh * TARIFF_CENTS_PER_KWH))}</strong></p>
      </section>
    </div>
  );
}
