import { describe, expect, it } from "vitest";
import {
  createFixtureModelClient,
  type FixtureTurn,
  failWith,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { type AgentLoopDependencies, runAgentLoop } from "./loop.ts";
import type { LoopEvent } from "./loop-events.ts";
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
    const harness = createHarness([respondWithText("")]);
    const outcome = await runAgentLoop("do the thing", harness.deps);

    expect(outcome.stopReason).toBe("empty-response");
    expect(outcome.steps).toBe(1);
    expect(outcome.answeredSteps).toBe(0);
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
