import { getSessionUserId } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Latest upload job for the logged-in user, so the client can resume showing progress
// after a logout/login or a full refresh.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "not authenticated" }, { status: 401 });

  let job = await db.uploadJob.findFirst({ where: { userId }, orderBy: { startedAt: "desc" } });
  if (!job) return Response.json({ job: null });

  // Self-heal: a "processing" job that hasn't beaten its heartbeat in >5 min is dead
  // (server restarted / crashed mid-extraction). Mark it failed so the UI doesn't hang forever.
  if (job.status === "processing") {
    const last = (job.heartbeatAt ?? job.startedAt).getTime();
    if (Date.now() - last > 5 * 60 * 1000) {
      job = await db.uploadJob.update({
        where: { id: job.id },
        data: { status: "error", error: "Processing stopped unexpectedly (the app restarted or the model stalled). Please re-upload.", finishedAt: new Date() },
      });
    }
  }

  return Response.json({
    job: {
      id: job.id,
      status: job.status,
      fileName: job.fileName,
      error: job.error,
      count: job.count,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
    },
  });
}
