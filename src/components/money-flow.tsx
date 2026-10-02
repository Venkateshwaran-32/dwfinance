"use client";
import "@/styles/money-flow.css";
import { useState, type CSSProperties } from "react";
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip, type SankeyLinkProps, type SankeyNodeProps } from "recharts";
import type { MoneyFlow } from "@/lib/cashflow";
import { categoryColor } from "@/lib/category-colors";
import { formatCents } from "@/lib/money";
import { sharePct, toSankey, truncate, type FlowNode } from "@/lib/money-flow-links";

// Fills go through style so CSS tokens resolve inside the SVG; category fills come from category-colors.ts.
function nodeFill(n: Pick<FlowNode, "name" | "kind">): string {
  if (n.kind === "income" || n.kind === "saved") return "var(--pos)";
  if (n.kind === "drawdown") return "var(--chart-3)";
  if (n.kind === "total") return "var(--text)";
  return categoryColor(n.name);
}

const NODE_PX = 44;
const MIN_INNER = 320;
const LABEL_GAP = 8;
// Rough Inter widths at 12px/600 and 11px/400; used only to reserve label room in the margins.
const labelWidth = (n: FlowNode, total: number) =>
  Math.max(truncate(n.name).length * 7, `${formatCents(n.cents)} ${sharePct(n.cents, total)}`.length * 6.2) + LABEL_GAP + 6;

type Active = { type: "node" | "link"; index: number } | null;

