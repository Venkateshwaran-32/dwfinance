import "server-only";
import { z } from "zod";

// The ONLY file allowed to read process.env. Fails loud at boot if required server env is missing.
// ANTHROPIC_API_KEY is optional by design — the categorizer falls back to a deterministic heuristic
// so the demo never breaks. AUTH_SECRET has a dev default so the app runs with zero config; set a real
// value in production (a deploy that forgets it gets a loud warning, not a silent insecure default).
const DEV_AUTH_SECRET = "dwfinance-dev-only-secret-change-me-in-production-0001";

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  AUTH_SECRET: z.string().min(16).default(DEV_AUTH_SECRET),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Local AI via LM Studio (OpenAI-compatible). 127.0.0.1 not localhost — avoids Node's IPv6 (::1) miss.
  LMSTUDIO_BASE_URL: z.string().url().default("http://127.0.0.1:1234/v1"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Local-desktop convenience: which account the "Fast access" button signs into. Optional — when unset,
  // the non-test account with the most transactions is used.
  FAST_ACCESS_EMAIL: z.string().email().optional(),
  // Shared-demo copy only (fake data): /demo signs visitors straight into this account. Never set it on a
  // database holding real statements.
  DEMO_OPEN_EMAIL: z.string().email().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;

if (env.NODE_ENV === "production" && env.AUTH_SECRET === DEV_AUTH_SECRET) {
  console.warn("[dwfinance] AUTH_SECRET is the dev default in production — set a real AUTH_SECRET.");
}

// AI categorization runs on the local LM Studio engine (always-on by design for this local app).
export const hasAI = true;

// One-click login for the local desktop use case (single user on their own machine). Never in production.
export const fastAccessEnabled = env.NODE_ENV !== "production";
