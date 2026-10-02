import "server-only";

// Deterministic guard rails around the chat model. They run in code, before the model sees a message and
// again on its reply, so safety never depends on how a local model happens to behave on a given day.

export type GuardHit = { code: "abusive" | "self_harm" | "rate_limited" | "busy"; answer: string };

export const ABUSIVE_REPLY = "I can't help with that. I can answer questions about your spending, transactions and categories.";
export const SELF_HARM_REPLY =
  "It sounds like you're going through a lot, and money stress can feel overwhelming. You don't have to handle it alone. " +
  "In Singapore you can call SOS on 1767 (24 hours) or text them on WhatsApp at 9151 1767. If you're in immediate danger, call 995. " +
  "When you're ready, I can help you look at your spending and find some breathing room.";
export const RATE_LIMIT_REPLY = "You're sending messages very quickly. Please wait a minute and try again.";

// Leetspeak / spacing tricks folded away before matching ("n1gg3r", "f@g").
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[0@4]/g, (c) => (c === "0" ? "o" : "a"))
    .replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[$5]/g, "s").replace(/7/g, "t")
    .replace(/(.)\1{2,}/g, "$1$1"); // "niiiigger" -> "niigger" (patterns allow doubled letters)
}

// Slurs and hate terms. Matched on word boundaries so ordinary words ("snigger", "scunthorpe") pass.
const SLURS = [
  /\bn+i+g+(?:e+r+|a+h?|u+h+|z)s?\b/, /\bnigl?ets?\b/, /\bf+a+g+(?:o+t+|g+o+t+)?s?\b/, /\bdykes?\b/, /\btrann(?:y|ies)\b/,
  /\bretards?\b/, /\bchinks?\b/, /\bgooks?\b/, /\bkikes?\b/, /\bspics?\b/, /\bwetbacks?\b/, /\bpakis?\b/, /\bcoons?\b/,
  /\bkeling\b/, /\bsand ?n+i+g+/, /\braghead/, /\bjigaboo/, /\bbeaners?\b/,
];
// Spaced-out evasion ("n i g g e r"): letters separated by spaces or punctuation.
const SPACED = /\bn[\s._-]+i[\s._-]+g[\s._-]+g[\s._-]+(?:e[\s._-]+r|a)\b/;
const THREATS = /\b(?:kill|murder|shoot|stab|rape|bomb)\s+(?:you|him|her|them|everyone|people)\b|\bi(?:'ll| will| am going to| wanna| want to)\s+(?:kill|murder|rape|hurt)\b/;
const SEXUAL = /\b(?:porn|nudes?|blowjob|handjob|hentai|sex with)\b/;
const SELF_HARM = /\b(?:kill(?:ing)? my ?self|suicid(?:e|al)|end(?:ing)? (?:my|it all|my own) life|want(?:ing)? to die|don'?t want to (?:live|be alive)|self[- ]?harm|cut(?:ting)? my ?self|no reason to live|better off dead)\b/;

export function isAbusive(text: string): boolean {
  const t = fold(text);
  return SLURS.some((re) => re.test(t)) || SPACED.test(t) || THREATS.test(t) || SEXUAL.test(t);
}

export function screenInput(text: string): GuardHit | null {
  const t = fold(text);
  // Self-harm first: someone in distress who also swears should still get the helpline, not a refusal.
  if (SELF_HARM.test(t)) return { code: "self_harm", answer: SELF_HARM_REPLY };
  if (isAbusive(text)) return { code: "abusive", answer: ABUSIVE_REPLY };
  return null;
}

// The model's reply is checked too: a jailbroken or confused model must never echo abuse back.
export function screenOutput(answer: string): string {
  return isAbusive(answer) ? ABUSIVE_REPLY : answer;
}

// Per-user sliding window. In-memory is enough for a single local process; the shared demo link makes
// every visitor the same user, so this also caps total load on the local model.
// debt: per-process memory only, move to the DB or an edge limiter if the app ever runs multi-instance.
const WINDOW_MS = 5 * 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

export function rateLimit(userId: string, now = Date.now()): GuardHit | null {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) { hits.set(userId, recent); return { code: "rate_limited", answer: RATE_LIMIT_REPLY }; }
  recent.push(now);
  hits.set(userId, recent);
  return null;
}

// The local model is one shared resource. Cap how many answers are generated at once so a burst of
// visitors (e.g. a shared demo link) queues politely instead of slowing the laptop to a crawl.
export const BUSY_REPLY = "The AI is answering someone else right now. Try again in a few seconds.";
const MAX_CONCURRENT_CHATS = 2;
let activeChats = 0;

// Returns a release function, or null when every slot is taken. Always call release in a finally block.
export function acquireChatSlot(): (() => void) | null {
  if (activeChats >= MAX_CONCURRENT_CHATS) return null;
  activeChats++;
  let released = false;
  return () => { if (!released) { released = true; activeChats--; } };
}

// Grounding: an answer that states money figures must come from a lookup made in the same turn.
export const UNGROUNDED_REPLY = "I couldn't look that up just now, so I won't guess. Please ask again, for example: \"How much did I spend on food in November 2067?\"";
export function statesFigures(answer: string): boolean {
  return /\$\s?\d|\b\d[\d,]*\.\d{2}\b|\b\d+\s?%/.test(answer);
}
