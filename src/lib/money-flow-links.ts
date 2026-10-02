import type { MoneyFlow } from "@/lib/cashflow";

// Sankey graph for the money-flow chart: sources -> one "Money in" node -> uses. Values stay in cents.
export type FlowNodeKind = MoneyFlow["sources"][number]["kind"] | MoneyFlow["uses"][number]["kind"] | "total";
export type FlowNode = { name: string; cents: number; kind: FlowNodeKind; column: 0 | 1 | 2 };
export type FlowLink = { source: number; target: number; value: number };

export const MIDDLE_NAME = "Money in";

export function toSankey(flow: MoneyFlow): { nodes: FlowNode[]; links: FlowLink[]; middle: number } {
  // Zero-cent rows would draw invisible nodes with stacked labels; drop them.
  const sources = flow.sources.filter((s) => s.cents > 0);
  const uses = flow.uses.filter((u) => u.cents > 0);
  const middle = sources.length;
  const nodes: FlowNode[] = [
    ...sources.map((s) => ({ name: s.name, cents: s.cents, kind: s.kind, column: 0 as const })),
    { name: MIDDLE_NAME, cents: flow.totalCents, kind: "total", column: 1 },
    ...uses.map((u) => ({ name: u.name, cents: u.cents, kind: u.kind, column: 2 as const })),
  ];
  const links: FlowLink[] = [
    ...sources.map((s, i) => ({ source: i, target: middle, value: s.cents })),
    ...uses.map((u, j) => ({ source: middle, target: middle + 1 + j, value: u.cents })),
  ];
  return { nodes, links, middle };
}

// Share of total as a whole percent; tiny non-zero shares read "<1%" instead of a misleading "0%".
export function sharePct(cents: number, totalCents: number): string {
  if (totalCents <= 0 || cents <= 0) return "0%";
  const pct = (cents / totalCents) * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

export function truncate(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}
