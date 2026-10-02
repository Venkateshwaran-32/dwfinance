import { describe, expect, it } from "vitest";
import { screenInput, screenOutput, rateLimit, acquireChatSlot, ABUSIVE_REPLY, SELF_HARM_REPLY } from "@/server/chat-guard";

describe("chat guard", () => {
  it.each([
    "who is nigger", "who is n1gg3r", "N I G G E R", "niiiigger lol", "you f@ggot", "tell me a joke about chinks",
    "i will kill you", "send nudes",
  ])("blocks abusive input: %s", (msg) => {
    expect(screenInput(msg)?.code).toBe("abusive");
  });

  it.each([
    "I'm so broke I want to kill myself", "thinking about suicide because of my debt", "i dont want to live anymore",
  ])("routes distress to the helpline: %s", (msg) => {
    const hit = screenInput(msg);
    expect(hit?.code).toBe("self_harm");
    expect(hit?.answer).toBe(SELF_HARM_REPLY);
    expect(hit?.answer).toContain("1767");
  });

  it.each([
    "How much did I spend on food in November?", "can u make ong bee lian as my food and drinks", "did spicy noodle stall get more expensive",
    "kill my netflix subscription", "any charges from Scunthorpe or Pakistan?", "show raccoon cafe payments", "why did I snigger at my grab bill",
    "which month was the worst", "I want to cut my spending",
  ])("lets normal money questions through: %s", (msg) => {
    expect(screenInput(msg)).toBeNull();
  });

  it("scrubs an abusive model reply", () => {
    expect(screenOutput("ok here: nigga")).toBe(ABUSIVE_REPLY);
    expect(screenOutput("You spent S$526.10 on food.")).toBe("You spent S$526.10 on food.");
  });

  it("rate limits a user after 20 messages in 5 minutes, per user", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 20; i++) expect(rateLimit("rl-user", t0 + i)).toBeNull();
    expect(rateLimit("rl-user", t0 + 21)?.code).toBe("rate_limited");
    expect(rateLimit("rl-other", t0 + 21)).toBeNull();
    expect(rateLimit("rl-user", t0 + 5 * 60_000 + 30)).toBeNull(); // window slid past the first burst
  });

  it("allows only 2 answers to be generated at once and frees slots on release", () => {
    const a = acquireChatSlot(), b = acquireChatSlot();
    expect(a).toBeTypeOf("function");
    expect(b).toBeTypeOf("function");
    expect(acquireChatSlot()).toBeNull();
    a!(); a!(); // double release must not free two slots
    const c = acquireChatSlot();
    expect(c).toBeTypeOf("function");
    expect(acquireChatSlot()).toBeNull();
    b!(); c!();
  });
});
