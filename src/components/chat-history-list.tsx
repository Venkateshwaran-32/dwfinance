"use client";
import "@/styles/chat-history.css";
import { useState } from "react";
import { TOPICS, filterChats, sortChats, type StoredChat, type Topic } from "@/lib/chat-history";

const day = (ts: number) => new Date(ts).toLocaleDateString("en-SG", { day: "numeric", month: "short" });

// Past chats, kept in this browser. Open one to carry on, or rename / pin / delete it. On a phone the list
// folds behind a "Chats" button so the conversation keeps the screen.
export function ChatHistoryList({
  chats, currentId, onOpen, onNew, onRename, onPin, onDelete, onClear,
}: {
  chats: StoredChat[]; currentId: string | null;
  onOpen: (c: StoredChat) => void; onNew: () => void; onRename: (id: string, title: string) => void;
  onPin: (id: string) => void; onDelete: (id: string) => void; onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<Topic | "All">("All");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null); // a chat id, or "ALL"
  const [open, setOpen] = useState(false); // phone drawer

  const present = TOPICS.filter((t) => chats.some((c) => c.topic === t));
  const activeTopic = topic !== "All" && !present.includes(topic) ? "All" : topic;
  const shown = sortChats(filterChats(chats, query, activeTopic));

  return (
    <aside className={`card chat-hist${open ? " open" : ""}`} aria-label="Chat history">
      <div className="chat-hist-top">
        <button type="button" className="btn chat-hist-new" onClick={() => { onNew(); setOpen(false); }}>New chat</button>
        <button type="button" className="btn ghost chat-hist-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Chats ({chats.length})
        </button>
      </div>

      <div className="chat-hist-body">
        {chats.length === 0 ? (
          <p className="chat-hist-empty">Your chats will appear here. They are saved in this browser only.</p>
        ) : (
          <>
            <input className="input chat-hist-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats..." aria-label="Search chats" />
            {present.length > 1 && (
              <div className="chat-hist-topics" role="group" aria-label="Filter by topic">
                {(["All", ...present] as const).map((t) => (
                  <button key={t} type="button" className="chat-hist-topic" aria-pressed={activeTopic === t} onClick={() => setTopic(t)}>{t}</button>
                ))}
              </div>
            )}
            <ul className="chat-hist-list">
              {shown.length === 0 && <li className="chat-hist-empty">No chats match.</li>}
              {shown.map((c) => (
                <li key={c.id} className={`chat-hist-item${c.id === currentId ? " current" : ""}`}>
                  {editing === c.id ? (
                    <form className="chat-hist-rename" onSubmit={(e) => { e.preventDefault(); onRename(c.id, draft); setEditing(null); }}>
                      <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} aria-label="Chat name" autoFocus />
                      <button type="submit" className="chat-hist-act">Save</button>
                      <button type="button" className="chat-hist-act" onClick={() => setEditing(null)}>Cancel</button>
                    </form>
                  ) : confirming === c.id ? (
                    <div className="chat-hist-confirm" role="group" aria-label={`Delete ${c.title}`}>
                      <span className="chat-hist-confirm-text">Delete &quot;{c.title}&quot;?</span>
                      <button type="button" className="chat-hist-act danger" onClick={() => { onDelete(c.id); setConfirming(null); }}>Delete</button>
                      <button type="button" className="chat-hist-act" onClick={() => setConfirming(null)}>Keep</button>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="chat-hist-open" aria-current={c.id === currentId ? "true" : undefined} onClick={() => { onOpen(c); setOpen(false); }}>
                        <span className="chat-hist-title">{c.pinned ? <span className="chat-hist-pin">Pinned</span> : null}{c.title}</span>
                        <span className="chat-hist-meta"><span className="chat-hist-tag">{c.topic}</span>{day(c.updatedAt)}</span>
                      </button>
                      <div className="chat-hist-acts">
                        <button type="button" className="chat-hist-act" onClick={() => { setDraft(c.title); setEditing(c.id); }} aria-label={`Rename ${c.title}`}>Rename</button>
                        <button type="button" className="chat-hist-act" onClick={() => onPin(c.id)} aria-label={`${c.pinned ? "Unpin" : "Pin"} ${c.title}`}>{c.pinned ? "Unpin" : "Pin"}</button>
                        <button type="button" className="chat-hist-act" onClick={() => setConfirming(c.id)} aria-label={`Delete ${c.title}`}>Delete</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <div className="chat-hist-foot">
              <span>Saved in this browser only.</span>
              {confirming === "ALL" ? (
                <span className="chat-hist-confirm">
                  <button type="button" className="chat-hist-act danger" onClick={() => { onClear(); setConfirming(null); }}>Delete all</button>
                  <button type="button" className="chat-hist-act" onClick={() => setConfirming(null)}>Keep</button>
                </span>
              ) : (
                <button type="button" className="chat-hist-act" onClick={() => setConfirming("ALL")}>Clear history</button>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
