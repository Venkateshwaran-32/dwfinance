"use client";
import { useEffect, useState } from "react";
import { useUpload } from "./upload-provider";

type Sys = {
  machine: { cores: number; totalMem: number; usedMem: number; loadavg: number[] };
  app: { cpuPctOfCore: number; rss: number; heapUsed: number; heapTotal: number };
};

const mb = (b: number) => Math.round(b / 1024 / 1024);
const gb = (b: number) => (b / 1024 / 1024 / 1024).toFixed(1);

function Row({ label, value, sub, pct, color = "var(--accent)" }: { label: string; value: string; sub?: string; pct?: number; color?: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
        <span style={{ color: "var(--text-dim)" }}>{label}</span>
        <span className="mono" style={{ fontWeight: 600 }}>{value}</span>
      </div>
      {sub ? <div style={{ color: "var(--text-dim)", fontSize: 10.5 }}>{sub}</div> : null}
      {pct !== undefined ? (
        <div style={{ height: 4, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden", marginTop: 4 }}>
          <div style={{ height: "100%", width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
        </div>
      ) : null}
    </div>
  );
}

// Always-on, low-cost vitals widget docked bottom-right across the dashboard.
// Polls /api/system (2s while open/uploading, 6s when collapsed); hides if the API is off (prod).
export function SystemMonitorDock() {
  const { status } = useUpload();
  const uploading = status === "uploading";
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Sys | null>(null);
  const [dead, setDead] = useState(false);
  const expanded = open || uploading;

  useEffect(() => {
    if (dead) return; // API is off (production): stop polling instead of logging a 404 every few seconds
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/system", { cache: "no-store" });
        if (!r.ok) { if (alive) setDead(true); return; }
        const d = (await r.json()) as Sys;
        if (alive) { setS(d); setDead(false); }
      } catch { if (alive) setDead(true); }
    };
    tick();
    const t = setInterval(tick, expanded ? 2000 : 6000);
    return () => { alive = false; clearInterval(t); };
  }, [expanded, dead]);

  if (dead || !s) return null;

  const ramPct = (s.machine.usedMem / s.machine.totalMem) * 100;
  const busyPct = Math.round((s.machine.loadavg[0] / s.machine.cores) * 100);

  if (!expanded) {
    return (
      <div className="sysdock">
        <button className="sysdock-pill" onClick={() => setOpen(true)} aria-label="Show system monitor" title="System vitals">
          <span className="sysdock-dot" /> CPU {busyPct}% · RAM {ramPct.toFixed(0)}%
        </button>
      </div>
    );
  }

  return (
    <div className="sysdock">
      <div className="sysdock-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>
            <span className="sysdock-dot" /> System {uploading ? "· crunching" : "· live"}
          </strong>
          {!uploading ? (
            <button className="sysdock-x" onClick={() => setOpen(false)} aria-label="Minimize system monitor" title="Minimize">–</button>
          ) : null}
        </div>
        <Row label="Machine RAM" value={`${ramPct.toFixed(0)}%`} sub={`${gb(s.machine.usedMem)} / ${gb(s.machine.totalMem)} GB`} pct={ramPct} />
        <Row label="CPU load (1m)" value={s.machine.loadavg[0].toFixed(2)} sub={`${s.machine.cores} cores · ≈${busyPct}% busy`} pct={busyPct} />
        <Row label="App RAM" value={`${mb(s.app.rss)} MB`} sub={`heap ${mb(s.app.heapUsed)} / ${mb(s.app.heapTotal)} MB`} />
        <Row label="App CPU" value={`${s.app.cpuPctOfCore.toFixed(0)}%`} sub="of one core" pct={s.app.cpuPctOfCore} color="var(--ink)" />
      </div>
    </div>
  );
}
