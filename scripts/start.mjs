// One-step launcher: node scripts/start.mjs  (the "Start dwfinance" files and `npm run app` call this).
// First run installs what the app needs and loads the sample data; every run then starts the app and opens it in the browser.
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(join(dirname(fileURLToPath(import.meta.url)), ".."));
const say = (text) => console.log(`\n== ${text}`);

if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error(`dwfinance needs Node.js 20 or newer (this computer has ${process.versions.node}). Install the LTS version from https://nodejs.org and try again.`);
  process.exit(1);
}

if (!existsSync(join("node_modules", "next"))) {
  say("First start: downloading what the app needs (about 1 GB, a few minutes). This happens once.");
  execSync("npm install --no-audit --no-fund", { stdio: "inherit" });
}
if (!existsSync(".env") || !existsSync(join("prisma", "dev.db"))) {
  say("First start: creating your local database and loading the sample statements.");
  execSync("node scripts/setup.mjs", { stdio: "inherit", env: { ...process.env, DWF_LAUNCHER: "1" } });
}

// The app only listens on this computer (127.0.0.1), never the network: Fast access needs no password.
const isFree = (port) => new Promise((resolve) => {
  const s = createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true))).listen(port, "127.0.0.1");
});
let port = 3000;
while (!(await isFree(port)) && port < 3020) port++;
const url = `http://localhost:${port}`;

say(`Starting dwfinance at ${url}`);
const app = spawn(process.execPath, [join("node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "-p", String(port)], { stdio: "inherit" });
app.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.kill(sig));

for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { await fetch(url, { redirect: "manual" }); break; } catch { /* not up yet */ }
}
if (!process.env.DWF_NO_OPEN) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
console.log(`
============================================================
  dwfinance is running:  ${url}
  Press "Fast access" on the page to see the sample data.

  Keep this window open while you use the app.
  To stop it, close this window.
============================================================
`);
