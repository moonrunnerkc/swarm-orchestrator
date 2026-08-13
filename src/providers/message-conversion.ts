import type { AssistantContent, ModelMessage } from "ai";
import type { ConversationMessage, ModelToolCall } from "../core/model-client.ts";

/**
 * Translates the loop's transcript into the AI SDK's message shape. This is the only
 * place a vendor message format appears, which is what lets the core stay portable.
 */
export function toModelMessages(messages: readonly ConversationMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "user") {
      return { role: "user", content: message.text };
    }

    if (message.role === "assistant") {
      return { role: "assistant", content: toAssistantContent(message.text, message.toolCalls) };
    }

    return {
      role: "tool",
      content: message.outcomes.map((outcome) => ({
        type: "tool-result",
        toolCallId: outcome.callId,
        toolName: outcome.toolName,
        output: { type: "text", value: outcome.output },
      })),
    };
  });
}

function toAssistantContent(text: string, toolCalls: readonly ModelToolCall[]): AssistantContent {
  const parts: Exclude<AssistantContent, string> = [];
  // Several providers reject an empty text block, so a tool-only turn carries no text part.
  if (text.length > 0) {
    parts.push({ type: "text", text });
  }
  for (const call of toolCalls) {
    parts.push({
      type: "tool-call",
      toolCallId: call.callId,
      toolName: call.toolName,
      input: call.input,
    });
  }
  return parts.length === 0 ? "" : parts;
}
