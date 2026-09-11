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
  return messages.reduce(
    (total, message) => total + Math.ceil(JSON.stringify(message).length / 4) + 4,
    0,
  );
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
  if (estimateTokens(messages) <= options.maxTokens) {
    return { messages, compacted: false, droppedMessages: 0, droppedTokens: 0 };
  }
  const constraints = messages.filter((message) => message.role === "user");
  const groups: ConversationMessage[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined || message.role === "user") continue;
    if (message.role === "tool") continue;
    const group: ConversationMessage[] = [message];
    while (messages[index + 1]?.role === "tool") {
      group.push(messages[++index] as ConversationMessage);
    }
    groups.push(group);
  }
  let recent: ConversationMessage[] = [];
  const note = (dropped: number): ConversationMessage => ({
    role: "user",
    text: `[${dropped} messages compacted. Full transcript remains on the ledger. Read files for earlier details.]`,
  });
  for (const group of groups.slice(-(options.keepRecent ?? defaultKeepRecent)).reverse()) {
    const candidate = [...group, ...recent];
    if (estimateTokens([...constraints, note(messages.length), ...candidate]) > options.maxTokens)
      break;
    recent = candidate;
  }
  const kept = new Set([...constraints, ...recent]);
  const dropped = messages.filter((message) => !kept.has(message));
  const held = [...constraints, note(dropped.length), ...recent];
  return {
    messages: held,
    compacted: true,
    droppedMessages: dropped.length,
    droppedTokens: estimateTokens(dropped),
  };
}
