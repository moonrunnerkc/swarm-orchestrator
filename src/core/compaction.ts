import type { ConversationMessage } from "./model-client.ts";

/**
 * Keeping a conversation inside a budget, deliberately rather than by accident.
 *
 * The whole transcript was the working memory: every tool output and the content of every file
 * the run read, kept verbatim and resent on every step. A long run stops fitting, and what falls
 * out then is whatever the provider happens to drop, which is not a decision anybody made and
 * not one anybody can read back.
 *
 * What is kept is chosen rather than truncated: the task, because it is the constraint every
 * other message serves, and the most recent turns, because that is where the work is. What goes
 * is replaced by a line saying how much went, so the model is told its own memory was shortened
 * instead of quietly having a hole in it.
 *
 * This is not a summarizer. Asking a model to summarize its own context puts model text where
 * the record was, and invariant 1 is about exactly that. The ledger keeps everything; this only
 * decides what is resent.
 */

/**
 * Four characters to a token, which is the ordinary English ratio and wrong for code by a
 * little. It is deliberately an estimate: a real tokenizer is a per-model dependency, and the
 * budget it serves is a ceiling with room under it rather than an exact fit.
 */
export function estimateTokens(messages: readonly ConversationMessage[]): number {
  return messages.reduce((total, message) => total + Math.ceil(textOf(message).length / 4), 0);
}

/** A tool turn carries outcomes rather than text, and those are the largest thing in a run. */
function textOf(message: ConversationMessage): string {
  return message.role === "tool"
    ? message.outcomes.map((outcome) => JSON.stringify(outcome)).join("")
    : message.text;
}

export interface CompactionOptions {
  readonly maxTokens: number;
  /** How many recent messages are kept whatever the budget says. */
  readonly keepRecent?: number;
}

export interface CompactedConversation {
  readonly messages: readonly ConversationMessage[];
  readonly compacted: boolean;
  readonly droppedMessages: number;
  readonly droppedTokens: number;
}

const defaultKeepRecent = 6;

export function compactConversation(
  messages: readonly ConversationMessage[],
  options: CompactionOptions,
): CompactedConversation {
  if (estimateTokens(messages) <= options.maxTokens || messages.length <= 2) {
    return { messages, compacted: false, droppedMessages: 0, droppedTokens: 0 };
  }

  const [task, ...rest] = messages;
  if (task === undefined) {
    return { messages, compacted: false, droppedMessages: 0, droppedTokens: 0 };
  }

  const keepRecent = options.keepRecent ?? defaultKeepRecent;
  let recentCount = Math.min(keepRecent, rest.length);

  // Shrink the recent window until what is kept fits, but never below one message: a
  // conversation with nothing but a task and a note about what was dropped cannot be answered.
  const held = () => [task, ...rest.slice(rest.length - recentCount)];
  while (recentCount > 1 && estimateTokens(held()) > options.maxTokens) {
    recentCount -= 1;
  }

  const dropped = rest.slice(0, rest.length - recentCount);
  const summary: ConversationMessage = {
    role: "user",
    text:
      `[${dropped.length} message(s) compacted out of this conversation, about ` +
      `${estimateTokens(dropped)} tokens. The full record is on the ledger; what you can see ` +
      "here is the task and the most recent steps. If you need something from earlier, read " +
      "the file rather than recalling it.]",
  } as ConversationMessage;

  return {
    messages: [task, summary, ...rest.slice(rest.length - recentCount)],
    compacted: true,
    droppedMessages: dropped.length,
    droppedTokens: estimateTokens(dropped),
  };
}
