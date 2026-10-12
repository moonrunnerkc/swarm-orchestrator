import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../core/model-client.ts";
import { toModelMessages } from "./message-conversion.ts";

describe("toModelMessages", () => {
  it("carries a user turn across as plain text", () => {
    expect(toModelMessages([{ role: "user", text: "fix the build" }])).toEqual([
      { role: "user", content: "fix the build" },
    ]);
  });

  it("replays a tool call whose arguments never parsed as a mapping the server can render", () => {
    // A call cut off at the output limit arrives with the fragment it managed; sent back as a
    // string, an OpenAI-compatible server's chat template fails on every later request.
    const messages: ConversationMessage[] = [
      { role: "assistant", text: "", toolCalls: [{ callId: "c", toolName: "shell", input: "{" }] },
      {
        role: "assistant",
        text: "",
        toolCalls: [{ callId: "d", toolName: "shell", input: ["not", "a", "mapping"] }],
      },
    ];
    expect(toModelMessages(messages)).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c",
            toolName: "shell",
            input: { unparsed_arguments: "{" },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "d",
            toolName: "shell",
            input: { unparsed_arguments: '["not","a","mapping"]' },
          },
        ],
      },
    ]);
  });

  it("keeps text and tool calls together on an assistant turn", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        text: "reading first",
        toolCalls: [{ callId: "call-1", toolName: "read", input: { path: "a.ts" } }],
      },
    ];

    expect(toModelMessages(messages)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "reading first" },
          { type: "tool-call", toolCallId: "call-1", toolName: "read", input: { path: "a.ts" } },
        ],
      },
    ]);
  });

  it("omits the text part when a turn is tool calls only", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        text: "",
        toolCalls: [{ callId: "call-1", toolName: "list", input: {} }],
      },
    ];

    expect(toModelMessages(messages)).toEqual([
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "list", input: {} }],
      },
    ]);
  });

  it("pairs each tool outcome with the call it answers", () => {
    const messages: ConversationMessage[] = [
      {
        role: "tool",
        outcomes: [
          { callId: "call-1", toolName: "read", output: "file body", failed: false },
          { callId: "call-2", toolName: "write", output: "denied: outside", failed: true },
        ],
      },
    ];

    expect(toModelMessages(messages)).toEqual([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "read",
            output: { type: "text", value: "file body" },
          },
          {
            type: "tool-result",
            toolCallId: "call-2",
            toolName: "write",
            output: { type: "text", value: "denied: outside" },
          },
        ],
      },
    ]);
  });
});
