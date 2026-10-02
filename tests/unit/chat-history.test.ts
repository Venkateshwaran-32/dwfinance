import { describe, expect, it } from "vitest";
import { MAX_CHATS, buildChat, filterChats, sortChats, titleFrom, topicOf, upsertChat, type StoredChat, type StoredMsg } from "@/lib/chat-history";

const user = (content: string): StoredMsg => ({ role: "user", content });
const bot = (content: string, ...steps: [tool: string, args: object][]): StoredMsg =>
  ({ role: "assistant", content, evidence: steps.map(([tool, args]) => ({ tool, args, result: {} })), pending: null, action: { kind: "idle" } });
const chat = (id: string, over: Partial<StoredChat> = {}): StoredChat =>
  ({ id, title: id, renamed: false, pinned: false, topic: "General", createdAt: 1, updatedAt: 1, msgs: [user(id)], ...over });

describe("chat history", () => {
  it("names a chat from its first question", () => {
    expect(titleFrom("  how much did i   spend on food?  ")).toBe("How much did i spend on food?");
    expect(titleFrom("x".repeat(80))).toHaveLength(50); // 47 chars + "..."
    expect(titleFrom("   ")).toBe("New chat");
  });

  it("labels a chat by what it looked up", () => {
    expect(topicOf([user("hi"), bot("hello")])).toBe("General");
    expect(topicOf([user("q"), bot("a", ["spend_summary", { groupBy: "category" }])])).toBe("Spending");
    expect(topicOf([user("q"), bot("a", ["find_transactions", { text: "ong bee lian" }])])).toBe("Payees");
    expect(topicOf([user("q"), bot("a", ["spend_summary", { groupBy: "payee" }])])).toBe("Payees");
    expect(topicOf([user("q"), bot("a", ["get_insights", { kind: "subscriptions" }])])).toBe("Subscriptions");
    expect(topicOf([user("q"), bot("a", ["get_insights", { kind: "alerts" }])])).toBe("Alerts");
    // a proposed category change wins over any number of lookups
    expect(topicOf([user("q"), bot("a", ["spend_summary", {}], ["spend_summary", {}], ["find_transactions", {}]), user("q2"), bot("a2", ["propose_payee_category", { payee: "x" }])])).toBe("Categorising");
  });

  it("builds and updates a chat, keeping a custom name and the pin", () => {
    const first = buildChat(undefined, "c1", [user("what are my subscriptions?"), bot("...", ["get_insights", { kind: "subscriptions" }])], 100);
    expect(first).toMatchObject({ title: "What are my subscriptions?", topic: "Subscriptions", pinned: false, renamed: false, createdAt: 100, updatedAt: 100 });
    const renamed = { ...first, title: "My subs", renamed: true, pinned: true };
    const later = buildChat(renamed, "c1", [...first.msgs, user("and food?"), bot("...", ["spend_summary", {}])], 200);
    expect(later).toMatchObject({ title: "My subs", renamed: true, pinned: true, createdAt: 100, updatedAt: 200 });
  });

  it("orders pinned first then newest, and searches titles and messages", () => {
    const list = [chat("old", { updatedAt: 1 }), chat("pinned", { updatedAt: 2, pinned: true }), chat("new", { updatedAt: 9, topic: "Payees", msgs: [user("Ong Bee Lian total")] })];
    expect(sortChats(list).map((c) => c.id)).toEqual(["pinned", "new", "old"]);
    expect(filterChats(list, "bee lian", "All").map((c) => c.id)).toEqual(["new"]);
    expect(filterChats(list, "", "Payees").map((c) => c.id)).toEqual(["new"]);
    expect(filterChats(list, "PINNED", "All").map((c) => c.id)).toEqual(["pinned"]);
  });

  it("replaces by id and caps the list, dropping the oldest unpinned chats", () => {
    const full = Array.from({ length: MAX_CHATS }, (_, i) => chat(`c${i}`, { updatedAt: i + 10, pinned: i === 0 }));
    expect(upsertChat(full, chat("c5", { title: "changed", updatedAt: 999 })).filter((c) => c.id === "c5")).toHaveLength(1);
    const next = upsertChat(full, chat("fresh", { updatedAt: 1000 }));
    expect(next).toHaveLength(MAX_CHATS);
    expect(next.some((c) => c.id === "fresh")).toBe(true);
    expect(next.some((c) => c.id === "c0")).toBe(true);  // pinned survives although it is the oldest
    expect(next.some((c) => c.id === "c1")).toBe(false); // oldest unpinned is dropped
  });
});
