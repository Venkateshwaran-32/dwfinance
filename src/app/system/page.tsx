"use client";

import { useEffect, useRef, useState } from "react";

type Sys = {
  time: string;
  machine: {
    platform: string;
    cores: number;
    totalMem: number;
    freeMem: number;
    usedMem: number;
    loadavg: [number, number, number];
    uptimeSec: number;
  };
  app: {
    pid: number;
    node: string;
    uptimeSec: number;
    cpuPctOfCore: number;
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
};

const POLL_MS = 2000;
const HISTORY = 40; // ~80s of history at 2s cadence

function gb(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(2) + " GB";
}
function mb(bytes: number) {
  return (bytes / 1024 ** 2).toFixed(0) + " MB";
}
function dur(sec: number) {
  const s = Math.floor(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function Bar({ pct, danger }: { pct: number; danger?: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = danger && clamped > 85 ? "var(--danger)" : "var(--accent)";
  return (
    <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${clamped}%`, background: color, borderRadius: 999, transition: "width .4s ease" }} />
    </div>
  );
}

function Spark({ data, max }: { data: number[]; max: number }) {
  const w = 260;
  const h = 44;
  if (data.length < 2) return <svg width={w} height={h} aria-hidden />;
  const step = w / (HISTORY - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - (Math.min(v, max) / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${h} ${pts.join(" ")} ${(data.length - 1) * step},${h}`;
  return (
    <svg width={w} height={h} style={{ display: "block" }} aria-hidden>
      <polygon points={area} fill="var(--chart-4)" opacity={0.25} />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
    </svg>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{sub}</div>}
    </div>
  );
}

export default function SystemPage() {
  const [sys, setSys] = useState<Sys | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memHist, setMemHist] = useState<number[]>([]);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const stop = useRef(false);

  useEffect(() => {
    stop.current = false;
    async function tick() {
      try {
        const r = await fetch("/api/system", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j: Sys = await r.json();
        if (stop.current) return;
        setSys(j);
        setErr(null);
        const memPct = (j.machine.usedMem / j.machine.totalMem) * 100;
        setMemHist((h) => [...h, memPct].slice(-HISTORY));
        setCpuHist((h) => [...h, j.app.cpuPctOfCore].slice(-HISTORY));
      } catch (e) {
        if (!stop.current) setErr(e instanceof Error ? e.message : "failed");
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stop.current = true;
      clearInterval(id);
    };
  }, []);

  const memPct = sys ? (sys.machine.usedMem / sys.machine.totalMem) * 100 : 0;
  const load1 = sys ? sys.machine.loadavg[0] : 0;
  const loadPct = sys ? (load1 / sys.machine.cores) * 100 : 0;

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "2rem 1rem 4rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>System monitor</h1>
        <a href="/dashboard" style={{ fontSize: 14 }}>← Dashboard</a>
      </div>
      <p style={{ color: "var(--text-dim)", marginTop: 4, fontSize: 13 }}>
        Live host + dev-server resource use. Local-only (disabled in production). Refreshes every {POLL_MS / 1000}s.
        {sys && <> · Updated {new Date(sys.time).toLocaleTimeString()}</>}
      </p>

      {err && (
        <div className="card" style={{ padding: 16, marginTop: 16, borderColor: "var(--danger)", color: "var(--danger)" }}>
          Couldn’t read system stats: {err}
        </div>
      )}

      {!sys && !err && <div className="card" style={{ padding: 16, marginTop: 16 }}>Reading…</div>}

      {sys && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
          {/* Machine RAM */}
          <div className="card" style={{ padding: 20 }}>
            <Stat
              label="Machine RAM used"
              value={`${memPct.toFixed(1)}%`}
              sub={`${gb(sys.machine.usedMem)} of ${gb(sys.machine.totalMem)} · ${gb(sys.machine.freeMem)} free`}
            />
            <div style={{ marginTop: 12 }}><Bar pct={memPct} danger /></div>
            <div style={{ marginTop: 12 }}><Spark data={memHist} max={100} /></div>
          </div>

          {/* CPU load */}
          <div className="card" style={{ padding: 20 }}>
            <Stat
              label="CPU load (1 min)"
              value={load1.toFixed(2)}
              sub={`${sys.machine.cores} cores · ≈${loadPct.toFixed(0)}% busy · 5m ${sys.machine.loadavg[1].toFixed(2)} · 15m ${sys.machine.loadavg[2].toFixed(2)}`}
            />
            <div style={{ marginTop: 12 }}><Bar pct={loadPct} danger /></div>
          </div>

          {/* App server RAM */}
          <div className="card" style={{ padding: 20 }}>
            <Stat
              label="dwfinance server RAM"
              value={mb(sys.app.rss)}
              sub={`heap ${mb(sys.app.heapUsed)} / ${mb(sys.app.heapTotal)} · ext ${mb(sys.app.external)}`}
            />
            <div style={{ marginTop: 12 }}>
              <Stat label="App CPU" value={`${sys.app.cpuPctOfCore.toFixed(0)}% of a core`} />
            </div>
            <div style={{ marginTop: 12 }}><Spark data={cpuHist} max={100} /></div>
          </div>

          {/* Uptime / meta */}
          <div className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
            <Stat label="Dev server up" value={dur(sys.app.uptimeSec)} sub={`pid ${sys.app.pid} · Node ${sys.app.node}`} />
            <Stat label="Mac up" value={dur(sys.machine.uptimeSec)} sub={sys.machine.platform} />
          </div>
        </div>
      )}
    </main>
  );
}
