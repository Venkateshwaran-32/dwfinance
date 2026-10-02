// One-command setup for a fresh copy (macOS, Windows, Linux):  npm run setup
// Creates .env, the local database, the 48 synthetic sample statements and a demo account loaded with them.
// Safe to run again: it never overwrites an existing .env, and it only replaces the demo account's data.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const DEMO_EMAIL = "demo@dwfinance.local";
const step = (n, text) => console.log(`\n[${n}/4] ${text}`);
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) { console.error(`Node.js 20 or newer is required (you have ${process.versions.node}). Get it from https://nodejs.org`); process.exit(1); }
if (!existsSync("node_modules")) { console.error("Run `npm install` first, then `npm run setup`."); process.exit(1); }

step(1, "Settings file (.env)");
if (existsSync(".env")) console.log("  .env already exists, keeping it.");
else {
  writeFileSync(".env", `DATABASE_URL="file:./dev.db"\nAUTH_SECRET="${randomBytes(32).toString("hex")}"\n`);
  console.log("  created .env with a local database and a fresh login secret.");
}
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync(".env", "utf8"))?.[1] ?? "file:./dev.db";
if (!dbUrl.startsWith("file:")) { console.error(`  DATABASE_URL in .env must be a local file (file:./dev.db), found: ${dbUrl}`); process.exit(1); }

step(2, "Local database");
run("npx prisma db push --skip-generate", { DATABASE_URL: dbUrl });

step(3, "Sample statements (48 synthetic PDFs, four fictional uni years)");
run("npx tsx scripts/gen-sample-2067.ts");

step(4, `Demo account (${DEMO_EMAIL})`);
run("npx tsx --tsconfig scripts/tsconfig.json scripts/load-demo-2067.ts", { DATABASE_URL: dbUrl, EMAIL: DEMO_EMAIL });

if (!process.env.DWF_LAUNCHER) console.log(`
Ready. Start the app:

    npm run dev        then open http://localhost:3000

Sign in with "Fast access", or ${DEMO_EMAIL} / Password123!
To use your own data: create an account and upload a DBS or POSB statement PDF.

Ask AI is optional and runs on your own computer:
  1. Install LM Studio (https://lmstudio.ai) and download a chat model.
     Most laptops: google/gemma-4-e4b (about 6 GB, quick).   16 GB of memory or more: qwen2.5-14b-instruct (about 9 GB).
  2. In LM Studio, load the model and start the local server (port 1234).
Everything else works without it.
`);
