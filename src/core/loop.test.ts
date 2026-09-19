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
  });

  it("reports no unknown usage where every call reported", async () => {
    const harness = createHarness([respondWithText("done", { input: 5, output: 5 })]);
    const outcome = await runAgentLoop("one call", harness.deps);
    expect(outcome.callsWithUnknownUsage).toBe(0);
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
