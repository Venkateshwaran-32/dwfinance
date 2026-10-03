/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are untyped JSON by design */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway SQLite (never dev.db). rules.ts is another agent's module: mocked so this suite is independent.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dwf-chat-"));
const url = `file:${path.join(dir, "test.db")}`;

vi.mock("@/server/rules", () => ({
  resolvePayee: vi.fn(),
  previewPayeeRule: vi.fn(),
  applyPayeeRule: vi.fn(() => { throw new Error("must never be called"); }),
}));

type Mod = typeof import("@/server/chat-tools");
type Llm = typeof import("@/server/llm");
let tools: Mod;
let llm: Llm;
let rules: typeof import("@/server/rules");
let db: typeof import("@/lib/db").db;
const A = "user-a", B = "user-b";

beforeAll(async () => {
  execSync("npx prisma db push --skip-generate", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  process.env.DATABASE_URL = url;
  ({ db } = await import("@/lib/db"));
  tools = await import("@/server/chat-tools");
  llm = await import("@/server/llm");
  rules = await import("@/server/rules");
  for (const id of [A, B]) {
    await db.user.create({ data: { id, email: `${id}@x.test`, passwordHash: "x" } });
    await db.statement.create({ data: { id: `st-${id}`, userId: id, period: "2026-01" } });
  }
  const t = (userId: string, date: string, description: string, amountCents: number, category: string, counterparty: string | null = null) =>
    ({ userId, statementId: `st-${userId}`, date: new Date(`${date}T00:00:00Z`), description, counterparty, amountCents, category });
  await db.transaction.createMany({ data: [
    t(A, "2026-01-03", "NTUC FAIRPRICE", -4550, "Groceries", "NTUC FAIRPRICE"),
    t(A, "2026-01-10", "GRAB RIDE", -1230, "Transport", "GRAB"),
    t(A, "2026-01-15", "SALARY", 500000, "Income"),
    t(A, "2026-01-20", "PAYNOW TRANSFER", -2000, "Transfers", "Goh Kok Meng"),
    t(A, "2026-02-02", "NTUC FAIRPRICE", -3025, "Groceries", "NTUC FAIRPRICE"),
    t(A, "2026-02-05", "GRAB RIDE", -870, "Transport", "GRAB"),
    t(A, "2026-02-14", "PAYNOW TRANSFER", -1500, "Transfers", "Goh Kok Meng"),
    t(B, "2026-01-05", "NTUC FAIRPRICE", -99999, "Groceries", "NTUC FAIRPRICE"),
    t(B, "2026-02-05", "SECRET SHOP", -77777, "Shopping"),
  ] });
}, 60_000);

afterAll(async () => { await db?.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("chat tools (read-only, user-scoped)", () => {
  it("spend_summary can rank payees by how often they were paid, and always names the most frequent", async () => {
    // By amount, NTUC (S$75.75) beats Goh Kok Meng (S$35.00); by count they tie at 2, and the tie goes to the bigger total.
    const byTotal = await tools.runTool(A, "spend_summary", { groupBy: "payee" }) as any;
    expect(byTotal.sortedBy).toBe("total");
    expect(byTotal.groups[0].name).toBe("NTUC FAIRPRICE");
    expect(byTotal.mostFrequent).toEqual({ name: "NTUC FAIRPRICE", count: 2, formatted: "S$75.75" });
    // Scoped to January only: every payee was paid once, so the most frequent is the biggest of the ties.
    const jan = await tools.runTool(A, "spend_summary", { groupBy: "payee", sortBy: "count", from: "2026-01-01", to: "2026-01-31" }) as any;
    expect(jan.sortedBy).toBe("count");
    expect(jan.groups.map((g: any) => g.count)).toEqual([1, 1, 1]);
    expect(jan.mostFrequent.count).toBe(1);
  });

  it("get_insights subscriptions says it covers all the data, not one month", async () => {
    const s = await tools.runTool(A, "get_insights", { kind: "subscriptions" }) as any;
    expect(s.scope).toBe("all data, 2026-01-03 to 2026-02-14");
    expect(s.note).toMatch(/ALL the data/);
  });

  it("spend_summary totals are exact and scoped to the user", async () => {
    const r = await tools.runTool(A, "spend_summary", { groupBy: "category" }) as any;
    expect(r.groups).toEqual([
      { name: "Groceries", totalCents: 7575, formatted: "S$75.75", count: 2 },
      { name: "Transfers", totalCents: 3500, formatted: "S$35.00", count: 2 },
      { name: "Transport", totalCents: 2100, formatted: "S$21.00", count: 2 },
    ]);
    expect(r.grandTotal).toEqual({ cents: 13175, formatted: "S$131.75" });
    const m = await tools.runTool(A, "spend_summary", { groupBy: "month", category: "Groceries", from: "2026-02-01", to: "2026-02-28" }) as any;
    expect(m.groups).toMatchObject([{ name: "2026-02", totalCents: 3025, formatted: "S$30.25", count: 1 }]);
    expect(m.groups[0]).toMatchObject({ topCategories: [{ category: "Groceries", formatted: "S$30.25" }], biggestCharge: { payee: "NTUC FAIRPRICE", formatted: "S$30.25" } });
    const inc = await tools.runTool(A, "spend_summary", { groupBy: "payee", direction: "in" }) as any;
    expect(inc.grandTotal.cents).toBe(500000);
  });

  it("never returns another user's rows", async () => {
    const all = JSON.stringify([
      await tools.runTool(A, "get_overview", {}),
      await tools.runTool(A, "spend_summary", { groupBy: "payee", limit: 20 }),
      await tools.runTool(A, "find_transactions", { limit: 20 }),
      await tools.runTool(A, "find_transactions", { text: "secret" }),
    ]);
    expect(all).not.toMatch(/SECRET|99999|999\.99|77777|777\.77/i);
    const ov = await tools.runTool(A, "get_overview", {}) as any;
    expect(ov).toMatchObject({ count: 7, from: "2026-01-03", to: "2026-02-14", totalIn: { cents: 500000 }, totalOut: { cents: 13175, formatted: "S$131.75" } });
  });

  it("find_transactions sums all matches while capping rows", async () => {
    const r = await tools.runTool(A, "find_transactions", { limit: 2 }) as any;
    expect(r.rows).toHaveLength(2);
    expect(r.totalMatched).toBe(7);
    expect(r.sumCents).toBe(500000 - 13175);
    expect(r.rows[0]).toMatchObject({ date: "2026-02-14", amount: "-S$15.00", category: "Transfers" });
    const g = await tools.runTool(A, "find_transactions", { text: "grab", minAmount: 10 }) as any;
    expect(g).toMatchObject({ totalMatched: 1, sumCents: -1230 });
  });

  it("rejects bad args with an error object, not a throw", async () => {
    for (const [name, args] of [
      ["spend_summary", { groupBy: "category", from: "2026-13-45" }],
      ["spend_summary", { groupBy: "category", category: "Crypto" }],
      ["find_transactions", { limit: 99 }],
      ["spend_summary", {}],
    ] as const) {
      const r = await tools.runTool(A, name, args) as any;
      expect(r.error).toBe("invalid arguments");
      expect(r.issues.length).toBeGreaterThan(0);
    }
    expect(await tools.runTool(A, "drop_tables", {})).toMatchObject({ error: "unknown tool: drop_tables" });
    // nulls from local models are treated as omitted
    expect(await tools.runTool(A, "find_transactions", { text: null, limit: null })).toMatchObject({ totalMatched: 7 });
  });

  it("get_insights returns trimmed lists with formatted money", async () => {
    const r = await tools.runTool(A, "get_insights", { kind: "peers" }) as any;
    expect(r.items.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(r)).toContain("S$");
  });

  it("propose_payee_category returns a pendingAction and writes nothing", async () => {
    vi.mocked(rules.resolvePayee).mockResolvedValue([{ matchKey: "goh kok meng", payee: "Goh Kok Meng", count: 2 }]);
    vi.mocked(rules.previewPayeeRule).mockResolvedValue({
      matchKey: "goh kok meng", payee: "Goh Kok Meng", category: "Food & Dining", count: 2, alreadyCount: 0,
      samples: [{ date: "2026-02-14", description: "PAYNOW TRANSFER", amountCents: -1500, category: "Transfers" }],
    });
    const before = await db.transaction.findMany({ orderBy: { id: "asc" }, select: { id: true, category: true, source: true } });
    const r = await tools.runTool(A, "propose_payee_category", { payee: "goh kok meng", category: "Food & Dining" }) as any;
    expect(r.pendingAction).toMatchObject({ type: "payee_category", matchKey: "goh kok meng", category: "Food & Dining", count: 2, alreadyCount: 0 });
    expect(r.note).toMatch(/NOT applied/);
    expect(vi.mocked(rules.resolvePayee)).toHaveBeenCalledWith(A, "goh kok meng");
    expect(vi.mocked(rules.applyPayeeRule)).not.toHaveBeenCalled();
    expect(await db.transaction.findMany({ orderBy: { id: "asc" }, select: { id: true, category: true, source: true } })).toEqual(before);
    expect(await db.merchantRule.count()).toBe(0);
    expect(tools.pendingActionFrom([{ tool: "propose_payee_category", args: {}, result: r }])).toEqual(r.pendingAction);
    expect(tools.pendingActionFrom([])).toBeNull();
  });

  it("propose_payee_category asks when ambiguous and errors when nothing matches", async () => {
    vi.mocked(rules.resolvePayee).mockResolvedValueOnce([
      { matchKey: "goh kok meng", payee: "Goh Kok Meng", count: 2 }, { matchKey: "lim kok meng", payee: "Lim Kok Meng", count: 1 },
    ]);
    const amb = await tools.runTool(A, "propose_payee_category", { payee: "kok meng", category: "Transfers" }) as any;
    expect(amb.ambiguous).toBe(true);
    expect(amb.candidates).toHaveLength(2);
    expect(amb.pendingAction).toBeUndefined();
    vi.mocked(rules.resolvePayee).mockResolvedValueOnce([]);
    expect(await tools.runTool(A, "propose_payee_category", { payee: "nobody", category: "Transfers" })).toEqual({ error: "no payee found", suggestions: [] });
  });

  it("system prompt carries the guardrails and date range", () => {
    const p = tools.SYSTEM_PROMPT({ from: "2026-01-03", to: "2026-02-14", categories: ["Groceries"] });
    expect(p).toContain("2026-01-03 to 2026-02-14");
    expect(p).toMatch(/untrusted/);
    expect(p).toMatch(/Confirm/);
  });
});

// --- chatWithTools against a mocked LM Studio (never a live server) ---
const MODELS = { data: [{ id: "qwen-test", type: "llm", state: "loaded" }] };
const reply = (message: object) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message }] }), text: async () => "" });

