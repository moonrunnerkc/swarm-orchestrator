import { describe, expect, it } from "vitest";
import {
  createFixtureModelClient,
  type FixtureTurn,
  failWith,
  respondTruncated,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { degenerateRepeatThreshold } from "./degenerate-output.ts";
import { type AgentLoopDependencies, runAgentLoop } from "./loop.ts";
import type { LoopEvent } from "./loop-events.ts";
import {
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  unobservedPerformance,
} from "./model-client.ts";
import type { LoopBudget } from "./termination.ts";
import {
  createFixedRandom,
  createRecordingToolInvoker,
  createTestClock,
  type RecordingToolInvoker,
  type TestClock,
} from "./test-doubles.ts";

const generousBudget: LoopBudget = {
  maxSteps: 10,
  maxTokens: 10_000,
  maxWallTimeMs: 60_000,
};

interface Harness {
  readonly deps: AgentLoopDependencies;
  readonly events: LoopEvent[];
  readonly clock: TestClock;
  readonly toolInvoker: RecordingToolInvoker;
  readonly controller: AbortController;
}

function createHarness(
  turns: readonly FixtureTurn[],
  overrides: Partial<AgentLoopDependencies> = {},
): Harness {
  const events: LoopEvent[] = [];
  const clock = createTestClock();
  const toolInvoker = createRecordingToolInvoker();
  const controller = new AbortController();

  const deps: AgentLoopDependencies = {
    model: createFixtureModelClient({ modelId: "fixture:loop", turns }),
    toolInvoker,
    toolSchemas: [],
    clock,
    random: createFixedRandom(),
    emit: (event) => events.push(event),
    budget: generousBudget,
    abortSignal: controller.signal,
    systemPrompt: "test system prompt",
    maxOutputTokens: 1024,
    retryPolicy: { attempts: 3, baseDelayMs: 100, maxJitterRatio: 0 },
    ...overrides,
  };

  return { deps, events, clock, toolInvoker, controller };
}

describe("runAgentLoop", () => {
  it("records the first turn as the plan and the last as an unverified claim", async () => {
    const harness = createHarness([
      respondWithToolCalls("I will read the file first.", [
        { callId: "call-1", toolName: "read", input: { path: "README.md" } },
      ]),
      respondWithText("Read the file and left it unchanged."),
    ]);

    const outcome = await runAgentLoop("describe the readme", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(outcome.steps).toBe(2);
    expect(outcome.plan).toBe("I will read the file first.");
    expect(outcome.completionClaim).toBe("Read the file and left it unchanged.");
    expect(harness.events).toContainEqual({
      type: "claim",
      text: "Read the file and left it unchanged.",
      verified: false,
    });
  });

  it("routes every tool call through the injected invoker and feeds results back", async () => {
    const harness = createHarness([
      respondWithToolCalls("", [{ callId: "call-1", toolName: "list", input: { path: "src" } }]),
      respondWithText("done"),
    ]);

    const outcome = await runAgentLoop("list the sources", harness.deps);

    expect(harness.toolInvoker.invocations).toEqual([
      { callId: "call-1", toolName: "list", input: { path: "src" }, provenance: "model" },
    ]);
    expect(outcome.messages).toContainEqual({
      role: "tool",
      outcomes: [{ callId: "call-1", toolName: "list", output: "ok", failed: false }],
    });
  });

  it("stops on max-steps without asking the model for another turn", async () => {
    const harness = createHarness(
      [
        respondWithToolCalls("step one", [{ callId: "a", toolName: "list", input: {} }]),
        respondWithToolCalls("step two", [{ callId: "b", toolName: "list", input: {} }]),
        respondWithText("never reached"),
      ],
      { budget: { ...generousBudget, maxSteps: 2 } },
    );

    const outcome = await runAgentLoop("keep going", harness.deps);

    expect(outcome.stopReason).toBe("max-steps");
    expect(outcome.steps).toBe(2);
    expect(outcome.completionClaim).toBe("");
  });

  it("counts the answered calls whose usage the provider did not report", async () => {
    const reported = createFixtureModelClient({
      modelId: "fixture:loop",
      turns: [
        respondWithToolCalls("looking", [{ callId: "a", toolName: "list", input: {} }], {
          input: 60,
          output: 60,
        }),
        respondWithText("done"),
      ],
    });
    let call = 0;
    const harness = createHarness([], {
      model: {
        modelId: reported.modelId,
        // The second answer arrives with no usage, the way a local server's stream can end.
        generate: async (request) => {
          call += 1;
          const response = await reported.generate(request);
          return call === 2
            ? { ...response, inputTokens: 0, outputTokens: 0, usageStatus: "unknown" }
            : response;
        },
      },
    });

    const outcome = await runAgentLoop("two calls", harness.deps);

    // The total is what was reported and no more, and the count says it is a lower bound.
    expect(outcome.tokensUsed).toBe(120);
    expect(outcome.callsWithUnknownUsage).toBe(1);
    // The stream a supervisor reads says so too; a total there with no count read as measured.
    expect(harness.events.at(-1)).toMatchObject({
      type: "stopped",
      tokensUsed: 120,
      callsWithUnknownUsage: 1,
    });
  });

  it("reports no unknown usage where every call reported", async () => {
    const harness = createHarness([respondWithText("done", { input: 5, output: 5 })]);
    const outcome = await runAgentLoop("one call", harness.deps);
    expect(outcome.callsWithUnknownUsage).toBe(0);
    expect(harness.events.at(-1)).toMatchObject({ type: "stopped", callsWithUnknownUsage: 0 });
  });

  it("stops on max-tokens once the spend crosses the budget", async () => {
    const harness = createHarness(
      [
        respondWithToolCalls("burning tokens", [{ callId: "a", toolName: "list", input: {} }], {
          input: 60,
          output: 60,
        }),
        respondWithText("never reached"),
      ],
      { budget: { ...generousBudget, maxTokens: 100 } },
    );

    const outcome = await runAgentLoop("spend the budget", harness.deps);

    expect(outcome.stopReason).toBe("max-tokens");
    expect(outcome.tokensUsed).toBe(120);
  });

  it("withholds a call whose prompt alone cannot fit in what is left, naming the reserved size", async () => {
    // 220 of 300 spent; the next prompt is at least the 200 the last one measured, so the call
    // is not made and the second turn stays unplayed. Before this the call went out and the run
    // ended past its cap by one prompt.
    const harness = createHarness(
      [
        respondWithToolCalls("reading", [{ callId: "a", toolName: "list", input: {} }], {
          input: 200,
          output: 20,
        }),
        respondWithText("never reached"),
      ],
      { budget: { ...generousBudget, maxTokens: 300 } },
    );

    const outcome = await runAgentLoop("spend carefully", harness.deps);

    expect(outcome.stopReason).toBe("max-tokens");
    expect(outcome.tokensUsed).toBe(220);
    expect(outcome.reservedTokens).toBe(200);
    expect(outcome.steps).toBe(1);
    expect(harness.events.at(-1)).toMatchObject({
      type: "stopped",
      reason: "max-tokens",
      tokensUsed: 220,
      reservedTokens: 200,
    });
  });

  it("keeps the spend by kind apart, with reasoning and cached counts null until reported", async () => {
    const harness = createHarness([
      respondWithToolCalls("reading", [{ callId: "a", toolName: "list", input: {} }], {
        input: 100,
        output: 10,
      }),
      {
        kind: "response",
        response: {
          text: "done",
          toolCalls: [],
          inputTokens: 150,
          outputTokens: 40,
          reasoningTokens: 30,
          cachedInputTokens: 90,
          finishReason: "stop",
          performance: unobservedPerformance,
          unsupportedFeatures: [],
        },
      },
    ]);

    const outcome = await runAgentLoop("account", harness.deps);

    expect(outcome.tokensUsed).toBe(300);
    expect(outcome.usage).toEqual({
      inputTokens: 250,
      outputTokens: 50,
      reasoningTokens: 30,
      cachedInputTokens: 90,
    });
    expect(outcome.reservedTokens).toBe(0);
    expect(harness.events.at(-1)).toMatchObject({ type: "stopped", usage: outcome.usage });
    expect(harness.events.at(-1)).not.toHaveProperty("reservedTokens");
  });

  it("stops on max-wall-time using the injected clock", async () => {
    const harness = createHarness(
      [
        respondWithToolCalls("slow work", [{ callId: "a", toolName: "list", input: {} }]),
        respondWithText("never reached"),
      ],
      { budget: { ...generousBudget, maxWallTimeMs: 5_000 } },
    );
    harness.deps.toolInvoker.invoke = (invocation) => {
      harness.clock.advance(5_000);
      return Promise.resolve({
        callId: invocation.callId,
        toolName: invocation.toolName,
        output: "slept",
        failed: false,
      });
    };

    const outcome = await runAgentLoop("take too long", harness.deps);

    expect(outcome.stopReason).toBe("max-wall-time");
  });

  /**
   * The wall budget was checked between steps only, so a call that never returned held a run
   * until something outside killed it, with no gates run and no bundle written. A campaign run
   * showed exactly that: seven steps, then forty minutes of nothing.
   */
  it("ends a model call that never returns at the wall budget, as a wall-time stop", async () => {
    let aborted = false;
    let clock: TestClock | null = null;
    const hung: ModelClient = {
      modelId: "fixture:hung",
      generate: (request: ModelRequest) =>
        new Promise((_, reject) => {
          request.abortSignal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("the call was aborted"));
          });
          // The backend goes quiet; the test clock reaches the budget while it is.
          clock?.advance(5_000);
        }),
    };
    const harness = createHarness([], {
      budget: { ...generousBudget, maxWallTimeMs: 5_000 },
      model: hung,
    });
    clock = harness.clock;

    const outcome = await runAgentLoop("wait for a backend that never answers", harness.deps);

    expect(aborted).toBe(true);
    expect(outcome.stopReason).toBe("max-wall-time");
    expect(outcome.steps).toBe(0);
    expect(harness.events.filter((event) => event.type === "model-error")).toHaveLength(1);
  });

  it("stops as interrupted when the abort signal fires", async () => {
    const harness = createHarness([
      respondWithToolCalls("starting", [{ callId: "a", toolName: "list", input: {} }]),
      respondWithText("never reached"),
    ]);
    harness.deps.toolInvoker.invoke = (invocation) => {
      harness.controller.abort();
      return Promise.resolve({
        callId: invocation.callId,
        toolName: invocation.toolName,
        output: "interrupted mid-tool",
        failed: false,
      });
    };

    const outcome = await runAgentLoop("stop halfway", harness.deps);

    expect(outcome.stopReason).toBe("interrupted");
    expect(outcome.steps).toBe(1);
  });

  it("stops as max-wall-time when the abort arrives past its own wall, mid-tool", async () => {
    // The backstop that ends model work fires as the loop's wall ends, to cut what is still in
    // flight; a loop past its wall was stopped by its wall, not by a person.
    const harness = createHarness([
      respondWithToolCalls("starting", [{ callId: "a", toolName: "shell", input: {} }]),
      respondWithText("never reached"),
    ]);
    harness.deps.toolInvoker.invoke = (invocation) => {
      harness.clock.advance(generousBudget.maxWallTimeMs + 1_000);
      harness.controller.abort("the model-work allowance is spent");
      return Promise.resolve({
        callId: invocation.callId,
        toolName: invocation.toolName,
        output: "cancelled",
        failed: true,
      });
    };

    const outcome = await runAgentLoop("run past the wall", harness.deps);

    expect(outcome.stopReason).toBe("max-wall-time");
  });

  it("stops as max-wall-time when the abort arrives past its own wall, mid-call", async () => {
    const harness = createHarness([respondWithText("never reached")]);
    harness.deps.model.generate = (request) =>
      new Promise((_resolve, reject) => {
        request.abortSignal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
        harness.clock.advance(generousBudget.maxWallTimeMs + 1_000);
        harness.controller.abort("the model-work allowance is spent");
      });

    const outcome = await runAgentLoop("run past the wall", harness.deps);

    expect(outcome.stopReason).toBe("max-wall-time");
  });

  /**
   * A run stopped from the keyboard while the model was answering used to report
   * "model error: This operation was aborted", the transport's own words for a cancelled
   * request. What stopped the run is on the signal, and that is what a person reads.
   */
  it("names what stopped the run rather than the transport's abort text", async () => {
    const harness = createHarness([respondWithText("never reached")]);
    harness.deps.model.generate = (request) =>
      new Promise((_resolve, reject) => {
        request.abortSignal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
        harness.controller.abort(new Error("the run was cancelled from the keyboard"));
      });

    const outcome = await runAgentLoop("stop during the call", harness.deps);

    const reported = harness.events.find((event) => event.type === "model-error");
    expect(outcome.stopReason).toBe("interrupted");
    expect(reported?.type === "model-error" && reported.message).toContain(
      "the run was cancelled from the keyboard",
    );
    expect(reported?.type === "model-error" && reported.message).not.toContain(
      "This operation was aborted",
    );
  });

  it("retries a failing model call with jittered backoff, then escalates", async () => {
    const harness = createHarness([
      failWith("connection reset"),
      failWith("connection reset"),
      failWith("connection reset"),
    ]);

    const outcome = await runAgentLoop("talk to a broken provider", harness.deps);

    expect(outcome.stopReason).toBe("model-error");
    expect(harness.clock.sleeps).toEqual([100, 200]);
    expect(harness.events.filter((event) => event.type === "model-error")).toHaveLength(3);
  });

  it("recovers when a retry succeeds", async () => {
    const harness = createHarness([failWith("overloaded"), respondWithText("recovered")]);

    const outcome = await runAgentLoop("retry once", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(outcome.completionClaim).toBe("recovered");
    expect(harness.clock.sleeps).toEqual([100]);
  });

  it("sends the system prompt and running transcript to the model", async () => {
    const model = createFixtureModelClient({
      modelId: "fixture:transcript",
      turns: [
        respondWithToolCalls("", [{ callId: "a", toolName: "list", input: {} }]),
        respondWithText("done"),
      ],
    });
    const harness = createHarness([], { model });

    await runAgentLoop("inspect the transcript", harness.deps);

    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.system).toBe("test system prompt");
    expect(model.requests[0]?.messages).toEqual([{ role: "user", text: "inspect the transcript" }]);
    expect(model.requests[1]?.messages).toHaveLength(3);
  });
});

