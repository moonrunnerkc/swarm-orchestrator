import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { asJsonValue, digestOfJson } from "../evidence/canonical-json.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { parseTaskContract } from "../evidence/task-contract.ts";
import { readControllerHistory } from "../evidence/verifier/controller.mjs";
import { emptyMeasureSnapshot } from "../gates/measure-snapshot.ts";
import { applyControllerRevision } from "./controller-revisions.ts";
import {
  appendControllerRecord,
  candidateIsCurrent,
  recordTransition,
  replayController,
} from "./controller-state.ts";
import { initialControllerGraph, recordControllerGraph } from "./graph-revision.ts";

let root = "";
let evidence: EvidenceRecorder;
const clock = createTestClock();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "controller-state-"));
  evidence = await openEvidenceSession({ root, sessionId: "controller", clock });
  await recordControllerGraph(
    evidence,
    initialControllerGraph(
      ["a", "b", "c"].map((id) => ({
        id,
        obligations: [id],
        dependsOn: [],
        contract: parseTaskContract({
          version: 2,
          taskId: id,
          objective: `change ${id}`,
          dependsOn: [],
          allowedPaths: [`${id}.js`],
          immutablePaths: ["acceptance.js"],
          allowedTools: ["read", "write"],
          network: "unrestricted",
          execution: "restricted",
          requiredChecks: ["tests"],
          budget: { maxSteps: 8, maxWallMs: 10000, maxTokens: 10000 },
          riskTier: "medium",
          scopeAuthority: "controller",
        }),
      })),
      ["whole-goal"],
    ),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function dispatch(taskId = "a", workerId = `${taskId}-1`) {
  const graphRevision = replayController(evidence).graph?.revision ?? "";
  const intent = {
    kind: "dispatch-intent" as const,
    taskId,
    workerId,
    sessionId: workerId,
    path: join(root, workerId),
    branch: `swarm/run/${workerId}`,
    baseCommit: "base",
    graphRevision,
    attemptIndex: 0,
  };
  await recordTransition(evidence, intent);
  return intent;
}
async function candidate(taskId = "a") {
  const intent = await dispatch(taskId);
  const snapshot = {
    workerId: intent.workerId,
    taskId,
    attemptIndex: 0,
    task: `change ${taskId}`,
    branch: intent.branch,
    baseCommit: intent.baseCommit,
    graphRevision: intent.graphRevision,
    green: true,
    commit: `${taskId}-commit`,
    declaredFiles: [`${taskId}.js`],
    detail: "checks passed",
    measures: emptyMeasureSnapshot,
    erosions: 0,
    changedFiles: 1,
    addedLines: 1,
    sessionId: intent.sessionId,
    chainHead: "chain",
  };
  await appendControllerRecord(evidence, "controller-candidate", asJsonValue(snapshot));
  return snapshot;
}
async function integrate(taskId = "a") {
  const snapshot = await candidate(taskId);
  await recordTransition(evidence, {
    kind: "integration-intent",
    effectId: `${taskId}-landing`,
    taskId,
    workerId: snapshot.workerId,
    baseCommit: "base",
    graphRevision: snapshot.graphRevision,
    candidateCommit: snapshot.commit,
    branch: snapshot.branch,
  });
  const captured = await evidence.record({
    type: "merge-attempt",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { workerId: snapshot.workerId, landed: true, commit: "integrated" },
  });
  await recordTransition(evidence, {
    kind: "integration-completed",
    effectId: `${taskId}-landing`,
    landed: true,
    commit: "integrated",
    observation: captured.record.payloadDigest,
  });
}

it("reopens exactly the recorded accepted board without another landing", async () => {
  await integrate();
  const reopened = await openEvidenceSession({ root, sessionId: "controller", clock });
  const board = replayController(reopened);
  expect(board.states.get("a")).toBe("accepted");
  expect(board.head).toBe("integrated");
  expect(board.completedIntegrations.size).toBe(1);
  expect(reopened.head()).toEqual(evidence.head());
});
it("keeps dispatch and candidate crash windows distinguishable", async () => {
  await dispatch("a");
  await candidate("b");
  const board = replayController(evidence);
  expect(board.states.get("a")).toBe("running");
  expect(board.states.get("b")).toBe("candidate");
  expect(board.dispatches.size).toBe(2);
  expect(board.candidates.size).toBe(1);
  expect(board.accepted.size).toBe(0);
});
it("rejects a duplicate accepted dispatch before it is appended", async () => {
  await integrate();
  const count = evidence.head().recordCount;
  await expect(dispatch("a", "a-2")).rejects.toThrow(
    "duplicated, stale or lacks accepted prerequisites",
  );
  expect(evidence.head().recordCount).toBe(count);
});
it("invalidates changed dependencies and refuses the late candidate", async () => {
  const snapshot = await candidate("a");
  const graph = await applyControllerRevision(
    evidence,
    {
      operation: { kind: "add-prerequisite", taskId: "a", prerequisite: "b" },
      reason: "interface prerequisite discovered",
    },
    "model",
  );
  expect(candidateIsCurrent(replayController(evidence), snapshot)).toBe(false);
  await expect(
    recordTransition(evidence, {
      kind: "integration-intent",
      effectId: "late",
      taskId: "a",
      workerId: snapshot.workerId,
      baseCommit: "base",
      graphRevision: graph.revision,
      candidateCommit: snapshot.commit,
      branch: snapshot.branch,
    }),
  ).rejects.toThrow("current eligible candidate");
});
it("keeps an unrelated candidate eligible after a revision, subject to current-tree checks", async () => {
  const snapshot = await candidate("c");
  await applyControllerRevision(
    evidence,
    {
      operation: { kind: "add-prerequisite", taskId: "a", prerequisite: "b" },
      reason: "interface prerequisite discovered",
    },
    "harness",
  );
  expect(candidateIsCurrent(replayController(evidence), snapshot)).toBe(true);
});
it("invalidates prior acceptance when its dependency changes without erasing the landing", async () => {
  await integrate();
  await applyControllerRevision(
    evidence,
    {
      operation: { kind: "add-prerequisite", taskId: "a", prerequisite: "b" },
      reason: "missing requirement dependency",
    },
    "harness",
  );
  const board = replayController(evidence);
  expect(board.accepted.has("a")).toBe(false);
  expect(board.states.get("a")).toBe("pending");
  expect(board.completedIntegrations.size).toBe(1);
  expect(board.head).toBe("integrated");
});
it("requires a captured merge observation before accepting an integration effect", async () => {
  const snapshot = await candidate();
  await recordTransition(evidence, {
    kind: "integration-intent",
    effectId: "a-landing",
    taskId: "a",
    workerId: snapshot.workerId,
    baseCommit: "base",
    graphRevision: snapshot.graphRevision,
    candidateCommit: snapshot.commit,
    branch: snapshot.branch,
  });
  await expect(
    recordTransition(evidence, {
      kind: "integration-completed",
      effectId: "a-landing",
      landed: true,
      commit: "integrated",
      observation: "missing",
    }),
  ).rejects.toThrow();
  expect(replayController(evidence).accepted.size).toBe(0);
});
it("refuses cleanup without prior intent and verifies the resource identity", async () => {
  const intent = await dispatch();
  await expect(
    recordTransition(evidence, {
      kind: "cleanup-completed",
      workerId: intent.workerId,
      path: intent.path,
      branch: intent.branch,
    }),
  ).rejects.toThrow("prior intent");
  expect(replayController(evidence).cleaned.size).toBe(0);
});
it("does not treat a model-authored transition as controller authority", async () => {
  await evidence.record({
    type: "controller-transition",
    actor: "model",
    provenance: ["model"],
    payload: { kind: "task-blocked", taskId: "a", reason: "pretend" },
  });
  expect(() => replayController(evidence)).toThrow("controller authority");
});

it("independently re-derives acceptance and invalidation from the exported event vocabulary", async () => {
  await integrate();
  expect(readControllerHistory(evidence.records(), evidence.payloads())).toMatchObject({
    head: "integrated",
    problems: [],
  });
  expect(
    readControllerHistory(evidence.records(), evidence.payloads()).accepted.get("a"),
  ).toMatchObject({ workerId: "a-1" });
  await applyControllerRevision(
    evidence,
    {
      operation: { kind: "add-prerequisite", taskId: "a", prerequisite: "b" },
      reason: "observed dependency",
    },
    "harness",
  );
  const reading = readControllerHistory(evidence.records(), evidence.payloads());
  expect(reading.problems).toEqual([]);
  expect(reading.accepted.has("a")).toBe(false);
  expect(reading.states.get("a")).toBe("pending");
});
it("the independent reader rejects a rehashed revision that erases a pinned obligation", async () => {
  const revision = await applyControllerRevision(
    evidence,
    {
      operation: { kind: "add-prerequisite", taskId: "a", prerequisite: "b" },
      reason: "observed dependency",
    },
    "harness",
  );
  const { revision: priorDigest, ...fields } = revision;
  const changed = {
    ...fields,
    parent: priorDigest,
    ordinal: revision.ordinal + 1,
    requirements: [],
  };
  await evidence.record({
    type: "controller-graph",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({ ...changed, revision: digestOfJson(asJsonValue(changed)) }),
  });
  expect(
    readControllerHistory(evidence.records(), evidence.payloads()).problems.join("\n"),
  ).toContain("erased obligations");
});
