// Chat history kept in THIS browser only (localStorage): nothing is added to the database, and on a shared
// demo link every visitor gets their own private list. Pure helpers + a tiny external store for React.

export type StoredEvidence = { tool: string; args: unknown; result: unknown };
export type StoredMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; evidence: StoredEvidence[]; pending: unknown; action: unknown };

export const TOPICS = ["Spending", "Payees", "Subscriptions", "Alerts", "Categorising", "General"] as const;
export type Topic = (typeof TOPICS)[number];

export type StoredChat = {
  id: string; title: string; renamed: boolean; pinned: boolean; topic: Topic;
  createdAt: number; updatedAt: number; msgs: StoredMsg[];
};

export const MAX_CHATS = 50;
const MAX_MSGS = 60;
const TITLE_LEN = 48;

// First question, tidied, as the chat's name.
export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
  const cut = t.length > TITLE_LEN ? `${t.slice(0, TITLE_LEN - 1).trimEnd()}...` : t;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function topicOfStep(e: StoredEvidence): Topic {
  const a = obj(e.args);
  if (a.category === "Subscriptions") return "Subscriptions";
  switch (e.tool) {
    case "propose_payee_category": return "Categorising";
    case "get_insights": return a.kind === "subscriptions" ? "Subscriptions" : a.kind === "alerts" ? "Alerts" : a.kind === "peers" ? "Payees" : "Spending";
    case "find_transactions": return typeof a.text === "string" && a.text.trim() ? "Payees" : "Spending";
    case "spend_summary": return a.groupBy === "payee" ? "Payees" : "Spending";
    default: return "Spending";
  }
}

// Label a chat by what it actually looked up (no AI involved). A proposed category change always wins.
export function topicOf(msgs: StoredMsg[]): Topic {
  const counts = new Map<Topic, number>();
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    for (const e of m.evidence) { const t = topicOfStep(e); counts.set(t, (counts.get(t) ?? 0) + (t === "Categorising" ? 100 : 1)); }
  }
  let best: Topic = "General", n = 0;
  for (const t of TOPICS) { const c = counts.get(t) ?? 0; if (c > n) { best = t; n = c; } }
  return best;
}

// Pinned first, then most recently used.
export function sortChats(chats: StoredChat[]): StoredChat[] {
  return [...chats].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export function filterChats(chats: StoredChat[], query: string, topic: Topic | "All"): StoredChat[] {
  const q = query.trim().toLowerCase();
  return chats.filter((c) => (topic === "All" || c.topic === topic) &&
    (!q || c.title.toLowerCase().includes(q) || c.msgs.some((m) => m.content.toLowerCase().includes(q))));
}

// Insert or replace a chat; keep at most MAX_CHATS, dropping the oldest unpinned ones first.
export function upsertChat(chats: StoredChat[], chat: StoredChat): StoredChat[] {
  const trimmed = { ...chat, msgs: chat.msgs.slice(-MAX_MSGS) };
  const next = [trimmed, ...chats.filter((c) => c.id !== chat.id)];
  if (next.length <= MAX_CHATS) return next;
  const keep = sortChats(next).slice(0, MAX_CHATS);
  return next.filter((c) => keep.includes(c));
}

export function buildChat(prev: StoredChat | undefined, id: string, msgs: StoredMsg[], now: number): StoredChat {
  const firstQuestion = msgs.find((m) => m.role === "user")?.content ?? "";
  return {
    id, msgs, topic: topicOf(msgs), pinned: prev?.pinned ?? false, renamed: prev?.renamed ?? false,
    title: prev?.renamed ? prev.title : titleFrom(firstQuestion), createdAt: prev?.createdAt ?? now, updatedAt: now,
  };
}

// ---- external store (useSyncExternalStore) ----
const EMPTY: StoredChat[] = [];
const listeners = new Set<() => void>();
let cache: { key: string; raw: string | null; chats: StoredChat[] } | null = null;
export const storageKeyFor = (userKey: string) => `dwfinance.chats.v1.${userKey}`;

function parse(raw: string | null): StoredChat[] {
  if (!raw) return EMPTY;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((c) => c && typeof c === "object" && typeof (c as StoredChat).id === "string" && Array.isArray((c as StoredChat).msgs)) as StoredChat[]) : EMPTY;
  } catch { return EMPTY; }
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb); // another tab changed the history
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}

export function getSnapshot(key: string): StoredChat[] {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(key); } catch { /* storage blocked: behave as empty */ }
  if (!cache || cache.key !== key || cache.raw !== raw) cache = { key, raw, chats: parse(raw) };
  return cache.chats;
}

export const getServerSnapshot = (): StoredChat[] => EMPTY;

// Returns false when the browser refused to store it (private mode / quota), after trying to make room.
export function writeChats(key: string, chats: StoredChat[]): boolean {
  let list = chats;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const raw = JSON.stringify(list);
      window.localStorage.setItem(key, raw);
      cache = { key, raw, chats: list };
      listeners.forEach((l) => l());
      return true;
    } catch {
      const drop = sortChats(list).filter((c) => !c.pinned).at(-1); // quota: let go of the oldest unpinned chat
      if (!drop) return false;
      list = list.filter((c) => c !== drop);
    }
  }
  return false;
}
