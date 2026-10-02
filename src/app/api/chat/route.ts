import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { chatWithTools, loadedModel, ChatError, type ChatMessage } from "@/server/llm";
import { chatTools, runTool, SYSTEM_PROMPT, pendingActionFrom } from "@/server/chat-tools";
import { CATEGORIES } from "@/server/categorize";
import { acquireChatSlot, BUSY_REPLY, rateLimit, screenInput, screenOutput, statesFigures, UNGROUNDED_REPLY } from "@/server/chat-guard";

// Chat assistant over the signed-in user's own transactions (local LM Studio model, read-only tools).
// /api/* is not behind middleware: every handler checks the session. Never log message content or txn data.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATUS_TIMEOUT_MS = 3000;

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) })).min(1).max(12)
    .refine((m) => m[m.length - 1]?.role === "user", "last message must be from the user"),
});

const pendingSchema = z.object({
  type: z.literal("payee_category"), matchKey: z.string(), payee: z.string(), category: z.string(),
  count: z.number(), alreadyCount: z.number(),
  samples: z.array(z.object({ date: z.string(), description: z.string(), amountCents: z.number(), category: z.string() })),
});

const err = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

async function dataRange(userId: string) {
  const a = await db.transaction.aggregate({ where: { userId }, _min: { date: true }, _max: { date: true }, _count: { _all: true } });
  return { from: day(a._min.date), to: day(a._max.date), txnCount: a._count._all };
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return err(401, "unauthenticated", "Sign in first.");
  let model: string | null = null;
  try {
    model = await Promise.race([
      loadedModel(true),
      new Promise<never>((_, rej) => setTimeout(() => rej(new ChatError("timeout", "status check")), STATUS_TIMEOUT_MS)),
    ]);
  } catch { model = null; }
  return Response.json({ ready: model !== null, model, ...(await dataRange(userId)) });
}

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return err(401, "unauthenticated", "Sign in first.");

  let raw: unknown;
  try { raw = await req.json(); } catch { return err(400, "bad_request", "Body must be JSON."); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return err(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request.");

  // Guard rails run in code before the model is involved (see src/server/chat-guard.ts).
  const limited = rateLimit(userId);
  if (limited) return err(429, "rate_limited", limited.answer);
  const msgs = parsed.data.messages;
  const blocked = screenInput(msgs[msgs.length - 1].content);
  if (blocked) {
    log.warn("chat guard", blocked.code); // the code only, never the text
    return Response.json({ answer: blocked.answer, evidence: [], pendingAction: null, model: null, guard: blocked.code });
  }
  // Earlier turns that were blocked (and the canned reply after them) never reach the model as context.
  const history = msgs.filter((m, i) => !(m.role === "user" ? screenInput(m.content) : i > 0 && msgs[i - 1].role === "user" && screenInput(msgs[i - 1].content)));

  const release = acquireChatSlot();
  if (!release) return err(503, "busy", BUSY_REPLY);
  try {
    const model = await loadedModel(true);
    const { from, to } = await dataRange(userId);
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT({ from: from ?? "no data", to: to ?? "no data", categories: CATEGORIES }) },
      ...history,
    ];
    const run = (requireTool: boolean) => chatWithTools({ messages, tools: chatTools, requireTool, execute: (n, a) => runTool(userId, n, a) });
    let { answer, steps } = await run(false);
    // Never let a figure through that was not looked up this turn (a small model sometimes "remembers" or invents
    // one on a follow-up question): force a lookup once, and if it still has none, say so instead of guessing.
    if (steps.length === 0 && statesFigures(answer)) {
      ({ answer, steps } = await run(true));
      if (steps.length === 0 && statesFigures(answer)) answer = UNGROUNDED_REPLY;
      log.warn("chat guard", "ungrounded-figures");
    }
    const pa = pendingSchema.safeParse(pendingActionFrom(steps));
    return Response.json({ answer: screenOutput(answer), evidence: steps, pendingAction: pa.success ? pa.data : null, model });
  } catch (e) {
    if (e instanceof ChatError) {
      if (e.reason === "unreachable") return err(503, "lm_unreachable", "LM Studio isn't running. Open LM Studio and start the server on port 1234.");
      if (e.reason === "no-model") return err(503, "no_model", "No model is loaded in LM Studio. Load a chat model (e.g. Qwen) and try again.");
      if (e.reason === "timeout") return err(504, "timeout", "The local model took too long. Try a shorter question.");
    }
    log.error("chat failed", e instanceof ChatError ? `ChatError:${e.reason}` : e instanceof Error ? e.name : "unknown");
    return err(500, "failed", "Something went wrong answering that. Please try again.");
  } finally {
    release();
  }
}
