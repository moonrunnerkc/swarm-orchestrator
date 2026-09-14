import { expect, it } from "vitest";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import {
  assertObservation,
  inspectArmEvidence,
  summarizeResources,
  summarizeSlots,
} from "./pilot-report.mjs";

const protocol = { arms: [{ id: "single" }, { id: "adaptive" }] };
const schedule = [
  { executionId: "one", caseId: "goal", armId: "single", seed: 0 },
  { executionId: "two", caseId: "goal", armId: "adaptive", seed: 0 },
];
const outcome = {
  certified: false,
  heldBackAccepted: null,
  status: "infrastructure-failure",
  latencyMs: 86_400_000,
  costUsd: null,
  goal: {
    inputTokens: 100,
    outputTokens: 20,
    unknownCalls: 0,
    reservedTokens: 0,
    termination: "crashed",
    detail: "interrupted test",
    humanInterventions: 1,
    humanRepairMinutes: null,
  },
};

it("checks ablations against recorded worker tool exposure and graph revisions", () => {
  const entry = (type, payloadDigest, payload) => ({ record: { type, payloadDigest }, payload });
  const sessions = [
    {
      sessionId: "worker-1",
      entries: [
        entry("transcript-component", "tools", { kind: "tools", value: [{ name: "read" }] }),
        entry("model-call-started", "started", {
          prompt: { transcriptVersion: 2, tools: "tools" },
        }),
      ],
    },
  ];
  expect(inspectArmEvidence("no-peer", sessions, {})).toMatchObject({
    workerPrompts: 1,
    peerTools: [],
    configurationObserved: false,
  });
  sessions[0].entries[0].payload.value.push({ name: "read_coordination" });
  expect(() => inspectArmEvidence("no-peer", sessions, {})).toThrow(/disabled worker/);
  expect(inspectArmEvidence("adaptive", sessions, {}).peerTools).toEqual(["read_coordination"]);
  sessions[0].entries.push(entry("controller-graph", "revision", { parent: "earlier" }));
  expect(() => inspectArmEvidence("no-adaptation", sessions, {})).toThrow(/adaptation disabled/);
});

it("keeps offline reconciliation time out of runtime totals without replacing the original outcome", () => {
  const report = summarizeSlots(protocol, schedule, new Map([["one", outcome]]), [
    { executionId: "one", executionWallMs: null, reason: "execution end was not observed" },
  ]);
  expect(report.slots[0].outcome.latencyMs).toBe(86_400_000);
  expect(report.slots[0].executionWallMs).toBeNull();
  expect(report.arms[0]).toMatchObject({
    settled: 1,
    complete: 0,
    executionWallMs: null,
    knownExecutionWallMs: 0,
    unknownExecutionTimes: 1,
    unknownJudgments: 1,
    recordedHumanInterventions: 1,
    recordedHumanRepairMinutes: null,
  });
  expect(report.arms[1]).toMatchObject({
    scheduled: 1,
    settled: 0,
    inputTokens: null,
    unknownJudgments: 1,
  });
});

it("distinguishes witnessed incorrect acceptance from unknown judgments and preserves budget failures", () => {
  const report = summarizeSlots(
    protocol,
    schedule,
    new Map([
      [
        "one",
        {
          ...outcome,
          certified: true,
          heldBackAccepted: false,
          status: "completed",
          latencyMs: 100,
        },
      ],
      [
        "two",
        {
          ...outcome,
          goal: {
            ...outcome.goal,
            detail: "shared token budget cannot reserve the input and output allowance",
          },
        },
      ],
    ]),
  );
  expect(report.arms[0]).toMatchObject({
    observedIncorrectAcceptance: 1,
    unknownJudgments: 0,
    complete: 0,
    executionWallMs: 100,
  });
  expect(report.arms[1]).toMatchObject({
    observedIncorrectAcceptance: 0,
    unknownJudgments: 1,
    budgetExhaustions: 1,
  });
  expect(report.slots[1].outcome.status).toBe("infrastructure-failure");
});

it("refuses ambiguous or unscheduled execution-time amendments", () => {
  const amendment = { executionId: "one", executionWallMs: null, reason: "unknown" };
  expect(() => summarizeSlots(protocol, schedule, new Map(), [amendment, amendment])).toThrow(
    /duplicate/,
  );
  expect(() =>
    summarizeSlots(protocol, schedule, new Map(), [{ ...amendment, executionId: "missing" }]),
  ).toThrow(/outside/);
});

it("binds the settled outcome to both the raw observation and exact manifest bytes", () => {
  const manifest = Buffer.from('{"version":1}');
  const settled = {
    executionId: "one",
    certified: false,
    heldBackAccepted: false,
    status: "completed",
    latencyMs: 100,
    costUsd: null,
    cleanup: "confirmed",
    evidenceDigest: digestOfBytes(manifest),
  };
  const raw = { outcome: settled, integrity: 1 };
  expect(assertObservation(settled, raw, manifest)).toBe(1);
  expect(assertObservation({ ...settled, latencyMs: 165 }, raw, manifest)).toBe(1);
  expect(() => assertObservation({ ...settled, latencyMs: 99 }, raw, manifest)).toThrow(/omits/);
  expect(
    assertObservation(
      { ...settled, status: "infrastructure-failure", cleanup: "failed" },
      raw,
      manifest,
      false,
    ),
  ).toBe(1);
  expect(() => assertObservation(settled, raw, Buffer.from("changed"))).toThrow(/changed/);
  expect(() =>
    assertObservation(settled, { ...raw, outcome: { ...settled, certified: true } }, manifest),
  ).toThrow(/disagrees/);
  expect(() => assertObservation(settled, raw, null)).toThrow(/missing/);
});

it("measures occupied intervals without adding overlap or charging unknown responses as free tokens", () => {
  const call = (timestamp, duration, usageStatus) => ({
    record: { type: "model-call", timestamp },
    payload: {
      inputTokens: 50,
      outputTokens: 10,
      usageStatus,
      performance: { responseTimeMs: duration, firstTokenMs: 3 },
      providerAttempts: [{ statusCode: 429 }],
    },
  });
  const report = summarizeResources([
    [call(20, 20, "reported")],
    [
      call(30, 20, "unknown"),
      {
        record: { type: "gate-run", timestamp: 40 },
        payload: { command: "node --test", durationMs: 10 },
      },
    ],
  ]);
  expect(report.modelCalls).toEqual({ intervals: 2, maximum: 2, unionMs: 30 });
  expect(report.commandGates).toEqual({ intervals: 1, maximum: 1, unionMs: 10 });
  expect(report).toMatchObject({
    reportedInputTokens: 50,
    reportedOutputTokens: 10,
    unknownModelCalls: 1,
    observedRateLimitResponses: 2,
    otherProviderTokenCategories: null,
  });
});
