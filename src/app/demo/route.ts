import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession } from "@/lib/auth";

// One-link entry for a shared demo: signs the visitor into the DEMO_OPEN_EMAIL account and opens the
// dashboard. Off (404) unless DEMO_OPEN_EMAIL is set, which only the fake-data demo copy does.
export async function GET() {
  if (!env.DEMO_OPEN_EMAIL) return new NextResponse("Not found", { status: 404 });
  const user = await db.user.findUnique({ where: { email: env.DEMO_OPEN_EMAIL } });
  if (!user) return new NextResponse("Demo account missing", { status: 503 });
  await createSession(user.id);
  // Relative Location: behind a tunnel req.url carries the internal host (localhost:3100), not the public one.
  return new NextResponse(null, { status: 307, headers: { Location: "/dashboard" } });
}
