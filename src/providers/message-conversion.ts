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
      input: renderableInput(call.input),
    });
  }
  return parts.length === 0 ? "" : parts;
}

/**
 * What a replayed tool call carries as its arguments. A call the model cut off at its output
 * limit arrives with the fragment it managed (`{`), which the loop keeps as it was and refuses
 * at the chokepoint. Sent back as it is, an OpenAI-compatible server parses the fragment to a
 * string and its chat template fails on every later request ("Can only get item pairs from a
 * mapping"), which ended three trial runs as model errors. The fragment is carried under one
 * key instead, so the model sees what it wrote and the server has a mapping to render.
 */
function renderableInput(input: unknown): unknown {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) return input;
  return { unparsed_arguments: typeof input === "string" ? input : (JSON.stringify(input) ?? "") };
}
