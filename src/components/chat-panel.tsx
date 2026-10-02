"use client";
// Client leaf: holds the conversation, talks to /api/chat (+ /confirm). Answers render as plain text only.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";
import Link from "next/link";
import { statementHref } from "@/lib/statement-link";
import { buildChat, getServerSnapshot, getSnapshot, storageKeyFor, subscribe, upsertChat, writeChats, type StoredChat, type StoredMsg } from "@/lib/chat-history";
import { ChatHistoryList } from "@/components/chat-history-list";

type Sample = { date: string; description: string; amountCents: number; category: string };
type PendingAction = { type: "payee_category"; matchKey: string; payee: string; category: string; count: number; alreadyCount: number; samples: Sample[] };
type Evidence = { tool: string; args: unknown; result: unknown };
type ActionState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; updated: number; category: string } | { kind: "cancelled" } | { kind: "error"; message: string };
type Msg =
  | { id: number; role: "user"; content: string }
  | { id: number; role: "assistant"; content: string; evidence: Evidence[]; pending: PendingAction | null; action: ActionState }
  | { id: number; role: "error"; content: string }
  | { id: number; role: "note"; content: string };
type Status = { ready: boolean; model: string | null; from: string | null; to: string | null; txnCount: number };

const MAX_HISTORY = 12;
const MAX_LEN = 2000;
const TOOL_WORDS: Record<string, string> = {
  get_overview: "Looked at your overall totals",
  spend_summary: "Added up spending",
  find_transactions: "Searched your transactions",
  get_insights: "Checked precomputed insights",
  propose_payee_category: "Prepared a category change",
};
const BASE_CHIPS = ["How much did I spend on food last month?", "What are my subscriptions?", "Which month did I spend the most?", "Any unusual charges?"];

let nextId = 1;
const newId = () => nextId++;

function errorMessage(body: unknown, fallback: string): string {
  const m = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof m === "string" && m ? m : fallback;
}

function compactArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const parts = Object.entries(args as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return parts.join(", ");
}

// First array of plain objects in the result (or the result itself), for a generic table.
function findRows(result: unknown): Record<string, unknown>[] | null {
  const isRows = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x));
  if (isRows(result)) return result;
  if (result && typeof result === "object") for (const v of Object.values(result as Record<string, unknown>)) if (isRows(v)) return v;
  return null;
}

const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

