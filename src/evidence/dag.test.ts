import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import type { JsonValue } from "./canonical-json.ts";
import { buildEvidenceDag } from "./dag.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./session.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-dag-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const absentDigest = `sha256:${"7".repeat(64)}`;

/**
 * One real failing test run, then four claims about it: one honest, and one of each way a
 * claim can fail to resolve. The failing run is the interesting case, because the record
 * it cites is genuine.
 */
async function sessionWithClaims(): Promise<{ evidence: EvidenceRecorder; runDigest: string }> {
  const evidence = await openEvidenceSession({
    root,
    sessionId: "dag-session",
    clock: createTestClock(1_700_000_000_000),
  });

  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: { task: "make the suite green" },
  });

  const { record } = await evidence.record({
    type: "tool-call",
    actor: "harness",
    provenance: ["model"],
    payload: {
      toolName: "shell",
      decision: "allowed",
      detail: "2048 bytes returned",
      facts: { command: "npm test", exitCode: 1, stdoutBytes: 2048 },
      tests: { collected: 47, failed: 4 },
    },
  });

  await evidence.submitClaim(
    {
      predicate: "tests.collected == 47",
      record: record.payloadDigest,
      recordKind: "tool-call:shell",
      narrative: "",
    },
    "test-model",
  );
  await evidence.submitClaim(
    {
      predicate: "tests.failed == 0",
      record: null,
      recordKind: "tool-call:shell",
      narrative: "everything passes now",
    },
    "test-model",
  );
  await evidence.submitClaim(
    {
      predicate: "tests.failed == 0 && facts.exitCode == 0",
      record: record.payloadDigest,
      recordKind: "tool-call:shell",
      narrative: "the suite is green",
    },
    "test-model",
  );
  await evidence.submitClaim(
    {
      predicate: "tests.failed == 0",
      record: absentDigest,
      recordKind: "tool-call:shell",
      narrative: "",
    },
    "test-model",
  );

  return { evidence, runDigest: record.payloadDigest };
}

describe("evidence DAG", () => {
  it("separates claims from the records they cite", async () => {
    const { evidence } = await sessionWithClaims();

    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());

    expect(dag.claims).toHaveLength(4);
    expect(dag.evidence.map((node) => node.type)).toEqual(["session-started", "tool-call"]);
  });

  it("renders exactly one claim green, and the harness computed it", async () => {
    const { evidence } = await sessionWithClaims();

    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());

    expect(dag.verifiedCount).toBe(1);
    expect(dag.unverifiedCount).toBe(3);
    expect(dag.claims.map((claim) => claim.evaluation.reason)).toEqual([
      null,
      "no-evidence-edge",
      "predicate-false",
      "record-not-found",
    ]);
  });

  it("keeps a claim's narrative out of its verdict", async () => {
    const { evidence } = await sessionWithClaims();

    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    const insistent = dag.claims.find((claim) => claim.narrative === "the suite is green");

    expect(insistent?.evaluation.verdict).toBe("unverified");
  });

  it("marks the edge to a record that is in no chain as unresolved", async () => {
    const { evidence, runDigest } = await sessionWithClaims();

    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());

    expect(dag.edges).toHaveLength(3);
    expect(dag.edges.filter((edge) => edge.resolved).map((edge) => edge.record)).toEqual([
      runDigest,
      runDigest,
    ]);
    expect(dag.edges.find((edge) => !edge.resolved)?.record).toBe(absentDigest);
  });

  it("leaves a claim unverified when its own payload blob is gone", async () => {
    const { evidence } = await sessionWithClaims();
    const withoutPayloads = buildEvidenceDag(evidence.records(), new Map());

    expect(withoutPayloads.verifiedCount).toBe(0);
    expect(withoutPayloads.claims.every((claim) => claim.evaluation.verdict === "unverified")).toBe(
      true,
    );
  });
});

describe("the one-line summary of a worker record", () => {
  async function summaryOf(
    type: "worker-finished" | "merge-attempt" | "attempt-selection",
    payload: JsonValue,
  ) {
    const evidence = await openEvidenceSession({
      root,
      sessionId: `summary-${type}`,
      clock: createTestClock(1_700_000_000_000),
    });
    await evidence.record({ type, actor: "harness", provenance: ["tool-output"], payload });
    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    return dag.evidence.at(-1)?.summary ?? "";
  }

  it("says how a worker finished, rather than trailing off after the colon", async () => {
    const summary = await summaryOf("worker-finished", {
      workerId: "worker-1",
      green: true,
      detail: "gates green after 3 step(s)",
    });

    expect(summary).toContain("worker-1");
    expect(summary).toContain("gates green after 3 step(s)");
    expect(summary).not.toMatch(/:\s*$/);
  });

  it("says whether a merge landed and why it did not", async () => {
    const landed = await summaryOf("merge-attempt", {
      workerId: "worker-1",
      landed: true,
      reason: null,
      commit: "abc1234",
      detail: "worker-1 landed at abc1234",
    });
    const rejected = await summaryOf("merge-attempt", {
      workerId: "worker-2",
      landed: false,
      reason: "ratchet",
      commit: null,
      detail: "assertions fell from 9 to 4",
    });

    expect(landed).toContain("abc1234");
    expect(rejected).toContain("ratchet");
    expect(rejected).not.toMatch(/:\s*$/);
  });

  it("says which attempt a selection took and out of how many", async () => {
    const summary = await summaryOf("attempt-selection", {
      taskId: "task-1",
      winner: "task-1-attempt-2",
      ranked: 3,
      decidedBy: "changedLinesCovered",
    });

    expect(summary).toContain("task-1-attempt-2");
    expect(summary).toContain("changedLinesCovered");
  });
});
