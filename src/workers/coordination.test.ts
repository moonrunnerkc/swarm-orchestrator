import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { parseTaskContract } from "../evidence/task-contract.ts";
import { coordinationEvents, createCoordinationTools } from "./coordination.ts";
import { type ControllerGraph, initialControllerGraph } from "./graph-revision.ts";
import type { TrailPeer } from "./trail.ts";

let root = "";
const clock = createTestClock();
let peers: TrailPeer[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "coordination-"));
  peers = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function worker(workerId: string, taskId: string, board?: ControllerGraph) {
  const evidence = await openEvidenceSession({ root, sessionId: workerId, clock });
  peers.push({ workerId, taskId, chain: evidence });
  const tools = createCoordinationTools({
    workerId,
    taskId,
    baseCommit: "base",
    graphRevision: "revision",
    evidence,
    peers: () => peers,
    board: () => board ?? null,
  });
  const publish = tools.find((tool) => tool.name === "coordinate");
  const read = tools.find((tool) => tool.name === "read_coordination");
  if (publish === undefined || read === undefined)
    throw new Error("coordination definitions absent");
  return { evidence, publish, read };
}
it("serializes every offered schema through the real model transport boundary", async () => {
  const { publish, read } = await worker("worker-a", "a");
  expect(() => publish.inputSchema.toJSONSchema()).not.toThrow();
  expect(() => read.inputSchema.toJSONSchema()).not.toThrow();
});
it("shares bounded relevant deltas while hiding competing attempts at the same task", async () => {
  const source = await worker("worker-a", "a");
  const target = await worker("worker-b", "b");
  const alternative = await worker("worker-b-alt", "b");
  await source.publish.execute({
    kind: "interface-proposal",
    targets: ["b"],
    summary: "new call shape proposed",
    paths: ["api.ts"],
  });
  await alternative.publish.execute({
    kind: "interface-proposal",
    targets: ["b"],
    summary: "alternative solution must remain hidden",
    paths: ["api.ts"],
  });
  const first = await target.read.execute({});
  expect(JSON.parse(first.text).observations).toHaveLength(1);
  expect(first.text).toContain("new call shape proposed");
  expect(first.text).not.toContain("alternative solution");
  expect(JSON.parse((await target.read.execute({})).text).observations).toEqual([]);
});
it("routes original graph task names without exposing competing attempts", async () => {
  const board = initialControllerGraph(
    [
      {
        id: "task-2",
        dependsOn: [],
        obligations: ["task-2"],
        contract: parseTaskContract({
          version: 2,
          taskId: "z-beta",
          objective: "provide beta",
          dependsOn: [],
          allowedPaths: ["beta.js"],
          immutablePaths: [],
          allowedTools: ["read", "write"],
          network: "unrestricted",
          execution: "restricted",
          requiredChecks: ["tests"],
          budget: { maxSteps: 8, maxWallMs: 10000, maxTokens: 10000 },
          riskTier: "medium",
          scopeAuthority: "controller",
        }),
      },
    ],
    [],
  );
  const source = await worker("worker-1", "task-1");
  const target = await worker("worker-2", "task-2", board);
  const alternative = await worker("worker-2-alt", "task-2", board);
  await source.publish.execute({
    kind: "dependency-request",
    prerequisite: "z-beta",
    reason: "missing",
  });
  await source.publish.execute({
    kind: "interface-proposal",
    targets: ["z-beta"],
    paths: ["beta.js"],
    summary: "proposed export",
  });
  await alternative.publish.execute({
    kind: "interface-proposal",
    targets: ["z-beta"],
    paths: ["beta.js"],
    summary: "private alternative",
  });
  const observed = JSON.parse((await target.read.execute({})).text);
  expect(observed.observations).toHaveLength(2);
  expect(JSON.stringify(observed)).not.toContain("private alternative");
  expect(JSON.parse((await target.read.execute({})).text).observations).toEqual([]);
});
it("retains injected sender identity, revision and model provenance without a success verdict", async () => {
  const { evidence, publish } = await worker("worker-a", "a");
  await publish.execute({
    kind: "dependency-request",
    prerequisite: "b",
    reason: "missing interface",
  });
  const written = evidence.records().find((record) => record.type === "coordination-event");
  expect(written).toMatchObject({ actor: "model", provenance: ["model"] });
  expect(evidence.payloads().get(written?.payloadDigest ?? "")).toMatchObject({
    workerId: "worker-a",
    taskId: "a",
    graphRevision: "revision",
    baseCommit: "base",
  });
  expect(() =>
    publish.execute({
      kind: "dependency-request",
      prerequisite: "b",
      reason: "missing interface",
      workerId: "someone-else",
    }),
  ).toThrow();
  expect(() =>
    coordinationEvents({ workerId: "someone-else", taskId: "a", chain: evidence }),
  ).toThrow("sender");
});
it("requires harness failure evidence and refuses missing or model-authored references", async () => {
  const { evidence, publish } = await worker("worker-a", "a");
  async function failure(chain: EvidenceRecorder, actor: string) {
    return (
      await chain.record({
        type: "gate-run",
        actor,
        provenance: [actor === "harness" ? "tool-output" : "model"],
        payload: { gateId: actor, status: "failed" },
      })
    ).record.payloadDigest;
  }
  const claimed = await failure(evidence, "model");
  await expect(
    publish.execute({
      kind: "observed-failure",
      targets: ["b"],
      evidenceDigest: claimed,
      summary: "claimed failure",
    }),
  ).rejects.toThrow("harness-observed failure");
  const captured = await failure(evidence, "harness");
  await expect(
    publish.execute({
      kind: "observed-failure",
      targets: ["b"],
      evidenceDigest: captured,
      summary: "captured failure",
    }),
  ).resolves.toMatchObject({ facts: { proposalRecorded: true } });
});
it("caps event size and count and never returns a full peer transcript", async () => {
  const { publish } = await worker("worker-a", "a");
  expect(() =>
    publish.execute({ kind: "dependency-request", prerequisite: "b", reason: "x".repeat(2049) }),
  ).toThrow();
  for (let index = 0; index < 32; index++)
    await publish.execute({
      kind: "dependency-request",
      prerequisite: "b",
      reason: `request ${index}`,
    });
  await expect(
    publish.execute({ kind: "dependency-request", prerequisite: "b", reason: "one too many" }),
  ).rejects.toThrow("limit reached");
});
