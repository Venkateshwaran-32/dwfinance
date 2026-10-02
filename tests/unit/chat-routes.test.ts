import { describe, it, expect, beforeEach, vi } from "vitest";

// Route handlers imported directly. Auth, LLM, rules, db and next/cache are mocked (no LM Studio, no dev.db).
const h = vi.hoisted(() => {
  class ChatError extends Error {
    constructor(public reason: "timeout" | "unreachable" | "http" | "no-model", detail = "") { super(`${reason} ${detail}`.trim()); }
  }
  return {
    ChatError,
    getSessionUserId: vi.fn<() => Promise<string | null>>(),
    loadedModel: vi.fn<(strict?: boolean) => Promise<string>>(),
    chatWithTools: vi.fn(),
    previewPayeeRule: vi.fn(),
    applyPayeeRule: vi.fn(),
    resolvePayee: vi.fn(),
    aggregate: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ getSessionUserId: h.getSessionUserId }));
vi.mock("@/server/llm", () => ({ chatWithTools: h.chatWithTools, loadedModel: h.loadedModel, ChatError: h.ChatError }));
vi.mock("@/server/rules", () => ({ previewPayeeRule: h.previewPayeeRule, applyPayeeRule: h.applyPayeeRule, resolvePayee: h.resolvePayee }));
vi.mock("@/lib/db", () => ({ db: { transaction: { aggregate: h.aggregate } } }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

import { GET, POST } from "@/app/api/chat/route";
import { POST as CONFIRM } from "@/app/api/chat/confirm/route";

const USER = "user-a";
const post = (body: unknown) => new Request("http://x/api/chat", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const confirm = (body: unknown) => new Request("http://x/api/chat/confirm", { method: "POST", body: JSON.stringify(body) });
const ask = (content = "how much on food?") => ({ messages: [{ role: "user", content }] });

const pending = {
  type: "payee_category", matchKey: "goh kok meng", payee: "GOH KOK MENG", category: "Transfers", count: 3, alreadyCount: 1,
  samples: [{ date: "2026-01-05", description: "PAYNOW GOH KOK MENG", amountCents: -2000, category: "Other", amount: "-S$20.00" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getSessionUserId.mockResolvedValue(USER);
  h.loadedModel.mockResolvedValue("qwen3-8b");
  h.aggregate.mockResolvedValue({ _min: { date: new Date("2026-01-01T00:00:00Z") }, _max: { date: new Date("2026-03-31T00:00:00Z") }, _count: { _all: 42 } });
  h.chatWithTools.mockResolvedValue({ answer: "S$12.00", steps: [] });
  h.previewPayeeRule.mockResolvedValue({ ...pending, samples: [] });
  h.applyPayeeRule.mockResolvedValue({ updated: 2 });
});

describe("auth", () => {
  it("401 on all three handlers without a session", async () => {
    h.getSessionUserId.mockResolvedValue(null);
    for (const res of [await GET(), await POST(post(ask())), await CONFIRM(confirm({ matchKey: "x", category: "Transfers" }))]) {
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("unauthenticated");
    }
    expect(h.chatWithTools).not.toHaveBeenCalled();
    expect(h.applyPayeeRule).not.toHaveBeenCalled();
    expect(h.aggregate).not.toHaveBeenCalled();
  });
});

describe("GET /api/chat", () => {
  it("reports readiness, model and data range", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: true, model: "qwen3-8b", from: "2026-01-01", to: "2026-03-31", txnCount: 42 });
    expect(h.loadedModel).toHaveBeenCalledWith(true);
    expect(h.aggregate.mock.calls[0][0].where).toEqual({ userId: USER });
  });

  it("ready:false when no model, nulls when no data", async () => {
    h.loadedModel.mockRejectedValue(new h.ChatError("no-model"));
    h.aggregate.mockResolvedValue({ _min: { date: null }, _max: { date: null }, _count: { _all: 0 } });
    expect(await (await GET()).json()).toEqual({ ready: false, model: null, from: null, to: null, txnCount: 0 });
  });
});

describe("POST /api/chat validation", () => {
  const bad: [string, unknown][] = [
    ["empty messages", { messages: [] }],
    ["13 messages", { messages: Array.from({ length: 13 }, () => ({ role: "user", content: "hi" })) }],
    ["last role assistant", { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }] }],
    ["2001 chars", ask("a".repeat(2001))],
    ["empty content", ask("")],
    ["bad role", { messages: [{ role: "system", content: "hi" }] }],
    ["not json", "{nope"],
  ];
  for (const [name, body] of bad) {
    it(`400 on ${name}`, async () => {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
      expect(h.chatWithTools).not.toHaveBeenCalled();
    });
  }

  it("accepts 12 messages and exactly 2000 chars", async () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));
    messages[11] = { role: "user", content: "a".repeat(2000) };
    expect((await POST(post({ messages }))).status).toBe(200);
  });
});