function EvidenceView({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <details className="chat-evidence">
      <summary>How I got this ({evidence.length} lookup{evidence.length === 1 ? "" : "s"})</summary>
      <ol>
        {evidence.map((e, i) => {
          const rows = findRows(e.result);
          const cols = rows ? [...new Set(rows.slice(0, 10).flatMap((r) => Object.keys(r)))] : [];
          const args = compactArgs(e.args);
          return (
            <li key={i}>
              <div>{TOOL_WORDS[e.tool] ?? e.tool.replace(/_/g, " ")}{args && <span className="mono chat-args"> ({args})</span>}</div>
              {rows ? (
                <div className="chat-table-wrap">
                  <table className="chat-table">
                    <thead><tr>{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
                    <tbody>{rows.slice(0, 10).map((r, j) => <tr key={j}>{cols.map((c) => <td key={c} className="mono">{cell(r[c])}</td>)}</tr>)}</tbody>
                  </table>
                  {rows.length > 10 && <p className="chat-dim">Showing 10 of {rows.length}.</p>}
                </div>
              ) : (
                <pre className="chat-pre mono">{JSON.stringify(e.result, null, 2)}</pre>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function ConfirmCard({ p, state, onConfirm, onCancel }: { p: PendingAction; state: ActionState; onConfirm: () => void; onCancel: () => void }) {
  if (state.kind === "done") return <p className="chat-action-result" role="status">Done - {state.updated} payments moved to {state.category}.</p>;
  if (state.kind === "cancelled") return <p className="chat-action-result" role="status">Cancelled - nothing changed.</p>;
  const busy = state.kind === "busy";
  return (
    <div className="chat-confirm" role="group" aria-label={`Confirm moving payments to ${p.payee} into ${p.category}`}>
      <p style={{ margin: 0 }}>
        Change <strong>{p.count}</strong> payments to <strong>{p.payee}</strong> to <strong>{p.category}</strong>? ({p.alreadyCount} already confirmed). Future uploads will follow this rule.
      </p>
      {p.samples.length > 0 && (
        <ul className="chat-samples">
          {p.samples.slice(0, 5).map((s, i) => (
            <li key={i}>
              <span className="mono chat-dim">{s.date}</span>
              <span className="chat-sample-desc">{s.description}</span>
              <span className="mono">{formatCents(s.amountCents)}</span>
              <span className="chat-dim">{s.category}</span>
            </li>
          ))}
        </ul>
      )}
      {state.kind === "error" && <p className="chat-inline-error" role="alert">{state.message}</p>}
      <div className="chat-confirm-actions">
        <button type="button" className="btn" onClick={onConfirm} disabled={busy}>{busy ? "Applying..." : "Confirm"}</button>
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

// What gets saved: questions and answers only (errors and "Stopped." notes are not worth keeping).
const toStored = (msgs: Msg[]): StoredMsg[] => msgs.flatMap((m): StoredMsg[] =>
  m.role === "user" ? [{ role: "user", content: m.content }]
  : m.role === "assistant" ? [{ role: "assistant", content: m.content, evidence: m.evidence, pending: m.pending, action: m.action.kind === "busy" ? { kind: "idle" } : m.action }]
  : []);
const fromStored = (msgs: StoredMsg[]): Msg[] => msgs.map((m): Msg =>
  m.role === "user" ? { id: newId(), role: "user", content: m.content }
  : { id: newId(), role: "assistant", content: m.content, evidence: m.evidence as Evidence[], pending: (m.pending as PendingAction | null) ?? null, action: (m.action as ActionState | null) ?? { kind: "idle" } });

// hosted = this is someone else's shared copy, so the visitor cannot set the AI up themselves.
export function ChatPanel({ suggestedPayee, storageKey, hosted = false }: { suggestedPayee: string | null; storageKey: string; hosted?: boolean }) {
  const router = useRouter();
  const key = storageKeyFor(storageKey);
  const chats = useSyncExternalStore(subscribe, () => getSnapshot(key), getServerSnapshot);
  const [chatId, setChatId] = useState<string | null>(null); // null = a new chat that has not been saved yet
  const dirtyRef = useRef(false);  // true when msgs changed through use (not just by opening a saved chat)
  const runRef = useRef(0);        // bumped when the user switches chat, so a late answer is not added to the wrong one
  const [status, setStatus] = useState<Status | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const [checking, setChecking] = useState(false);
  function checkStatus(signal?: AbortSignal) {
    return fetch("/api/chat", { signal, cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); setStatus(await r.json()); setStatusFailed(false); })
      .catch(() => { if (!signal?.aborted) setStatusFailed(true); });
  }
  useEffect(() => {
    const ac = new AbortController();
    void checkStatus(ac.signal);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Save the conversation to this browser whenever it changes through use.
  useEffect(() => {
    if (!dirtyRef.current || !chatId) return;
    dirtyRef.current = false;
    const stored = toStored(msgs);
    if (!stored.some((m) => m.role === "user")) return;
    const all = getSnapshot(key);
    writeChats(key, upsertChat(all, buildChat(all.find((c) => c.id === chatId), chatId, stored, Date.now())));
  }, [msgs, chatId, key]);

  function switchTo(id: string | null, next: Msg[]) {
    runRef.current++;
    abortRef.current?.abort();
    setBusy(false);
    setChatId(id);
    setMsgs(next);
    setInput("");
  }
  const update = (fn: (all: StoredChat[]) => StoredChat[]) => writeChats(key, fn(getSnapshot(key)));

  async function ask(history: Msg[]) {
    const payload = history
      .filter((m): m is Extract<Msg, { role: "user" | "assistant" }> => (m.role === "user" || m.role === "assistant") && m.content.trim() !== "")
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }));
    if (payload.length === 0 || payload[payload.length - 1].role !== "user") return;
    const ac = new AbortController();
    abortRef.current = ac;
    const run = runRef.current;
    const add = (m: Msg) => { if (runRef.current === run) { dirtyRef.current = true; setMsgs((prev) => [...prev, m]); } };
    setBusy(true);
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: payload }), signal: ac.signal });
      const body: unknown = await r.json().catch(() => null);
      if (!r.ok) {
        add({ id: newId(), role: "error", content: errorMessage(body, "Something went wrong. Try again.") });
        return;
      }
      const b = body as { answer?: unknown; evidence?: unknown; pendingAction?: unknown } | null;
      add({
        id: newId(), role: "assistant",
        content: typeof b?.answer === "string" ? b.answer : "",
        evidence: Array.isArray(b?.evidence) ? (b.evidence as Evidence[]) : [],
        pending: b?.pendingAction && typeof b.pendingAction === "object" ? (b.pendingAction as PendingAction) : null,
        action: { kind: "idle" },
      });
    } catch {
      if (ac.signal.aborted) add({ id: newId(), role: "note", content: "Stopped." });
      else add({ id: newId(), role: "error", content: "Couldn't reach the app server." });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      if (runRef.current === run) setBusy(false);
    }
  }

  function send(text: string) {
    const content = text.trim().slice(0, MAX_LEN);
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { id: newId(), role: "user", content }];
    if (!chatId) setChatId(crypto.randomUUID());
    dirtyRef.current = true;
    setMsgs(next);
    setInput("");
    void ask(next);
  }

  function retry(errorId: number) {
    if (busy) return;
    const next = msgs.filter((m) => m.id !== errorId);
    setMsgs(next);
    void ask(next);
  }

  function setAction(id: number, action: ActionState) {
    dirtyRef.current = true;
    setMsgs((m) => m.map((x) => (x.id === id && x.role === "assistant" ? { ...x, action } : x)));
  }

  async function confirm(id: number, p: PendingAction) {
    setAction(id, { kind: "busy" });
    try {
      const r = await fetch("/api/chat/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ matchKey: p.matchKey, category: p.category }) });
      const body: unknown = await r.json().catch(() => null);
      if (!r.ok) { setAction(id, { kind: "error", message: errorMessage(body, "Couldn't apply the change. Nothing was changed.") }); return; }
      const b = body as { updated?: unknown; category?: unknown } | null;
      setAction(id, { kind: "done", updated: typeof b?.updated === "number" ? b.updated : 0, category: typeof b?.category === "string" ? b.category : p.category });
      router.refresh();
    } catch {
      setAction(id, { kind: "error", message: "Couldn't reach the app server." });
    }
  }

  const chips = suggestedPayee ? [...BASE_CHIPS, `Put ${suggestedPayee} under Food & Dining`] : BASE_CHIPS;
  const last = msgs[msgs.length - 1];
  const showChips = !busy && (msgs.length === 0 || last.role === "assistant");

  return (
    <div className="chat-layout">
    <ChatHistoryList
      chats={chats}
      currentId={chatId}
      onOpen={(c) => switchTo(c.id, fromStored(c.msgs))}
      onNew={() => switchTo(null, [])}
      onRename={(id, title) => { const t = title.replace(/\s+/g, " ").trim().slice(0, 60); if (t) update((all) => all.map((c) => (c.id === id ? { ...c, title: t, renamed: true } : c))); }}
      onPin={(id) => update((all) => all.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)))}
      onDelete={(id) => { update((all) => all.filter((c) => c.id !== id)); if (id === chatId) switchTo(null, []); }}
      onClear={() => { update(() => []); switchTo(null, []); }}
    />
    <div className="card chat-panel">
      <div className="chat-head">
        {status ? (
          <span className={`chat-pill ${status.ready ? "ok" : "off"}`} role="status">
            <span className="chat-pill-dot" aria-hidden="true" />
            {status.ready ? `Local AI ready - ${status.model ?? "model loaded"}` : "Local AI is not running"}
          </span>
        ) : statusFailed ? (
          <span className="chat-pill off" role="status"><span className="chat-pill-dot" aria-hidden="true" />Couldn&apos;t check the local AI</span>
        ) : (
          <span className="chat-pill" role="status"><span className="chat-pill-dot" aria-hidden="true" />Checking local AI...</span>
        )}
        {status && (
          <span className="chat-range">
            {status.txnCount > 0 && status.from && status.to ? `Your data: ${status.from} to ${status.to}, ${status.txnCount} transactions` : "No transactions yet - upload a statement first"}
          </span>
        )}
      </div>

      <div className="chat-log" role="log" aria-live="polite" aria-label="Conversation" ref={logRef} tabIndex={0}>
        {msgs.length === 0 && (status && !status.ready ? (
          <div className="chat-setup">
            <h2 className="card-title">Ask AI needs a local AI model</h2>
            {hosted ? (
              <p>The AI model on the computer hosting this demo is switched off right now. Everything else in the app still works.</p>
            ) : (
              <>
                <p>The rest of the app works without it. To turn Ask AI on, set this up once (free, about 15 minutes):</p>
                <ol>
                  <li>Install <a href="https://lmstudio.ai" target="_blank" rel="noreferrer">LM Studio</a>.</li>
                  <li>In LM Studio, search for and download <strong>google/gemma-4-e4b</strong> (about 6 GB). With 16 GB of memory or more, <strong>qwen2.5-14b-instruct</strong> (about 9 GB) answers better.</li>
                  <li>Load the model with <strong>context length 16384</strong>.</li>
                  <li>Start the local server in LM Studio&apos;s Developer tab.</li>
                </ol>
              </>
            )}
            <button type="button" className="btn" disabled={checking} onClick={() => { setChecking(true); void checkStatus().finally(() => setChecking(false)); }}>
              {checking ? "Checking..." : "Check again"}
            </button>
          </div>
        ) : <p className="chat-empty">Ask anything about your spending. Answers come from your own transactions.</p>)}
        {msgs.map((m) => {
          if (m.role === "user") return <div key={m.id} className="chat-bubble user">{m.content}</div>;
          if (m.role === "note") return <p key={m.id} className="chat-dim chat-note">{m.content}</p>;
          if (m.role === "error") return (
            <div key={m.id} className="chat-bubble assistant error" role="alert">
              <span>{m.content}</span>
              <button type="button" className="btn ghost chat-retry" onClick={() => retry(m.id)} disabled={busy}>Retry</button>
            </div>
          );
          return (
            <div key={m.id} className="chat-bubble assistant">
              {m.content || <span className="chat-dim">No answer text.</span>}
              {m.pending && <ConfirmCard p={m.pending} state={m.action} onConfirm={() => confirm(m.id, m.pending!)} onCancel={() => setAction(m.id, { kind: "cancelled" })} />}
              {m.evidence.length > 0 && <Link className="btn ghost chat-stmt-link" href={statementHref(m.evidence)}>See in bank statement</Link>}
              <EvidenceView evidence={m.evidence} />
            </div>
          );
        })}
        {busy && (
          <div className="chat-bubble assistant chat-thinking">
            <span className="chat-dots" aria-hidden="true"><i /><i /><i /></span>
            Thinking locally...
          </div>
        )}
      </div>

      {showChips && (
        <div className="chat-chips" aria-label="Suggested questions">
          {chips.map((c) => <button key={c} type="button" className="chat-chip" onClick={() => send(c)}>{c}</button>)}
        </div>
      )}

      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <label htmlFor="chat-input" className="chat-sr">Ask about your spending</label>
        <textarea
          id="chat-input"
          className="input chat-input"
          rows={2}
          maxLength={MAX_LEN}
          placeholder="Ask about your spending..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
          }}
        />
        <div className="chat-form-actions">
          {busy && <button type="button" className="btn ghost" onClick={() => abortRef.current?.abort()}>Stop</button>}
          <button type="submit" className="btn" disabled={busy || !input.trim()}>Send</button>
        </div>
      </form>
    </div>
    </div>
  );
}