function mockLm(messages: object[]) {
  const bodies: any[] = [];
  const fetchMock = vi.fn(async (u: string, init?: RequestInit) => {
    if (u.endsWith("/models")) return { ok: true, status: 200, json: async () => MODELS };
    bodies.push(JSON.parse(String(init?.body)));
    return reply(messages[Math.min(bodies.length - 1, messages.length - 1)]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return bodies;
}

describe("chatWithTools", () => {
  const base = { messages: [{ role: "user" as const, content: "how much on groceries?" }], tools: [] as any[] };

  it("runs tool_calls then returns the final text", async () => {
    const bodies = mockLm([
      { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "spend_summary", arguments: '{"groupBy":"category"}' } }] },
      { content: "<think>adding up</think>You spent S$75.75 on groceries." },
    ]);
    const execute = vi.fn(async () => ({ total: "S$75.75" }));
    const r = await llm.chatWithTools({ ...base, execute });
    expect(r.answer).toBe("You spent S$75.75 on groceries.");
    expect(r.steps).toEqual([{ tool: "spend_summary", args: { groupBy: "category" }, result: { total: "S$75.75" } }]);
    expect(execute).toHaveBeenCalledWith("spend_summary", { groupBy: "category" });
    expect(bodies[0]).toMatchObject({ model: "qwen-test", temperature: 0, tool_choice: "auto", max_tokens: 1500 });
    expect(bodies[1].messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: '{"total":"S$75.75"}' });
  });

  it("parses <tool_call> text emitted in content, and uses reasoning_content when content is empty", async () => {
    mockLm([
      { content: '<tool_call>{"name":"get_overview","arguments":{}}</tool_call>' },
      { content: "", reasoning_content: "Data covers Jan to Feb." },
    ]);
    const r = await llm.chatWithTools({ ...base, execute: async () => ({ count: 7 }) });
    expect(r.steps).toEqual([{ tool: "get_overview", args: {}, result: { count: 7 } }]);
    expect(r.answer).toBe("Data covers Jan to Feb.");
  });

  it("feeds back invalid JSON arguments without executing", async () => {
    const bodies = mockLm([
      { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_overview", arguments: "{oops" } }] },
      { content: "" },
    ]);
    const execute = vi.fn();
    const r = await llm.chatWithTools({ ...base, execute });
    expect(execute).not.toHaveBeenCalled();
    expect(bodies[1].messages.at(-1).content).toBe('{"error":"invalid JSON arguments"}');
    expect(r.answer).toBe("I could not produce an answer.");
  });

  it("throws ChatError unreachable when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(llm.chatWithTools({ ...base, execute: async () => ({}) })).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("throws ChatError no-model when nothing is loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "qwen", type: "llm", state: "not-loaded" }] }) })));
    await expect(llm.chatWithTools({ ...base, execute: async () => ({}) })).rejects.toMatchObject({ reason: "no-model" });
  });

  it("respects maxRounds, then forces a text answer with tool_choice none", async () => {
    const loop = { content: "", tool_calls: [{ id: "c", type: "function", function: { name: "get_overview", arguments: "{}" } }] };
    const bodies = mockLm([loop, loop, { content: "Here is what I found." }]);
    const execute = vi.fn(async () => ({ ok: 1 }));
    const r = await llm.chatWithTools({ ...base, maxRounds: 2, execute });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(bodies).toHaveLength(3);
    expect(bodies[2].tool_choice).toBe("none");
    expect(r.answer).toBe("Here is what I found.");
  });

  it("truncates tool results to 6000 chars", async () => {
    const bodies = mockLm([
      { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "x", arguments: "{}" } }] },
      { content: "done" },
    ]);
    await llm.chatWithTools({ ...base, execute: async () => "a".repeat(10000) });
    expect(bodies[1].messages.at(-1).content).toHaveLength(6000);
  });
});
