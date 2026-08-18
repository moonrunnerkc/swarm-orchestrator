/**
 * Claim-binding attacks under new framings: same-kind later twin, model-supplied
 * recordSequence pointing forward, DAG rebuild vs submit-time verdict, verifier parity
 * after a colliding append, and a lifecycle record reused as a gate-outcome claim.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../../src/core/test-doubles.ts";
import type { JsonValue } from "../../src/evidence/canonical-json.ts";
import { evaluateClaim } from "../../src/evidence/claim.ts";
import { buildEvidenceDag } from "../../src/evidence/dag.ts";
import { indexCitedRecords } from "../../src/evidence/record-index.ts";
import { recordKindOf } from "../../src/evidence/record-kind.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../../src/evidence/session.ts";
import * as embedded from "../../src/evidence/verifier/verify.mjs";

describe("claim probes", () => {
  let root = "";
  let evidence: EvidenceRecorder;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "p5-claim-"));
    evidence = await openEvidenceSession({
      root,
      sessionId: "p5-claim",
      clock: createTestClock(1),
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("B-samekind: a later same-kind twin does not move an earlier verified claim", async () => {
    const payload: JsonValue = { gateId: "tests", status: "passed", nonce: "p5-samekind" };
    const run = await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
    const atSubmit = await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: run.record.payloadDigest,
        recordKind: "gate-run:tests",
        narrative: "tests passed",
      },
      "harness",
    );
    await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    const live = indexCitedRecords(evidence.records(), evidence.payloads());
    const claimPayload = evidence.payloads().get(
      evidence.records().find((record) => record.type === "claim")?.payloadDigest ?? "",
    );
    const offline = embedded.evaluateClaim(claimPayload, (digest: string) => live.get(digest));
    console.log("B-samekind", {
      atSubmit: atSubmit.verdict,
      dag: dag.claims[0]?.evaluation.verdict,
      offline: offline.verdict,
      carriers: live.get(run.record.payloadDigest)?.carriers,
    });
    expect(atSubmit.verdict).toBe("verified");
    expect(dag.claims[0]?.evaluation.verdict).toBe("verified");
    expect(offline.verdict).toBe("verified");
  });

  it("B-forward: a model-supplied recordSequence cannot bind to a record appended later", async () => {
    const payload: JsonValue = { gateId: "lint", status: "passed", nonce: "p5-forward" };
    const run = await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
    const smuggled = await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: run.record.payloadDigest,
        recordKind: "gate-run:tests",
        recordSequence: 99,
        narrative: "bind me later",
      },
      "fixture:liar",
    );
    await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { gateId: "tests", status: "passed", nonce: "p5-forward" },
    });
    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    console.log("B-forward", {
      smuggled: smuggled.verdict,
      smuggledReason: smuggled.reason,
      storedSequence: (
        evidence.payloads().get(
          evidence.records().find((record) => record.type === "claim")?.payloadDigest ?? "",
        ) as { recordSequence?: unknown } | undefined
      )?.recordSequence,
      dag: dag.claims[0]?.evaluation.verdict,
    });
    expect(smuggled.verdict).toBe("unverified");
    expect(dag.claims[0]?.evaluation.verdict).toBe("unverified");
  });

  it("B-lifecycle: a lifecycle payload cannot satisfy a gate-outcome claim", async () => {
    const twin: JsonValue = { stopReason: "completed", gateId: "tests", status: "passed" };
    const life = await evidence.record({
      type: "session-stopped",
      actor: "harness",
      provenance: ["tool-output"],
      payload: twin,
    });
    const evaluation = await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: life.record.payloadDigest,
        recordKind: "gate-run:tests",
        narrative: "lifecycle as tests",
      },
      "fixture:liar",
    );
    console.log("B-lifecycle", {
      kind: recordKindOf("session-stopped", twin),
      verdict: evaluation.verdict,
      reason: evaluation.reason,
    });
    expect(evaluation.verdict).toBe("unverified");
    expect(evaluation.reason).toBe("predicate-kind-mismatch");
  });

  it("B-undefined-seq: evaluating a stored claim without its binding is not how the DAG reads it", async () => {
    const payload: JsonValue = { gateId: "tests", status: "passed", nonce: "p5-undef" };
    const run = await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
    await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: run.record.payloadDigest,
        recordKind: "gate-run:tests",
        narrative: "honest",
      },
      "harness",
    );
    await evidence.record({
      type: "tool-call",
      actor: "fixture",
      provenance: ["model"],
      payload,
    });
    const stored = evidence.payloads().get(
      evidence.records().find((record) => record.type === "claim")?.payloadDigest ?? "",
    ) as {
      predicate: string;
      record: string;
      recordKind: string;
      recordSequence?: number | null;
      narrative: string;
    };
    const live = indexCitedRecords(evidence.records(), evidence.payloads());
    const stripped = evaluateClaim(
      { ...stored, recordSequence: undefined },
      (digest) => live.get(digest),
    );
    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    console.log("B-undefined-seq", {
      storedSequence: stored.recordSequence,
      stripped: stripped.verdict,
      strippedReason: stripped.reason,
      dag: dag.claims[0]?.evaluation.verdict,
    });
    expect(dag.claims[0]?.evaluation.verdict).toBe("verified");
    expect(stripped.verdict).not.toBe("verified");
  });
});
