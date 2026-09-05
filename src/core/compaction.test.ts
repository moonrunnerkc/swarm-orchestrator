import { describe, expect, it } from "vitest";
import { compactConversation, estimateTokens } from "./compaction.ts";
import type { ConversationMessage } from "./model-client.ts";

function message(role: ConversationMessage["role"], text: string): ConversationMessage {
  return { role, text } as ConversationMessage;
}

/** A tool turn carries outcomes rather than text; nothing here builds one. */
function textOf(message: ConversationMessage | undefined): string {
  if (message === undefined || message.role === "tool") {
    return "";
  }
  return message.text;
}

/**
 * The whole transcript was the working memory: every tool output, every file the run read, kept
 * verbatim and resent on every step. A long run stops fitting, and what falls out is whatever
 * the provider happens to drop, which is not a decision anybody made.
 */
describe("keeping a conversation inside a budget", () => {
  it("leaves a conversation that fits completely alone", () => {
    const short = [message("user", "fix the parser"), message("assistant", "I will")];

    expect(compactConversation(short, { maxTokens: 10_000 }).messages).toEqual(short);
    expect(compactConversation(short, { maxTokens: 10_000 }).compacted).toBe(false);
  });

  it("keeps the task verbatim, because it is the constraint everything else serves", () => {
    const long = [
      message("user", "fix the parser so it handles an empty input"),
      ...Array.from({ length: 60 }, (_, index) =>
        message("assistant", `step ${index}: ${"tool output ".repeat(80)}`),
      ),
    ];

    const compacted = compactConversation(long, { maxTokens: 2_000 });

    expect(compacted.compacted).toBe(true);
    expect(textOf(compacted.messages[0])).toContain("fix the parser so it handles an empty input");
  });

  it("keeps the most recent turns verbatim, because that is where the work is", () => {
    const long = [
      message("user", "the task"),
      ...Array.from({ length: 60 }, (_, index) => message("assistant", `old ${index}`)),
      message("assistant", "the newest thing that happened"),
    ];

    const compacted = compactConversation(long, { maxTokens: 400 });

    expect(textOf(compacted.messages.at(-1))).toBe("the newest thing that happened");
  });

  it("replaces what it drops with a summary that says how much went and why", () => {
    const long = [
      message("user", "the task"),
      ...Array.from({ length: 80 }, (_, index) =>
        message("assistant", `middle ${index}: ${"x".repeat(200)}`),
      ),
      message("assistant", "recent"),
    ];

    const compacted = compactConversation(long, { maxTokens: 500 });
    const summary = compacted.messages.find((one) => textOf(one).includes("compacted"));

    expect(summary).toBeDefined();
    expect(textOf(summary)).toMatch(/\d+ message/);
    expect(compacted.droppedMessages).toBeGreaterThan(0);
  });

  it("brings the conversation under the budget it was given", () => {
    const long = [
      message("user", "the task"),
      ...Array.from({ length: 200 }, (_, index) =>
        message("assistant", `${index}: ${"y".repeat(400)}`),
      ),
    ];

    const compacted = compactConversation(long, { maxTokens: 1_000 });

    expect(estimateTokens(compacted.messages)).toBeLessThanOrEqual(1_000);
  });

  it("never drops so much that nothing is left to answer", () => {
    const long = Array.from({ length: 50 }, (_, index) =>
      message("assistant", `${index}: ${"z".repeat(4_000)}`),
    );

    const compacted = compactConversation([message("user", "the task"), ...long], {
      maxTokens: 50,
    });

    expect(compacted.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("estimates tokens from the text rather than counting them, and says so by being cheap", () => {
    expect(estimateTokens([message("user", "a".repeat(400))])).toBeGreaterThan(50);
    expect(estimateTokens([])).toBe(0);
  });
});
