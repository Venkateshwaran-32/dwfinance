import "server-only";

// PII-masking logger (fintech-pii). Never log raw request bodies, statement text, account numbers,
// balances, names, tokens, or keys. Masks known patterns and strips CR/LF (log-injection).
const PATTERNS: [RegExp, string][] = [
  [/\b\d{6,}\b/g, "«num»"],                       // account/long numbers
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "«email»"],
  [/(secret|token|key|password|authorization)\s*[:=]\s*\S+/gi, "$1=«redacted»"],
];

function mask(s: string): string {
  let out = s.replace(/[\r\n]+/g, " ");
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

function fmt(args: unknown[]): string {
  return args.map((a) => (typeof a === "string" ? mask(a) : mask(safeJson(a)))).join(" ");
}
function safeJson(a: unknown): string {
  try { return JSON.stringify(a); } catch { return String(a); }
}

export const log = {
  info: (...a: unknown[]) => console.log("[info]", fmt(a)),
  warn: (...a: unknown[]) => console.warn("[warn]", fmt(a)),
  error: (...a: unknown[]) => console.error("[error]", fmt(a)),
};
