import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const dynamic = "force-dynamic";

// On macOS, os.freemem() reports only truly-free pages, which is near-zero by design (spare RAM is
// reclaimable cache). That makes "% used" look pinned at ~99%. vm_stat lets us compute the honest
// "Memory Used" the way Activity Monitor does: active + wired + compressed pages.
async function macMemUsed(total: number): Promise<number | null> {
  try {
    const { stdout } = await exec("vm_stat", [], { timeout: 1500 });
    const pageSize = Number(stdout.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
    const pages = (label: string) =>
      Number(stdout.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0);
    const active = pages("Pages active");
    const wired = pages("Pages wired down");
    const compressed = pages("Pages occupied by compressor");
    const used = (active + wired + compressed) * pageSize;
    return used > 0 && used <= total ? used : null;
  } catch {
    return null;
  }
}

// Local-only system monitor: reports the host machine + this server process's live resource use.
// Leaks host info, so it is disabled outside development (404 in production).
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  // Sample app CPU over a short window to get a live %.
  const startCpu = process.cpuUsage();
  const windowMs = 120;
  await new Promise((r) => setTimeout(r, windowMs));
  const elapsedCpu = process.cpuUsage(startCpu);
  const cores = os.cpus().length;
  const appCpuPct = ((elapsedCpu.user + elapsedCpu.system) / 1000 / windowMs) * 100; // % of one core

  const totalMem = os.totalmem();
  const usedMem =
    (os.platform() === "darwin" ? await macMemUsed(totalMem) : null) ?? totalMem - os.freemem();
  const freeMem = totalMem - usedMem;
  const mem = process.memoryUsage();

  return Response.json({
    time: new Date().toISOString(),
    machine: {
      platform: `${os.type()} ${os.release()}`,
      cores,
      totalMem,
      freeMem,
      usedMem,
      loadavg: os.loadavg(), // [1m, 5m, 15m]
      uptimeSec: os.uptime(),
    },
    app: {
      pid: process.pid,
      node: process.version,
      uptimeSec: process.uptime(),
      cpuPctOfCore: appCpuPct,
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    },
  });
}
