import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { asJsonValue } from "../evidence/canonical-json.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { recordControllerEvent } from "./controller-events.ts";
import { projectControllerView } from "./controller-view.ts";
import { assessController } from "./goal-outcome.ts";

let directory: string;
let evidence: EvidenceRecorder;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "controller-view-"));
  evidence = await openEvidenceSession({
    root: directory,
    sessionId: "view",
    clock: createTestClock(),
  });
  await recordControllerEvent(evidence, {
    kind: "run-started",
    version: 1,
    runId: "view",
    startedAt: 0,
    deadlineAt: 1000,
    maxTokens: 1000,
    modelConcurrency: 1,
    testConcurrency: 1,
  });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("keeps unknown provider usage reserved and refuses duplicate settlements", async () => {
  await recordControllerEvent(evidence, {
    kind: "usage-reserved",
    id: "call",
    activity: "planning",
    inputAllowance: 100,
    outputAllowance: 200,
    estimator: "utf8-bytes-plus-framing",
  });
  const unknown = {
    kind: "usage-settled" as const,
    id: "call",
    status: "unknown" as const,
    inputTokens: null,
    outputTokens: null,
    detail: "interrupted",
  };
  await recordControllerEvent(evidence, unknown);
  expect(projectControllerView(evidence).usage).toEqual({
    spent: 0,
    reserved: 300,
    unknownCalls: 1,
    remaining: 700,
  });
  await recordControllerEvent(evidence, unknown);
  expect(() => projectControllerView(evidence)).toThrow("duplicate displayed settlement");
});
it("never displays a model-authored verdict", async () => {
  await evidence.record({
    type: "controller-assessment",
    actor: "model",
    provenance: ["model"],
    payload: { status: "accepted" },
  });
  expect(() => projectControllerView(evidence)).toThrow("model cannot author");
});
it("withdraws an old assessment when subsequent verification starts", async () => {
  const outcome = await assessController({
    evidence,
    taskIds: [],
    workers: [],
    landings: [],
    tree: "tree",
    goal: null,
    verification: null,
    cancelled: false,
    usage: { spent: 0, reserved: 0, unknownCalls: 0, remaining: 1000 },
  });
  expect(projectControllerView(evidence).outcome).toEqual(outcome);
  await evidence.record({
    type: "goal-check",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({ stage: "rerun" }),
  });
  expect(projectControllerView(evidence)).toMatchObject({ outcome: null, record: null });
});