function SankeyView({ flow }: { flow: MoneyFlow }) {
  const [active, setActive] = useState<Active>(null);
  const { nodes, links, middle } = toSankey(flow);
  const total = flow.totalCents;
  const left = nodes.filter((n) => n.column === 0);
  const right = nodes.filter((n) => n.column === 2);
  const margin = {
    top: 44,
    bottom: 12,
    left: Math.ceil(Math.max(0, ...left.map((n) => labelWidth(n, total)))),
    right: Math.ceil(Math.max(0, ...right.map((n) => labelWidth(n, total)))),
  };
  const height = Math.max(MIN_INNER, Math.max(left.length, right.length) * NODE_PX) + margin.top + margin.bottom;

  const linkLit = (i: number) => {
    if (!active) return false;
    if (active.type === "link") return active.index === i;
    const l = links[i];
    return active.index === middle || l.source === active.index || l.target === active.index;
  };

  const savedCents = flow.uses.find((u) => u.kind === "saved")?.cents ?? 0;
  const drawCents = flow.sources.find((s) => s.kind === "drawdown")?.cents ?? 0;
  const summary =
    `Money flow: ${formatCents(flow.incomeCents)} came in, ${formatCents(flow.spendCents)} went out` +
    (savedCents ? `, ${formatCents(savedCents)} saved.` : drawCents ? `, ${formatCents(drawCents)} came from savings.` : ".");

  const renderNode = (p: SankeyNodeProps) => {
    const n = nodes[p.index];
    if (!n) return <Layer />;
    const lit = active?.type === "node" && active.index === p.index;
    const h = Math.max(p.height, 2);
    const cy = p.y + h / 2;
    const pct = sharePct(n.cents, total);
    let tx = p.x + p.width + LABEL_GAP;
    let anchor: "start" | "end" | "middle" = "start";
    let nameY = cy - 2;
    let amtY = cy + 12;
    if (n.column === 0) { tx = p.x - LABEL_GAP; anchor = "end"; }
    if (n.column === 1) { tx = p.x + p.width / 2; anchor = "middle"; nameY = p.y - 24; amtY = p.y - 9; }
    return (
      <Layer>
        <g
          className="mf-node"
          tabIndex={0}
          aria-label={`${n.name}, ${formatCents(n.cents)}, ${pct} of total`}
          onFocus={() => setActive({ type: "node", index: p.index })}
          onBlur={() => setActive(null)}
        >
          <Rectangle x={p.x} y={p.y} width={p.width} height={h} radius={2} style={{ fill: nodeFill(n), fillOpacity: lit ? 1 : 0.92 }} />
          <text x={tx} y={nameY} textAnchor={anchor} className="mf-label-name">{truncate(n.name)}</text>
          <text x={tx} y={amtY} textAnchor={anchor} className="mf-label-amt">
            {formatCents(n.cents)}
            {n.column !== 1 && <tspan className="mf-label-pct" dx={5}>{pct}</tspan>}
          </text>
        </g>
      </Layer>
    );
  };

  const renderLink = (p: SankeyLinkProps) => (
    <path
      className="mf-link"
      d={`M${p.sourceX},${p.sourceY} C${p.sourceControlX},${p.sourceY} ${p.targetControlX},${p.targetY} ${p.targetX},${p.targetY}`}
      fill="none"
      strokeWidth={Math.max(p.linkWidth, 1)}
      style={{ stroke: "var(--text)", strokeOpacity: linkLit(p.index) ? 0.32 : 0.1 } as CSSProperties}
    />
  );

  return (
    <div className="mf-sankey" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={{ nodes, links }}
          node={renderNode}
          link={renderLink}
          sort={false}
          nodeWidth={12}
          nodePadding={28}
          margin={margin}
          role="img"
          aria-label={summary}
          onMouseEnter={(item, type) => setActive({ type, index: item.index })}
          onMouseLeave={() => setActive(null)}
        >
          <Tooltip
            formatter={(v) => formatCents(Number(v))}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)", fontSize: 13 }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

function BarList({ title, rows, total }: { title: string; rows: { name: string; cents: number; kind: FlowNode["kind"] }[]; total: number }) {
  return (
    <div className="mf-bars-group">
      <h3 className="mf-bars-title">{title}</h3>
      <ul className="mf-bars">
        {rows.filter((r) => r.cents > 0).map((r) => (
          <li key={r.name} className="mf-bar-row">
            <span className="mf-bar-name">{r.name}</span>
            <span className="mf-bar-amt amount">
              {formatCents(r.cents)}
              <span className="mf-bar-pct">{sharePct(r.cents, total)}</span>
            </span>
            <span className="mf-bar-track" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (r.cents / total) * 100)}%`, background: nodeFill(r) }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MoneyFlowChart({ flow }: { flow: MoneyFlow }) {
  if (flow.totalCents === 0) return null;
  const total = flow.totalCents;
  return (
    <section className="card card-pad mf">
      <h2 className="card-title">Money flow</h2>
      <p className="card-sub">Where your money came from and where it went</p>

      {/* Both layouts render; CSS picks one at 640px so there is no hydration flash. */}
      <div className="mf-desktop">
        <SankeyView flow={flow} />
      </div>
      <div className="mf-phone" aria-hidden="true">
        <BarList title="Came from" rows={flow.sources} total={total} />
        <BarList title="Went to" rows={flow.uses} total={total} />
      </div>

      {/* wrapper carries sr-only: a <table> ignores width/overflow and widened the phone viewport */}
      <div className="sr-only"><table>
        <caption>Money flow, total {formatCents(total)}</caption>
        <thead>
          <tr><th scope="col">Direction</th><th scope="col">Name</th><th scope="col">Amount</th><th scope="col">Share</th></tr>
        </thead>
        <tbody>
          {flow.sources.map((s) => (
            <tr key={`in-${s.name}`}><td>Came from</td><th scope="row">{s.name}</th><td>{formatCents(s.cents)}</td><td>{sharePct(s.cents, total)}</td></tr>
          ))}
          {flow.uses.map((u) => (
            <tr key={`out-${u.name}`}><td>Went to</td><th scope="row">{u.name}</th><td>{formatCents(u.cents)}</td><td>{sharePct(u.cents, total)}</td></tr>
          ))}
        </tbody>
      </table></div>

      {flow.paynowPeopleCents > 0 && (
        <p className="mf-note">
          Of your spending, <b>{formatCents(flow.paynowPeopleCents)}</b> went to people via PayNow, which a bank statement only shows as transfers.
        </p>
      )}
    </section>
  );
}
