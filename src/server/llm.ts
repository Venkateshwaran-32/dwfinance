import "server-only";
import { env } from "@/lib/env";

// --- LM Studio transport (OpenAI-compatible, 127.0.0.1 not localhost) ---
// Shared by the categorizer (json-schema calls) and the chat assistant (tool calls).

export class ChatError extends Error {
  constructor(public reason: "timeout" | "unreachable" | "http" | "no-model", detail = "") { super(`${reason} ${detail}`.trim()); }
}

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: object } };

// strict=true: only a model that is loaded right now (chat assistant); throws ChatError("no-model").
// strict=false (categorizer, unchanged behaviour): falls back to the first catalog chat model.
export async function loadedModel(strict = false): Promise<string> {
  // LM Studio's /v1/models lists the whole CATALOG, loaded or not — picking blindly from it can
  // select a model that then has to cold-load (or is the wrong kind). /api/v0/models carries a
  // `state` field, so prefer a chat model that is actually loaded right now.
  const v0 = env.LMSTUDIO_BASE_URL.replace(/\/v1\/?$/, "/api/v0");
  try {
    const res = await fetch(`${v0}/models`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const m = (await res.json()) as { data?: { id: string; type?: string; state?: string }[] };
      const chat = (m.data ?? []).filter((x) => x.type !== "embeddings" && !x.id.includes("embed"));
      const ready = chat.find((x) => x.state === "loaded");
      if (ready) return ready.id;
      if (strict) throw new ChatError("no-model", "no chat model loaded in LM Studio");
      if (chat.length) return chat[0].id;
    } else if (strict) throw new ChatError("http", `/models ${res.status}`);
  } catch (e) {
    if (strict) throw e instanceof ChatError ? e : new ChatError("unreachable", String(e).slice(0, 80));
    /* fall through to the plain OpenAI-compatible listing */
  }

  let res: Response;
  try { res = await fetch(`${env.LMSTUDIO_BASE_URL}/models`, { signal: AbortSignal.timeout(8000) }); }
  catch { throw new Error("LM Studio isn't reachable on :1234 — open LM Studio and start the local server."); }
  if (!res.ok) throw new Error(`LM Studio /models returned ${res.status}.`);
  const m = (await res.json()) as { data?: { id: string }[] };
  return (m.data ?? []).map((x) => x.id).find((id) => !id.includes("embed")) ?? "local-model";
}

async function post(body: object, timeoutMs: number): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${env.LMSTUDIO_BASE_URL}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ChatError(/timeout|abort/i.test(String(e)) ? "timeout" : "unreachable", String(e).slice(0, 80));
  }
  if (!res.ok) throw new ChatError("http", `${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res;
}

export async function chatJson(model: string, maxTokens: number, system: string, user: string, schema: object, timeoutMs = 240000): Promise<string> {
  const res = await post({
    model, temperature: 0, max_tokens: maxTokens,
    response_format: { type: "json_schema", json_schema: { name: "out", strict: true, schema } },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  }, timeoutMs);
  const d = (await res.json()) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
  const msg = d.choices?.[0]?.message;
  // Reasoning models (qwen3.x, gpt-oss...) put the schema-constrained answer in reasoning_content
  // and leave content empty. Reading only `content` silently yields {} and zero transactions.
  const raw = msg?.content?.trim() || msg?.reasoning_content?.trim() || "";
  if (!raw) return "{}";
  // Some reasoning models wrap or prefix the JSON — take the outermost object.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

// --- Tool-calling loop for the chat assistant ---
type ApiMessage = { content?: string | null; reasoning_content?: string | null; tool_calls?: ToolCall[] };
export type ChatStep = { tool: string; args: unknown; result: unknown };

const MAX_TOOL_RESULT = 6000;
const FALLBACK_ANSWER = "I could not produce an answer.";
const TOOL_CALL_TEXT = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").replace(/<think>[\s\S]*$/i, "");

// Some Qwen builds emit <tool_call>{"name":..,"arguments":{..}}</tool_call> as text instead of tool_calls.
function textToolCalls(content: string, round: number): ToolCall[] {
  const out: ToolCall[] = [];
  for (const m of stripThink(content).matchAll(TOOL_CALL_TEXT)) {
    try {
      const j = JSON.parse(m[1]) as { name?: unknown; arguments?: unknown };
      if (typeof j.name !== "string") continue;
      const args = typeof j.arguments === "string" ? j.arguments : JSON.stringify(j.arguments ?? {});
      out.push({ id: `text_${round}_${out.length}`, type: "function", function: { name: j.name, arguments: args } });
    } catch { /* not a tool call */ }
  }
  return out;
}

function answerOf(msg: ApiMessage | undefined): string {
  const clean = (s?: string | null) => stripThink(s ?? "").replace(TOOL_CALL_TEXT, "").trim();
  return clean(msg?.content) || clean(msg?.reasoning_content) || FALLBACK_ANSWER;
}

export async function chatWithTools(opts: {
  messages: ChatMessage[]; tools: ToolDef[]; maxRounds?: number; timeoutMs?: number;
  requireTool?: boolean; // the first round must call a tool (used when a reply stated figures it never looked up)
  execute: (name: string, args: unknown) => Promise<unknown>;
}): Promise<{ answer: string; steps: ChatStep[] }> {
  const maxRounds = opts.maxRounds ?? 6;
  const deadline = Date.now() + (opts.timeoutMs ?? 90000);
  const model = await loadedModel(true);
  const messages: ChatMessage[] = [...opts.messages];
  const steps: ChatStep[] = [];

  const call = async (toolChoice: "auto" | "none" | "required"): Promise<ApiMessage | undefined> => {
    const left = deadline - Date.now();
    if (left <= 0) throw new ChatError("timeout", "chat deadline exceeded");
    const res = await post({ model, temperature: 0, max_tokens: 1500, stream: false, tools: opts.tools, tool_choice: toolChoice, messages }, left);
    const d = (await res.json()) as { choices?: { message?: ApiMessage }[] };
    return d.choices?.[0]?.message;
  };

  for (let round = 0; round < maxRounds; round++) {
    const msg = await call(opts.requireTool && round === 0 ? "required" : "auto");
    const calls = msg?.tool_calls?.length ? msg.tool_calls : textToolCalls(msg?.content ?? "", round);
    if (!calls.length) return { answer: answerOf(msg), steps };
    messages.push({ role: "assistant", content: msg?.tool_calls?.length ? (msg.content ?? null) : null, tool_calls: calls });
    for (const tc of calls) {
      let result: unknown;
      let args: unknown;
      try { args = JSON.parse(tc.function.arguments || "{}"); }
      catch { result = { error: "invalid JSON arguments" }; }
      if (result === undefined) {
        try { result = await opts.execute(tc.function.name, args); }
        catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
      }
      steps.push({ tool: tc.function.name, args: args ?? tc.function.arguments, result });
      messages.push({ role: "tool", tool_call_id: tc.id, content: (JSON.stringify(result) ?? "null").slice(0, MAX_TOOL_RESULT) });
    }
  }
  // Round budget spent: one last call that must answer in text.
  return { answer: answerOf(await call("none")), steps };
}
