// Turns a chat answer's tool steps into a deep link on /dashboard/statements that highlights the exact
// rows the answer was computed from. Shared by the chat panel (client) and its tests; no server imports.
type Step = { tool: string; args: unknown; result: unknown };
type Filter = { q?: string; category?: string; from?: string; to?: string };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function monthBounds(ym: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

function filterFor(step: Step): Filter | null {
  const a = obj(step.args);
  const r = obj(step.result);
  switch (step.tool) {
    case "find_transactions":
      return { q: str(a.text), category: str(a.category), from: str(a.from), to: str(a.to) };
    case "spend_summary": {
      const f: Filter = { category: str(a.category), from: str(a.from), to: str(a.to) };
      // "Which month..." answers point at the top month itself.
      const top = Array.isArray(r.groups) ? obj(r.groups[0]) : {};
      if (a.groupBy === "month" && !f.from && !f.to && typeof top.name === "string") Object.assign(f, monthBounds(top.name));
      if (a.groupBy === "payee" && typeof top.name === "string") f.q = top.name;
      return f;
    }
    case "propose_payee_category":
      return { q: str(obj(r.pendingAction).payee) ?? str(a.payee) };
    default:
      return null;
  }
}

export function statementHref(steps: Step[]): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const f = filterFor(steps[i]);
    if (!f) continue;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    if ([...p.keys()].length) { p.set("all", "1"); return `/dashboard/statements?${p.toString()}#match`; } // all=1: highlight in context
  }
  return "/dashboard/statements";
}
