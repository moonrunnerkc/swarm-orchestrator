import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ModelRequest } from "../core/model-client.ts";
import { createAiSdkModelClient } from "./ai-sdk-model-client.ts";

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
};

const msPerPart = 15;

/** A model that takes real time to stream, so the timings it reports are real intervals. */
function streamingModel(parts: readonly LanguageModelV4StreamPart[]) {
  return new MockLanguageModelV4({
    doStream: () => {
      let index = 0;
      return Promise.resolve({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async pull(controller) {
            const part = parts[index];
            index += 1;
            if (part === undefined) {
              controller.close();
              return;
            }
            await new Promise((resume) => setTimeout(resume, msPerPart));
            controller.enqueue(part);
          },
        }),
      });
    },
  });
}

function request(tools: ModelRequest["tools"] = []): ModelRequest {
  return {
    system: "be brief",
    messages: [{ role: "user", text: "hello" }],
    tools,
    maxOutputTokens: 256,
    abortSignal: new AbortController().signal,
  };
}

describe("createAiSdkModelClient", () => {
  it("times the first output token separately from the whole call", async () => {
    const model = createAiSdkModelClient(
      "local:qwen",
      streamingModel([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: "Hel" },
        { type: "text-delta", id: "1", delta: "lo" },
        { type: "text-end", id: "1" },
        { type: "finish", finishReason: { unified: "stop" as const, raw: "stop" }, usage },
      ]),
    );

    const { performance } = await model.generate(request());

    expect(performance.firstTokenMs).toBeGreaterThan(0);
    // Three parts arrive before the first delta and three after it, so a measure equal to the
    // whole call would mean the client timed the wrong thing.
    expect(performance.firstTokenMs ?? 0).toBeLessThan(performance.responseTimeMs);
    expect(performance.outputTokensPerSecond).toBeGreaterThan(0);
  });

  it("says it did not observe the timings when the model streamed no output", async () => {
    const model = createAiSdkModelClient(
      "local:qwen",
      streamingModel([
        { type: "stream-start", warnings: [] },
        { type: "finish", finishReason: { unified: "stop" as const, raw: "stop" }, usage },
      ]),
    );

    const { performance } = await model.generate(request());

    expect(performance.firstTokenMs).toBeNull();
    expect(performance.outputTokensPerSecond).toBeNull();
    expect(performance.responseTimeMs).toBeGreaterThan(0);
  });

  it("counts a tool call as the first output, so an agentic turn is still timed", async () => {
    const tools = [
      { name: "read", description: "read a file", inputSchema: z.object({ path: z.string() }) },
    ];
    const model = createAiSdkModelClient(
      "local:qwen",
      streamingModel([
        { type: "stream-start", warnings: [] },
        { type: "tool-call", toolCallId: "c1", toolName: "read", input: '{"path":"a.ts"}' },
        {
          type: "finish",
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage,
        },
      ]),
    );

    const response = await model.generate(request(tools));

    expect(response.performance.firstTokenMs).not.toBeNull();
    expect(response.toolCalls).toEqual([
      { callId: "c1", toolName: "read", input: { path: "a.ts" } },
    ]);
  });

  it("carries the text and the token counts back", async () => {
    const model = createAiSdkModelClient(
      "local:qwen",
      streamingModel([
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: "Hello" },
        { type: "text-end", id: "1" },
        { type: "finish", finishReason: { unified: "stop" as const, raw: "stop" }, usage },
      ]),
    );

    const response = await model.generate(request());

    expect(response.text).toBe("Hello");
    expect(response.inputTokens).toBe(7);
    expect(response.outputTokens).toBe(3);
  });

  it("throws when the stream carries an error, rather than returning half a response", async () => {
    const model = createAiSdkModelClient(
      "local:qwen",
      streamingModel([
        { type: "stream-start", warnings: [] },
        { type: "error", error: new Error("the runtime dropped the connection") },
      ]),
    );

    await expect(model.generate(request())).rejects.toThrow(/dropped the connection/);
  });
});
