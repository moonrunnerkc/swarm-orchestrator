import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  type ModelClient,
  type ModelRequest,
  unobservedPerformance,
} from "../core/model-client.ts";
import { createTestClock } from "../core/test-doubles.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { controllerEvents } from "./controller-events.ts";
import { createRunContext } from "./run-context.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-context-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const response = {
  text: "done",
  toolCalls: [],
  inputTokens: 100,
  outputTokens: 20,
  finishReason: "stop",
  performance: unobservedPerformance,
  unsupportedFeatures: [],
};
const request: ModelRequest = {
  system: "bounded",
  messages: [],
  tools: [],
  maxOutputTokens: 100,
  abortSignal: new AbortController().signal,
};
async function fixture(maxTokens = 1000, modelConcurrency = 1) {
  const clock = createTestClock(1000);
  const evidence = await openEvidenceSession({ root, sessionId: "context", clock });
  const cancellation = new AbortController();
  const options = {
    evidence,
    clock,
    runId: "run",
    maxTokens,
    maxWallMs: 1000,
    modelConcurrency,
    testConcurrency: 1,
    signal: cancellation.signal,
  };
  return { ...options, cancellation, context: await createRunContext(options), options };
}

it("reserves concurrent input and output before dispatch and settles measured usage", async () => {
  const { context, evidence } = await fixture(2000, 2);
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const client: ModelClient = {
    modelId: "fixture",
    generate: async () => {
      calls++;
      await pending;
      return response;
    },
  };
  const first = context.model("implementation", client).generate(request);
  const second = context.model("diagnosis", client).generate(request);
  await new Promise((resolve) => setImmediate(resolve));
  expect(context.accounting().reserved).toBeGreaterThan(800);
  expect(context.accounting().spent).toBe(0);
  release();
  await Promise.all([first, second]);
  expect(calls).toBe(2);
  expect(context.accounting()).toEqual({
    spent: 240,
    reserved: 0,
    unknownCalls: 0,
    remaining: 1760,
  });
  expect(
    controllerEvents(evidence).filter((event) => event.kind === "usage-reserved"),
  ).toHaveLength(2);
  context.dispose();
});

it("refuses dispatch when a shared reservation cannot cover another call", async () => {
  const { context } = await fixture(500, 2);
  let calls = 0;
  const client: ModelClient = {
    modelId: "fixture",
    generate: async () => {
      calls++;
      return response;
    },
  };
  const outcomes = await Promise.allSettled([
    context.model("planning", client).generate(request),
    context.model("worker", client).generate(request),
  ]);
  expect(outcomes.some((outcome) => outcome.status === "rejected")).toBe(true);
  expect(calls).toBeLessThanOrEqual(1);
  expect(context.signal.aborted).toBe(true);
  context.dispose();
});

it.each(["failure", "unknown"])(
  "retains %s usage and refuses a fresh budget on resume",
  async (kind) => {
    const { context, options } = await fixture();
    const call = context
      .model("repair", {
        modelId: "fixture",
        generate: async () => {
          if (kind === "failure") throw new Error("connection lost");
          return { ...response, usageStatus: "unknown" };
        },
      })
      .generate(request);
    if (kind === "failure") await expect(call).rejects.toThrow("connection lost");
    else await call;
    expect(context.accounting().unknownCalls).toBe(1);
    expect(context.accounting().reserved).toBeGreaterThan(0);
    expect(context.signal.aborted).toBe(true);
    context.dispose();
    await expect(createRunContext(options)).rejects.toThrow("unresolved provider usage");
  },
);

it("cancels active and queued calls while retaining ambiguous active usage", async () => {
  const { context, cancellation } = await fixture();
  let calls = 0;
  const client: ModelClient = {
    modelId: "fixture",
    generate: async () => {
      calls++;
      return new Promise(() => {});
    },
  };
  const active = context.model("planning", client).generate(request);
  const queued = context.model("worker", client).generate(request);
  await new Promise((resolve) => setImmediate(resolve));
  cancellation.abort(new Error("user stopped"));
  expect(
    (await Promise.allSettled([active, queued])).every((outcome) => outcome.status === "rejected"),
  ).toBe(true);
  expect(calls).toBe(1);
  expect(context.accounting().unknownCalls).toBe(1);
  context.dispose();
});

it("resumes with settled spending and the original wall deadline", async () => {
  const { context, options, clock } = await fixture();
  await context
    .model("planning", { modelId: "fixture", generate: async () => response })
    .generate(request);
  context.dispose();
  clock.advance(400);
  const resumed = await createRunContext({ ...options, maxWallMs: 9000 });
  expect(resumed.accounting().remaining).toBe(880);
  expect(resumed.remainingWallMs()).toBe(600);
  clock.advance(600);
  await Promise.resolve();
  expect(resumed.signal.aborted).toBe(true);
  resumed.dispose();
});
