import { describe, expect, it } from "vitest";
import {
  createInferenceLease,
  establishReadiness,
  judgeAnswer,
  probeInference,
  probeMaxTokens,
  probeRequestBody,
  probeTotals,
  readCompletionStream,
} from "./inference.mjs";

/** A streamed answer as a local server sends it: data lines, a usage chunk, the terminator. */
function sse(chunks, { done = true, usage = { prompt_tokens: 12, completion_tokens: 3 } } = {}) {
  const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
  if (usage !== null) lines.push(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
  if (done) lines.push("data: [DONE]\n\n");
  return lines.join("");
}
const textAnswer = (text, finish = "stop") =>
  sse([
    { choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: finish }] },
  ]);
const toolAnswer = (name = "record_probe_word", args = '{"word":"ready"}') =>
  sse([
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name, arguments: args } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ]);
const stream = (text) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
const response = (text, status = 200) =>
  new Response(text, { status, headers: { "content-type": "text/event-stream" } });

/** A fetch that answers each request kind from a table and records every body it was sent. */
function fakeFetch(answers) {
  const sent = [];
  const implementation = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body });
    const kind =
      body.tools === undefined
        ? "chat"
        : body.messages.some((m) => m.role === "tool")
          ? "tool-result"
          : "tool-call";
    const answer = answers[kind];
    if (typeof answer === "function") return answer(init);
    return response(answer);
  };
  return { sent, implementation };
}

