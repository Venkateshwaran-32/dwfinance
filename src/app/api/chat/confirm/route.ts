import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { log } from "@/lib/logger";
import { applyPayeeRule, previewPayeeRule } from "@/server/rules";
import { CATEGORIES } from "@/server/categorize";

// Applies a payee -> category rule the user explicitly confirmed in chat. userId always comes from the
// session, never the body (unknown body keys are stripped).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ matchKey: z.string().trim().min(1).max(64), category: z.enum(CATEGORIES) });

const err = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return err(401, "unauthenticated", "Sign in first.");

  let raw: unknown;
  try { raw = await req.json(); } catch { return err(400, "bad_request", "Body must be JSON."); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return err(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const { matchKey, category } = parsed.data;

  try {
    const preview = await previewPayeeRule(userId, matchKey, category);
    if (preview.count === 0) return err(404, "not_found", "No transactions match that payee any more.");
    const { updated } = await applyPayeeRule(userId, matchKey, category);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/review");
    return Response.json({ updated, payee: preview.payee, category });
  } catch (e) {
    log.error("chat confirm failed", e instanceof Error ? e.name : "unknown");
    return err(500, "failed", "Could not apply that change. Please try again.");
  }
}