/**
 * Found on a rapid-mlx backend whose streaming path buffers a partial tool call and never
 * flushes it: the turn arrives with usage reporting output tokens and with neither text nor a
 * tool call in it. Read as a completion, that is the runtime dropping output rendered as the
 * model declaring itself finished, and calibration then scores the silence against the model.
 */
describe("a turn that carries nothing", () => {
  it("stops as an empty response rather than as a completion", async () => {
    // Three, for the same reason the capped turn below takes three: an empty turn is sampled
    // again before it is believed, and the policy decides how many samples that is.
    const harness = createHarness([respondWithText(""), respondWithText(""), respondWithText("")]);
    const outcome = await runAgentLoop("do the thing", harness.deps);

    expect(outcome.stopReason).toBe("empty-response");
    expect(outcome.steps).toBe(1);
    expect(outcome.answeredSteps).toBe(0);
  });

  it("samples an empty turn again rather than ending the run on the runtime's silence", async () => {
    // Two campaign runs ended this way with their work half done: one dropped stream, read as
    // the loop's last word. A refused connection is retried; a stream that said nothing is
    // the same failure in a response's shape.
    const harness = createHarness([respondWithText(""), respondWithText("done")]);
    const outcome = await runAgentLoop("do the thing", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(outcome.completionClaim).toBe("done");
    expect(harness.events.filter((event) => event.type === "model-error")).toMatchObject([
      { willRetry: true, message: expect.stringContaining("neither text nor a tool call") },
    ]);
  });

  it("samples again when the stream ended mid-answer, rather than reading its text as the model finishing", async () => {
    // Launch 4 of the 2026-10-17 repair and detection runs: the server could not parse a tool
    // call the planner wrote ("qwen tool call parsing failed") and ended the stream with the
    // text so far, no tool call and no finish reason. Read as a completion, planning stopped
    // with nothing declared and the run went on without the checks it was asked to plan.
    const cut = respondWithText("The problem then is with `'LINE\\nFEED.png'.re");
    if (cut.kind !== "response") throw new Error("a response");
    // "other" is what the AI SDK's OpenAI-compatible adapter reports for a stream with no
    // finish chunk (its default before any arrives).
    const unfinished = { ...cut, response: { ...cut.response, finishReason: "other" } };
    const harness = createHarness([unfinished, respondWithText("done")]);
    const outcome = await runAgentLoop("do the thing", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(outcome.completionClaim).toBe("done");
    expect(harness.events.filter((event) => event.type === "model-error")).toMatchObject([
      { willRetry: true, message: expect.stringContaining("without a finish reason") },
    ]);

    // And where every sample ends that way, the run stops on the model failing, not as done.
    const always = createHarness([unfinished, unfinished, unfinished]);
    expect((await runAgentLoop("do the thing", always.deps)).stopReason).toBe("model-error");
  });

  it("says the cap was hit when that is what happened, not that the turn was empty", async () => {
    // A live run against a local reasoning model stopped here twice, at the same step both
    // times, reported as an empty response. It had spent all 8192 output tokens thinking and
    // been cut off, which is the one fact "empty-response" does not carry.
    // Three, because a spiral is retried before it is believed: the retry policy is what
    // decides how many samples of the same request it takes before the cap is the answer.
    const harness = createHarness([respondTruncated(), respondTruncated(), respondTruncated()], {
      budget: { ...generousBudget, maxTokens: 100_000 },
    });
    const outcome = await runAgentLoop("do the thing", harness.deps);

    expect(outcome.stopReason).toBe("output-cap");
    expect(outcome.answeredSteps).toBe(0);
  });

  it("samples again when a turn spirals, rather than ending the run on one of them", async () => {
    // What this costs when it is missing: two live runs died at the same step, on a model whose
    // every other step that run cost between 64 and 518 output tokens.
    const harness = createHarness([respondTruncated(), respondWithText("done")]);
    const outcome = await runAgentLoop("do the thing", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(outcome.completionClaim).toBe("done");
    expect(harness.events.filter((event) => event.type === "model-error")).toMatchObject([
      { willRetry: true, message: expect.stringContaining("without emitting text or a tool call") },
    ]);
  });

  it("claims nothing, because there is nothing there to claim", async () => {
    const harness = createHarness([respondWithText("   \n  ")]);
    const outcome = await runAgentLoop("do the thing", harness.deps);

    expect(outcome.completionClaim).toBe("");
    expect(harness.events.filter((event) => event.type === "claim")).toHaveLength(0);
  });

  it("still reads a real summary with no tool calls as the completion it is", async () => {
    const harness = createHarness([respondWithText("I changed greet.mjs and the suite passes.")]);
    const outcome = await runAgentLoop("do the thing", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(outcome.answeredSteps).toBe(1);
    expect(outcome.completionClaim).toMatch(/greet.mjs/);
  });

  it("counts a turn that carried only a tool call as answered", async () => {
    const harness = createHarness([
      respondWithToolCalls("", [{ callId: "c1", toolName: "read", input: { path: "a" } }]),
      respondWithText("done"),
    ]);
    const outcome = await runAgentLoop("do the thing", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(outcome.answeredSteps).toBe(2);
  });
});

/**
 * A live run: gemma4:31b behind Ollama answered `<channel|>` eight hundred times, then a
 * fragment of a plan, then the marker again until the 8192-token cap cut it off. No tool was
 * called. The loop read the cut-off text as the model's account of finishing, the gates ran
 * over an unchanged workspace, and the run ended "work accepted" with the file never written.
 * Two of five samples of the same request spiral the same way, so this is what a sample looks
 * like, not what the model looks like.
 */
describe("a turn cut off at the cap before it acted", () => {
  const cutOff = (text: string): FixtureTurn => ({
    kind: "response",
    response: {
      text,
      toolCalls: [],
      inputTokens: 2518,
      outputTokens: 8192,
      finishReason: "length",
      performance: unobservedPerformance,
      unsupportedFeatures: [],
    },
  });

  it("is sampled again rather than read as a completion, and its text is not the plan", async () => {
    const harness = createHarness(
      [
        cutOff(`${"<channel|>".repeat(40)} I will create user_profile.html.`),
        respondWithText("done"),
      ],
      { budget: { ...generousBudget, maxTokens: 100_000 } },
    );
    const outcome = await runAgentLoop("add the page", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(outcome.completionClaim).toBe("done");
    expect(outcome.plan).toBe("done");
    expect(harness.events.filter((event) => event.type === "model-error")).toMatchObject([
      { willRetry: true, message: expect.stringContaining("before it called a tool") },
    ]);
  });

  it("stops as output-cap and claims nothing when every sample is cut off", async () => {
    const harness = createHarness([cutOff("Plan: "), cutOff("Plan: "), cutOff("Plan: ")], {
      budget: { ...generousBudget, maxTokens: 100_000 },
    });
    const outcome = await runAgentLoop("add the page", harness.deps);

    expect(outcome.stopReason).toBe("output-cap");
    expect(outcome.completionClaim).toBe("");
    expect(harness.events.filter((event) => event.type === "claim")).toHaveLength(0);
  });

  it("cuts a stream off once it repeats one unit past the threshold, and samples again", async () => {
    // The six minutes the live run spent were the cap being reached at 22 tokens a second.
    let streamed = 0;
    const done = respondWithText("done");
    const spiralling: ModelClient = {
      modelId: "fixture:spiral",
      generate(request: ModelRequest): Promise<ModelResponse> {
        if (streamed > 0 && done.kind === "response") {
          return Promise.resolve(done.response);
        }
        return new Promise((_, reject) => {
          const feed = (): void => {
            if (request.abortSignal.aborted) {
              reject(new Error("This operation was aborted"));
              return;
            }
            streamed += 1;
            request.onText?.("<channel|>");
            setImmediate(feed);
          };
          feed();
        });
      },
    };
    const harness = createHarness([], { model: spiralling });
    const outcome = await runAgentLoop("add the page", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(streamed).toBe(degenerateRepeatThreshold);
    expect(harness.events.filter((event) => event.type === "model-error")).toMatchObject([
      {
        willRetry: true,
        message: expect.stringContaining(
          `repeated "<channel|>" ${degenerateRepeatThreshold} times in a row`,
        ),
      },
    ]);
  });
});

describe("composition budget regressions", () => {
  it("counts every truncated provider attempt", async () => {
    const harness = createHarness(
      [respondTruncated(), respondTruncated(), respondWithText("done")],
      { budget: { ...generousBudget, maxTokens: 100_000 } },
    );
    const outcome = await runAgentLoop("count attempts", harness.deps);
    expect(outcome.tokensUsed).toBeGreaterThan(16_384);
  });
  it("does not dispatch the second tool after cancellation during the first", async () => {
    const harness = createHarness([
      respondWithToolCalls("", [
        { callId: "first", toolName: "write", input: {} },
        { callId: "second", toolName: "write", input: {} },
      ]),
    ]);
    const invoker = createRecordingToolInvoker(() => {
      harness.controller.abort();
      return "done";
    });
    const outcome = await runAgentLoop("cancel batch", { ...harness.deps, toolInvoker: invoker });
    expect(invoker.invocations.map((call) => call.callId)).toEqual(["first"]);
    expect(outcome.stopReason).toBe("interrupted");
  });
  it("does not restart the wall budget on a retry", async () => {
    const harness = createHarness([], {
      budget: { ...generousBudget, maxWallTimeMs: 100 },
      retryPolicy: { attempts: 3, baseDelayMs: 0, maxJitterRatio: 0 },
    });
    let calls = 0;
    const fixture = createFixtureModelClient({
      modelId: "fixture",
      turns: [respondTruncated(), respondWithText("done")],
    });
    const model: ModelClient = {
      modelId: "fixture",
      async generate(request) {
        calls += 1;
        harness.clock.advance(60);
        return fixture.generate(request);
      },
    };
    const outcome = await runAgentLoop("bounded retries", { ...harness.deps, model });
    expect(outcome.stopReason).toBe("max-wall-time");
    expect(calls).toBe(2);
    expect(outcome.tokensUsed).toBeGreaterThan(8192);
  });
  it("does not retry rejected credentials", async () => {
    const denied = Object.assign(new Error("unauthorized"), { statusCode: 401 });
    const harness = createHarness([], {
      model: {
        modelId: "denied",
        generate: async () => {
          throw denied;
        },
      },
    });
    expect((await runAgentLoop("authenticate", harness.deps)).stopReason).toBe("model-error");
    expect(harness.clock.sleeps).toEqual([]);
  });
});

it("enforces its deadline even when a provider ignores cancellation", async () => {
  const harness = createHarness([]);
  let entered = false;
  const pending = runAgentLoop("work", {
    ...harness.deps,
    budget: { ...generousBudget, maxWallTimeMs: 100 },
    model: {
      modelId: "unresponsive",
      generate: () => {
        entered = true;
        return new Promise(() => {});
      },
    },
  });
  for (let turn = 0; !entered && turn < 20; turn += 1) await Promise.resolve();
  expect(entered).toBe(true);
  harness.clock.advance(100);
  expect((await pending).stopReason).toBe("max-wall-time");
  expect(harness.toolInvoker.invocations).toHaveLength(0);
});

describe("a loop that repeats itself", () => {
  const inspect = (callId: string) =>
    respondWithToolCalls("checking", [
      { callId, toolName: "shell", input: { command: "cat package.json" } },
    ]);
  /** The chokepoint's trailer differs per call; the tracker must see through it. */
  let record = 0;
  const unchanged = () =>
    `exit code: 0\nstdout:\n{"version":"1"}\n[evidence record sha256:${(++record).toString(16).padStart(64, "0")} kind tool-call:shell]`;

  it("tells the model once, then stops it, and both are on the event stream", async () => {
    const stalls: unknown[] = [];
    const invoker = createRecordingToolInvoker(unchanged);
    const harness = createHarness(
      Array.from({ length: 12 }, (_, index) => inspect(`c${index}`)),
      {
        toolInvoker: invoker,
        budget: { ...generousBudget, maxSteps: 20 },
        stall: { observe: async (event) => void stalls.push(event) },
      },
    );

    const outcome = await runAgentLoop("upgrade the dependency", harness.deps);

    expect(outcome.stopReason).toBe("stalled");
    // Four identical calls earn the notice; three more after it earn the stop. Nothing beyond
    // that is spent: the fixture had twelve turns and five were never asked for.
    expect(outcome.steps).toBe(7);
    expect(invoker.invocations).toHaveLength(7);
    const notice = outcome.messages.find(
      (message) => message.role === "user" && message.text.includes("repeated tool calls"),
    );
    expect(notice).toBeDefined();
    expect(outcome.messages.indexOf(notice as (typeof outcome.messages)[number])).toBe(1 + 4 * 2);
    expect(harness.events.filter((event) => event.type === "stall")).toEqual([
      {
        type: "stall",
        step: 4,
        toolName: "shell",
        repeats: 3,
        input: '{"command":"cat package.json"}',
        output: "exit code: 0",
        landed: false,
        intervention: "feedback",
      },
      {
        type: "stall",
        step: 7,
        toolName: "shell",
        repeats: 3,
        input: '{"command":"cat package.json"}',
        output: "exit code: 0",
        landed: false,
        intervention: "stop",
      },
    ]);
    expect(stalls).toHaveLength(2);
    expect(outcome.completionClaim).toBe("");
    // The notice names the call that was repeated and what it kept answering.
    expect((notice as { text: string }).text).toContain('shell {"command":"cat package.json"}');
  });

  it("lets a model that acts on the notice finish", async () => {
    const harness = createHarness(
      [
        inspect("a"),
        inspect("b"),
        inspect("c"),
        inspect("d"),
        respondWithToolCalls("acting on it", [
          { callId: "w", toolName: "write", input: { path: "package.json", content: "2" } },
        ]),
        respondWithText("done"),
      ],
      { toolInvoker: createRecordingToolInvoker(unchanged) },
    );
    const outcome = await runAgentLoop("upgrade the dependency", harness.deps);
    expect(outcome.stopReason).toBe("completed");
    expect(harness.events.filter((event) => event.type === "stall")).toHaveLength(1);
  });

  it("never interrupts a poll whose answer keeps changing, or a reread after an edit", async () => {
    let tick = 0;
    const harness = createHarness(
      [
        ...Array.from({ length: 6 }, (_, index) => inspect(`poll${index}`)),
        respondWithToolCalls("edit", [
          { callId: "w", toolName: "write", input: { path: "package.json", content: "2" } },
        ]),
        inspect("reread"),
        respondWithText("done"),
      ],
      {
        toolInvoker: createRecordingToolInvoker((invocation) =>
          invocation.toolName === "write" ? "written" : `exit code: 0\nstdout:\nline ${++tick}`,
        ),
        budget: { ...generousBudget, maxSteps: 20 },
      },
    );
    const outcome = await runAgentLoop("watch the build", harness.deps);
    expect(outcome.stopReason).toBe("completed");
    expect(harness.events.some((event) => event.type === "stall")).toBe(false);
  });

  it("answers a call repeated after an edit even when its answer is unchanged, and notices the one repeated with no edit between", async () => {
    const check = (callId: string) =>
      respondWithToolCalls("checking", [
        { callId, toolName: "shell", input: { command: "npm run build && node check.mjs" } },
      ]);
    const harness = createHarness(
      [
        check("before"),
        respondWithToolCalls("edit", [
          {
            callId: "w",
            toolName: "edit",
            input: { path: "src/rules.ts", find: "a", replace: "b" },
          },
        ]),
        check("after"),
        check("again"),
        respondWithText("done"),
      ],
      {
        toolInvoker: createRecordingToolInvoker((invocation) =>
          invocation.toolName === "edit" ? "replaced 1 occurrence(s)" : unchanged(),
        ),
        stall: { writers: ["edit", "write"] },
      },
    );
    const outcome = await runAgentLoop("fix the check", harness.deps);
    expect(outcome.stopReason).toBe("completed");
    const answers = outcome.messages
      .filter((message) => message.role === "tool")
      .map((message) => (message.role === "tool" ? (message.outcomes[0]?.output ?? "") : ""));
    expect(answers[2]).toContain("exit code: 0");
    expect(answers[2]).not.toContain("already answered");
    expect(answers[3]).toContain("[harness notice: already answered]");
    expect(answers[3]).toContain("No writing tool call has landed since");
    expect(harness.events.some((event) => event.type === "stall")).toBe(false);
  });

  it("tells a repeated successful write that it is repeated, without saying no writing call landed", async () => {
    // Two writing calls landed, the second a byte-for-byte repeat of the first with the same
    // answer. It is a repeat, and the notice in its answer's place may not deny what the loop
    // itself classed as writing.
    const write = (callId: string) =>
      respondWithToolCalls("writing", [
        { callId, toolName: "write", input: { path: "src/rules.ts", content: "a" } },
      ]);
    const harness = createHarness([write("first"), write("second"), respondWithText("done")], {
      toolInvoker: createRecordingToolInvoker(() => "wrote 1 byte to src/rules.ts"),
      stall: { writers: ["edit", "write"] },
    });
    const outcome = await runAgentLoop("fix the check", harness.deps);
    expect(outcome.stopReason).toBe("completed");
    const answers = outcome.messages
      .filter((message) => message.role === "tool")
      .map((message) => (message.role === "tool" ? (message.outcomes[0]?.output ?? "") : ""));
    expect(answers[0]).toContain("wrote 1 byte");
    expect(answers[1]).toContain("[harness notice: already answered]");
    expect(answers[1]).toContain("No other writing tool call has landed between the two");
    expect(answers[1]).not.toContain("No writing tool call has landed since");
  });

  it("answers a shell check repeated after an edit, with the shell named as a tool that may write", async () => {
    // The worker names the shell among the tools whose call may write. That classes the check,
    // not the state its answer concerns: run again after an edit landed, it is a new question
    // and is answered; run a third time with nothing else between, it is a repeat of a call that
    // landed, and the notice says no other writing call landed between the two.
    const check = (callId: string) =>
      respondWithToolCalls("checking", [
        { callId, toolName: "shell", input: { command: "node --check src/rules.ts" } },
      ]);
    const harness = createHarness(
      [
        check("before"),
        respondWithToolCalls("edit", [
          {
            callId: "w",
            toolName: "edit",
            input: { path: "src/rules.ts", find: "a", replace: "b" },
          },
        ]),
        check("after"),
        check("again"),
        respondWithText("done"),
      ],
      {
        toolInvoker: createRecordingToolInvoker((invocation) =>
          invocation.toolName === "edit" ? "replaced 1 occurrence(s)" : "exit code: 0",
        ),
        stall: { writers: ["edit", "write", "shell"] },
      },
    );
    const outcome = await runAgentLoop("fix the check", harness.deps);
    expect(outcome.stopReason).toBe("completed");
    const answers = outcome.messages
      .filter((message) => message.role === "tool")
      .map((message) => (message.role === "tool" ? (message.outcomes[0]?.output ?? "") : ""));
    expect(answers[2]).toBe("exit code: 0");
    expect(answers[3]).toContain("[harness notice: already answered]");
    expect(answers[3]).toContain("No other writing tool call has landed between the two");
    expect(harness.events.some((event) => event.type === "stall")).toBe(false);
  });

  it("grants no second notice to a run taken up again with the first in its history", async () => {
    const first = createHarness(
      Array.from({ length: 5 }, (_, index) => inspect(`c${index}`)),
      {
        toolInvoker: createRecordingToolInvoker(unchanged),
        budget: { ...generousBudget, maxSteps: 5 },
      },
    );
    const before = await runAgentLoop("upgrade the dependency", first.deps);
    expect(before.stopReason).toBe("max-steps");
    expect(before.messages.some((m) => m.role === "user" && m.text.includes("repeated"))).toBe(
      true,
    );

    const resumed = createHarness(
      Array.from({ length: 6 }, (_, index) => inspect(`r${index}`)),
      {
        toolInvoker: createRecordingToolInvoker(unchanged),
        budget: { ...generousBudget, maxSteps: 20 },
        history: before.messages,
      },
    );
    const after = await runAgentLoop("continue", resumed.deps);
    expect(after.stopReason).toBe("stalled");
    expect(after.steps).toBe(4);
    expect(resumed.events.filter((event) => event.type === "stall")).toEqual([
      expect.objectContaining({
        type: "stall",
        step: 4,
        toolName: "shell",
        repeats: 3,
        intervention: "stop",
      }),
    ]);
  });

  it("lets a cancellation outrank the stall", async () => {
    const harness = createHarness(
      Array.from({ length: 12 }, (_, index) => inspect(`c${index}`)),
      {
        toolInvoker: createRecordingToolInvoker(unchanged),
        budget: { ...generousBudget, maxSteps: 20 },
        stall: {
          observe: async (event) => {
            if (event.intervention === "stop") harness.controller.abort("stopped by hand");
          },
        },
      },
    );
    const outcome = await runAgentLoop("upgrade the dependency", harness.deps);
    // The stop is decided before the abort lands, and the loop reports the stall; the next
    // thing a cancelled loop would do is not done.
    expect(["stalled", "interrupted"]).toContain(outcome.stopReason);
    expect(outcome.steps).toBe(7);
  });

  it("can be switched off, which only a test should want", async () => {
    const harness = createHarness(
      Array.from({ length: 10 }, (_, index) => inspect(`c${index}`)),
      {
        toolInvoker: createRecordingToolInvoker(unchanged),
        budget: { ...generousBudget, maxSteps: 10 },
        stall: false,
      },
    );
    const outcome = await runAgentLoop("upgrade the dependency", harness.deps);
    expect(outcome.stopReason).toBe("max-steps");
    expect(outcome.steps).toBe(10);
  });
});

describe("a turn that spirals in its reasoning", () => {
  it("is cut off before the cap, as a spiral in the text is", async () => {
    let streamed = 0;
    const done = respondWithText("done");
    const spiralling: ModelClient = {
      modelId: "fixture:reasoning-spiral",
      generate(request: ModelRequest): Promise<ModelResponse> {
        if (streamed > 0 && done.kind === "response") {
          return Promise.resolve(done.response);
        }
        return new Promise((_, reject) => {
          const feed = (): void => {
            if (request.abortSignal.aborted) {
              reject(new Error("This operation was aborted"));
              return;
            }
            streamed += 1;
            request.onReasoning?.("Wait, but ");
            setImmediate(feed);
          };
          feed();
        });
      },
    };
    const harness = createHarness([], { model: spiralling });
    const outcome = await runAgentLoop("add the page", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(streamed).toBe(degenerateRepeatThreshold);
    expect(harness.events.filter((event) => event.type === "model-error")).toMatchObject([
      { willRetry: true, message: expect.stringContaining('repeated "Wait, but "') },
    ]);
  });
});

describe("a turn that spirals inside a tool call's arguments", () => {
  it("is cut off the same way as one that spirals in its text", async () => {
    // The live call streamed eight minutes of a shell argument nobody could read; the text
    // watcher saw nothing, because none of it was text.
    let streamed = 0;
    const done = respondWithText("done");
    const spiralling: ModelClient = {
      modelId: "fixture:argument-spiral",
      generate(request: ModelRequest): Promise<ModelResponse> {
        if (streamed > 0 && done.kind === "response") {
          return Promise.resolve(done.response);
        }
        return new Promise((_, reject) => {
          const feed = (): void => {
            if (request.abortSignal.aborted) {
              reject(new Error("This operation was aborted"));
              return;
            }
            streamed += 1;
            request.onToolInput?.('{"command":');
            setImmediate(feed);
          };
          feed();
        });
      },
    };
    const harness = createHarness([], { model: spiralling });
    const outcome = await runAgentLoop("add the page", harness.deps);

    expect(outcome.stopReason).toBe("completed");
    expect(streamed).toBe(degenerateRepeatThreshold);
    expect(harness.events.filter((event) => event.type === "model-error")).toMatchObject([
      {
        willRetry: true,
        message: expect.stringContaining(
          `repeated ${JSON.stringify('{"command":')} ${degenerateRepeatThreshold} times in a row`,
        ),
      },
    ]);
  });
});
