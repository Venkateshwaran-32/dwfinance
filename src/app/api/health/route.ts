import { db } from "@/lib/db";
import { hasAI } from "@/lib/env";

export const dynamic = "force-dynamic";

// Real-dependency health: actual DB probe; safe JSON only (no secrets/PII); 503 on failure.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({
      ok: true,
      app: "dwfinance",
      db: { ok: true, provider: "sqlite" },
      ai: { configured: hasAI },
      time: new Date().toISOString(),
    });
  } catch {
    return Response.json({ ok: false, app: "dwfinance", db: { ok: false } }, { status: 503 });
  }
}