describe("the probe's request", () => {
  it("is the product's wire shape, field for field, with the probe's own messages", () => {
    const body = probeRequestBody("qwen3.6:35b-a3b", [{ role: "user", content: "hi" }], null);
    expect(body).toEqual({
      model: "qwen3.6:35b-a3b",
      max_tokens: probeMaxTokens,
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
      reasoning_effort: "none",
      messages: [
        { role: "system", content: expect.any(String) },
        { role: "user", content: "hi" },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
    const withTools = probeRequestBody("m", [], [{ type: "function", function: { name: "t" } }]);
    expect(withTools.tool_choice).toBe("auto");
    expect(withTools.tools).toHaveLength(1);
  });
});

describe("reading a streamed completion", () => {
  it("assembles text, tool calls by index, the finish reason and usage, and sees the terminator", async () => {
    const read = await readCompletionStream(stream(toolAnswer()));
    expect(read.problem).toBeNull();
    expect(read.done).toBe(true);
    expect(read.finishReason).toBe("tool_calls");
    expect(read.toolCalls).toEqual([
      { id: "call_1", name: "record_probe_word", arguments: '{"word":"ready"}' },
    ]);
    expect(read.usage).toEqual({ input: 12, output: 3 });
    const split = await readCompletionStream(
      stream(
        sse([
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, id: "c", function: { name: "record_", arguments: '{"wo' } },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, function: { name: "probe_word", arguments: 'rd":"ready"}' } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]),
      ),
    );
    expect(split.toolCalls).toEqual([
      { id: "c", name: "record_probe_word", arguments: '{"word":"ready"}' },
    ]);
  });

  it("names a stream cut before its terminator, a chunk that is not JSON, an error chunk, and an answer past the byte bound", async () => {
    expect(
      (await readCompletionStream(stream(textAnswer("ready").replace("data: [DONE]\n\n", ""))))
        .problem,
    ).toBe("the stream ended without [DONE]");
    expect(
      (await readCompletionStream(stream("data: {not json\n\ndata: [DONE]\n\n"))).problem,
    ).toMatch(/was not JSON/);
    expect(
      (
        await readCompletionStream(
          stream(`data: ${JSON.stringify({ error: { message: "boom" } })}\n\ndata: [DONE]\n\n`),
        )
      ).problem,
    ).toMatch(/carried an error: .*boom/);
    const long = await readCompletionStream(stream(textAnswer("x".repeat(500))), { maxBytes: 100 });
    expect(long.problem).toBe("the stream exceeded 100 bytes");
  });
});

describe("judging an answer", () => {
  it("requires text of a plain answer, a parseable call of the named tool, and a finish reason", () => {
    const plain = { problem: null, finishReason: "stop", text: "ready", toolCalls: [] };
    expect(judgeAnswer("chat", plain)).toBeNull();
    expect(judgeAnswer("chat", { ...plain, text: "  " })).toMatch(/answered with no text/);
    expect(judgeAnswer("chat", { ...plain, finishReason: null })).toBe("no finish reason arrived");
    expect(judgeAnswer("chat", { ...plain, problem: "cut" })).toBe("cut");
    const call = { id: "c", name: "record_probe_word", arguments: '{"word":"ready"}' };
    const tool = { problem: null, finishReason: "tool_calls", text: "", toolCalls: [call] };
    expect(judgeAnswer("tool-call", tool)).toBeNull();
    expect(judgeAnswer("tool-call", { ...tool, toolCalls: [] })).toMatch(/without a tool call/);
    expect(judgeAnswer("tool-call", { ...tool, toolCalls: [{ ...call, name: "other" }] })).toMatch(
      /named other/,
    );
    expect(judgeAnswer("tool-call", { ...tool, toolCalls: [{ ...call, arguments: "{" }] })).toMatch(
      /not JSON/,
    );
    expect(
      judgeAnswer("tool-call", { ...tool, toolCalls: [{ ...call, arguments: "{}" }] }),
    ).toMatch(/no word/);
    expect(judgeAnswer("tool-call", { ...tool, toolCalls: [{ ...call, id: null }] })).toMatch(
      /no id/,
    );
    expect(judgeAnswer("tool-result", { ...plain, text: "done" })).toBeNull();
  });
});

describe("one readiness sequence", () => {
  const options = (implementation, more = {}) => ({
    endpoint: "http://127.0.0.1:1/v1/",
    model: "m",
    fetchImplementation: implementation,
    requestDeadlineMs: 500,
    sequenceDeadlineMs: 2_000,
    ...more,
  });

  it("completes the chat, tool-call and tool-result round trip, carrying the model's own call back, and records each request's usage and timing", async () => {
    const { sent, implementation } = fakeFetch({
      chat: textAnswer("ready"),
      "tool-call": toolAnswer(),
      "tool-result": textAnswer("done"),
    });
    const sequence = await probeInference(options(implementation));
    expect(sequence.ok).toBe(true);
    expect(sequence.problem).toBeNull();
    expect(sequence.purpose).toBe("readiness");
    expect(sequence.requests.map((one) => [one.kind, one.outcome, one.status])).toEqual([
      ["chat", "answered", 200],
      ["tool-call", "answered", 200],
      ["tool-result", "answered", 200],
    ]);
    for (const request of sequence.requests) {
      expect(request.usage).toEqual({ input: 12, output: 3 });
      expect(request.firstByteMs).toBeGreaterThanOrEqual(0);
      expect(request.wallMs).toBeGreaterThanOrEqual(request.firstByteMs);
    }
    expect(sent.map((one) => one.url)).toEqual(
      Array(3).fill("http://127.0.0.1:1/v1/chat/completions"),
    );
    const third = sent[2].body.messages;
    expect(third.find((m) => m.role === "assistant").tool_calls[0]).toEqual({
      id: "call_1",
      type: "function",
      function: { name: "record_probe_word", arguments: '{"word":"ready"}' },
    });
    expect(third.find((m) => m.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "recorded ready",
    });
    expect(sequence.configuration).toMatchObject({
      endpoint: "http://127.0.0.1:1/v1/",
      model: "m",
      stream: true,
      includeUsage: true,
      thinking: false,
      requestDeadlineMs: 500,
    });
    expect(probeTotals([sequence])).toEqual({
      probeRequests: 3,
      probeRequestsWithoutUsage: 0,
      probeTokens: 45,
      probeWallMs: sequence.wallMs,
    });
  });

  it("stops at the first request that fails and says which and why: a listing-only server, plain chat without the tool path, a cut stream", async () => {
    const listingOnly = fakeFetch({ chat: () => response("", 404) });
    const refused = await probeInference(options(listingOnly.implementation));
    expect(refused.ok).toBe(false);
    expect(refused.problem).toBe("the chat request failed: HTTP 404");
    expect(refused.requests).toHaveLength(1);

    const noTools = fakeFetch({
      chat: textAnswer("ready"),
      "tool-call": textAnswer("I would call it."),
    });
    const plainOnly = await probeInference(options(noTools.implementation));
    expect(plainOnly.ok).toBe(false);
    expect(plainOnly.problem).toMatch(
      /^the tool-call request failed: the model answered without a tool call/,
    );
    expect(plainOnly.requests.map((one) => one.outcome)).toEqual(["answered", "failed"]);

    const cut = fakeFetch({ chat: textAnswer("ready").replace("data: [DONE]\n\n", "") });
    const malformed = await probeInference(options(cut.implementation));
    expect(malformed.problem).toBe("the chat request failed: the stream ended without [DONE]");
  });

  it("ends a request that never answers at the request deadline, and a slow answer inside it is healthy", async () => {
    const never = fakeFetch({
      chat: (init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    });
    const began = Date.now();
    const hung = await probeInference(options(never.implementation, { requestDeadlineMs: 200 }));
    expect(hung.ok).toBe(false);
    expect(hung.problem).toBe("the chat request failed: no complete answer within 200 ms");
    expect(hung.requests[0].wallMs).toBeGreaterThanOrEqual(190);
    expect(Date.now() - began).toBeLessThan(2_000);

    const slow = fakeFetch({
      chat: () =>
        new Promise((resolve) => setTimeout(() => resolve(response(textAnswer("ready"))), 120)),
      "tool-call": toolAnswer(),
      "tool-result": textAnswer("done"),
    });
    const healthy = await probeInference(
      options(slow.implementation, { requestDeadlineMs: 1_000 }),
    );
    expect(healthy.ok).toBe(true);
    expect(healthy.requests[0].wallMs).toBeGreaterThanOrEqual(100);
  });

  it("is refused without a request while an invocation holds the lease, and holds it itself while it runs", async () => {
    const lease = createInferenceLease();
    const release = lease.hold("swarm invocation");
    const { sent, implementation } = fakeFetch({ chat: textAnswer("ready") });
    const refused = await probeInference(options(implementation, { lease }));
    expect(refused.ok).toBe(false);
    expect(refused.problem).toMatch(/^refused: inference is held by swarm invocation/);
    expect(refused.requests).toEqual([
      expect.objectContaining({ kind: "chat", outcome: "refused", status: null, usage: null }),
    ]);
    expect(sent).toEqual([]);
    release();
    let holderDuring = null;
    const observing = fakeFetch({
      chat: () => {
        holderDuring = lease.holder;
        return response(textAnswer("ready"));
      },
      "tool-call": toolAnswer(),
      "tool-result": textAnswer("done"),
    });
    const ok = await probeInference(options(observing.implementation, { lease }));
    expect(ok.ok).toBe(true);
    expect(holderDuring).toBe("probe (readiness)");
    expect(lease.holder).toBeNull();
    expect(() => {
      const first = lease.hold("a");
      lease.hold("b");
      first();
    }).toThrow(/already held by a/);
  });

  it("counts the probe's spend as a lower bound where a request answered without usage or never answered", async () => {
    const { implementation } = fakeFetch({
      chat: sse(
        [
          { choices: [{ index: 0, delta: { content: "ready" }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ],
        { usage: null },
      ),
      "tool-call": () => response("", 500),
    });
    const sequence = await probeInference(options(implementation));
    expect(sequence.requests.map((one) => one.outcome)).toEqual(["answered", "failed"]);
    expect(probeTotals([sequence])).toEqual({
      probeRequests: 2,
      probeRequestsWithoutUsage: 2,
      probeTokens: 0,
      probeWallMs: sequence.wallMs,
    });
  });
});

describe("establishing readiness", () => {
  it("tries up to the allowed sequences, stops at the first success, and does not retry a refusal", async () => {
    let calls = 0;
    const flaky = async (_url, init) => {
      calls += 1;
      return calls === 1
        ? response("", 503)
        : response(
            JSON.parse(init.body).tools
              ? JSON.parse(init.body).messages.some((m) => m.role === "tool")
                ? textAnswer("done")
                : toolAnswer()
              : textAnswer("ready"),
          );
    };
    const ready = await establishReadiness(
      {
        endpoint: "http://127.0.0.1:1/v1",
        model: "m",
        fetchImplementation: flaky,
        requestDeadlineMs: 500,
      },
      2,
    );
    expect(ready.ok).toBe(true);
    expect(ready.sequences.map((one) => one.ok)).toEqual([false, true]);

    const down = await establishReadiness(
      {
        endpoint: "http://127.0.0.1:1/v1",
        model: "m",
        fetchImplementation: async () => response("", 503),
        requestDeadlineMs: 500,
      },
      2,
    );
    expect(down.ok).toBe(false);
    expect(down.sequences).toHaveLength(2);

    const lease = createInferenceLease();
    lease.hold("an arm");
    const held = await establishReadiness(
      {
        endpoint: "http://127.0.0.1:1/v1",
        model: "m",
        lease,
        fetchImplementation: async () => response("", 503),
      },
      2,
    );
    expect(held.ok).toBe(false);
    expect(held.sequences).toHaveLength(1);
  });
});