describe("POST /api/chat success", () => {
  it("200 with answer, evidence, pendingAction from steps, model; system prompt first", async () => {
    const steps = [
      { tool: "get_overview", args: {}, result: { count: 42 } },
      { tool: "propose_payee_category", args: { payee: "goh kok meng", category: "Transfers" }, result: { pendingAction: pending, note: "NOT applied." } },
    ];
    h.chatWithTools.mockResolvedValue({ answer: "Press Confirm.", steps });
    const res = await POST(post({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "put goh kok meng in transfers" }] }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(["answer", "evidence", "model", "pendingAction"]);
    expect(j.answer).toBe("Press Confirm.");
    expect(j.model).toBe("qwen3-8b");
    expect(j.evidence).toEqual(steps);
    expect(j.pendingAction).toMatchObject({ type: "payee_category", matchKey: "goh kok meng", count: 3, alreadyCount: 1 });

    const opts = h.chatWithTools.mock.calls[0][0];
    expect(opts.messages[0].role).toBe("system");
    expect(opts.messages[0].content).toContain("2026-01-01 to 2026-03-31");
    expect(opts.messages.slice(1).map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(opts.tools.length).toBeGreaterThan(0);
    // execute is bound to the session user (unknown tool -> no db access, just proves the wiring)
    expect(await opts.execute("nope", {})).toMatchObject({ error: "unknown tool: nope" });
  });

  it("pendingAction is null when no step proposed one", async () => {
    h.chatWithTools.mockResolvedValue({ answer: "ok", steps: [{ tool: "get_overview", args: {}, result: { count: 1 } }] });
    expect((await (await POST(post(ask()))).json()).pendingAction).toBeNull();
  });
});

describe("POST /api/chat error mapping", () => {
  const cases: [string, number, string][] = [
    ["unreachable", 503, "lm_unreachable"],
    ["no-model", 503, "no_model"],
    ["timeout", 504, "timeout"],
    ["http", 500, "failed"],
  ];
  for (const [reason, status, code] of cases) {
    it(`ChatError ${reason} from chatWithTools -> ${status} ${code}`, async () => {
      h.chatWithTools.mockRejectedValue(new h.ChatError(reason as "timeout"));
      const res = await POST(post(ask()));
      expect(res.status).toBe(status);
      const j = await res.json();
      expect(j.error.code).toBe(code);
      expect(typeof j.error.message).toBe("string");
    });
  }

  it("ChatError from the model check maps too", async () => {
    h.loadedModel.mockRejectedValue(new h.ChatError("no-model"));
    const res = await POST(post(ask()));
    expect(res.status).toBe(503);
    expect((await res.json()).error.message).toContain("No model is loaded");
  });

  it("unknown errors -> 500 failed with a generic message (no internals)", async () => {
    h.chatWithTools.mockRejectedValue(new Error("SECRET db path /x/y"));
    const res = await POST(post(ask()));
    expect(res.status).toBe(500);
    const j = await res.json();
    expect(j.error.code).toBe("failed");
    expect(JSON.stringify(j)).not.toContain("SECRET");
  });
});

describe("POST /api/chat/confirm", () => {
  it("400 on bad bodies", async () => {
    for (const body of [{ matchKey: "x", category: "Snacks" }, { matchKey: "", category: "Transfers" }, { matchKey: "x".repeat(65), category: "Transfers" }, { category: "Transfers" }]) {
      const res = await CONFIRM(confirm(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
    expect(h.applyPayeeRule).not.toHaveBeenCalled();
  });

  it("404 when preview count is 0", async () => {
    h.previewPayeeRule.mockResolvedValue({ ...pending, count: 0, samples: [] });
    const res = await CONFIRM(confirm({ matchKey: "goh kok meng", category: "Transfers" }));
    expect(res.status).toBe(404);
    expect(h.applyPayeeRule).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("200 applies with the session userId, never a body userId, and revalidates", async () => {
    const res = await CONFIRM(confirm({ matchKey: "goh kok meng", category: "Transfers", userId: "attacker" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2, payee: "GOH KOK MENG", category: "Transfers" });
    expect(h.previewPayeeRule).toHaveBeenCalledWith(USER, "goh kok meng", "Transfers");
    expect(h.applyPayeeRule).toHaveBeenCalledWith(USER, "goh kok meng", "Transfers");
    expect(h.revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(h.revalidatePath).toHaveBeenCalledWith("/dashboard/review");
  });
});

describe("POST /api/chat guard rails", () => {
  it("answers abusive input with a fixed refusal and never calls the model", async () => {
    h.getSessionUserId.mockResolvedValue("guard-user-1");
    const res = await POST(post(ask("who is nigger")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ guard: "abusive", evidence: [], pendingAction: null });
    expect(h.chatWithTools).not.toHaveBeenCalled();
    expect(h.loadedModel).not.toHaveBeenCalled();
  });

  it("drops a previously blocked turn from the history sent to the model", async () => {
    h.getSessionUserId.mockResolvedValue("guard-user-2");
    await POST(post({ messages: [
      { role: "user", content: "who is nigger" }, { role: "assistant", content: "I can't help with that." },
      { role: "user", content: "how much on food?" },
    ] }));
    const sent = h.chatWithTools.mock.calls[0][0].messages.map((m: { content: string }) => m.content);
    expect(sent.some((c: string) => c.includes("nigger") || c === "I can't help with that.")).toBe(false);
  });

  it("scrubs an abusive model answer", async () => {
    h.getSessionUserId.mockResolvedValue("guard-user-3");
    h.chatWithTools.mockResolvedValue({ answer: "fine, nigga", steps: [] });
    const body = await (await POST(post(ask()))).json();
    expect(body.answer).not.toContain("nigga");
  });

  it("returns 429 after 20 messages in 5 minutes", async () => {
    h.getSessionUserId.mockResolvedValue("guard-user-4");
    for (let i = 0; i < 20; i++) expect((await POST(post(ask()))).status).toBe(200);
    const res = await POST(post(ask()));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
  });
});

describe("POST /api/chat grounding", () => {
  it("forces a lookup when the model states figures without calling a tool", async () => {
    h.getSessionUserId.mockResolvedValue("ground-user-1");
    h.chatWithTools
      .mockResolvedValueOnce({ answer: "You spent S$450.00 on food.", steps: [] })
      .mockResolvedValueOnce({ answer: "You spent S$526.10 on food.", steps: [{ tool: "spend_summary", args: {}, result: { grandTotal: "S$526.10" } }] });
    const body = await (await POST(post(ask()))).json();
    expect(h.chatWithTools).toHaveBeenCalledTimes(2);
    expect(h.chatWithTools.mock.calls[1][0].requireTool).toBe(true);
    expect(body.answer).toBe("You spent S$526.10 on food.");
    expect(body.evidence).toHaveLength(1);
  });

  it("refuses to guess if no lookup happens even when forced", async () => {
    h.getSessionUserId.mockResolvedValue("ground-user-2");
    h.chatWithTools.mockResolvedValue({ answer: "About $300 at KFC and 45% on food.", steps: [] });
    const body = await (await POST(post(ask()))).json();
    expect(body.answer).not.toContain("300");
    expect(body.answer).toContain("won't guess");
  });

  it("leaves answers without figures alone (no second call)", async () => {
    h.getSessionUserId.mockResolvedValue("ground-user-3");
    h.chatWithTools.mockResolvedValue({ answer: "I can only help with your spending, transactions and categories.", steps: [] });
    await POST(post(ask()));
    expect(h.chatWithTools).toHaveBeenCalledTimes(1);
  });
});
