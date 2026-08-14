import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import type { JsonValue } from "./canonical-json.ts";
import { indexCitedRecords } from "./record-index.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./session.ts";

/**
 * Two writers can emit byte-identical payloads, and content addressing makes that one blob.
 * What must not follow is that a claim citing the digest means whichever of them wrote last.
 */

let root = "";
let evidence: EvidenceRecorder;

/** Identical content under two record types: a gate-run twin of a tool-call. */
const twin: JsonValue = { gateId: "tests", status: "passed", toolName: "shell" };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-record-index-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "record-index",
    clock: createTestClock(1),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolving a cited digest", () => {
  it("keeps every record carrying a digest, in chain order, with the sequence naming it", () => {
    const payloads = new Map<string, JsonValue>([["sha256:a", twin]]);
    const index = indexCitedRecords(
      [
        { sequence: 0, type: "tool-call", payloadDigest: "sha256:a" },
        { sequence: 1, type: "gate-run", payloadDigest: "sha256:a" },
        { sequence: 2, type: "gate-run", payloadDigest: "sha256:a" },
      ],
      payloads,
    );

    expect(index.get("sha256:a")?.carriers).toEqual([
      { sequence: 0, kind: "tool-call:shell" },
      { sequence: 1, kind: "gate-run:tests" },
      { sequence: 2, kind: "gate-run:tests" },
    ]);
  });

  it("names one kind when every record carrying the digest is that kind", () => {
    const payloads = new Map<string, JsonValue>([["sha256:a", twin]]);
    const index = indexCitedRecords(
      [
        { sequence: 0, type: "gate-run", payloadDigest: "sha256:a" },
        { sequence: 1, type: "gate-run", payloadDigest: "sha256:a" },
      ],
      payloads,
    );

    expect(new Set(index.get("sha256:a")?.carriers.map((carrier) => carrier.kind))).toEqual(
      new Set(["gate-run:tests"]),
    );
  });

  it("skips a record whose payload the store does not hold", () => {
    const index = indexCitedRecords(
      [{ sequence: 0, type: "gate-run", payloadDigest: "sha256:missing" }],
      new Map(),
    );

    expect(index.size).toBe(0);
  });
});

describe("a claim citing a digest two records share", () => {
  it("does not resolve to the later writer, whichever order they were written in", async () => {
    const first = await evidence.record({
      type: "tool-call",
      actor: "fixture",
      provenance: ["model"],
      payload: twin,
    });
    await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload: twin,
    });

    const evaluation = await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: first.record.payloadDigest,
        recordKind: "gate-run:tests",
        narrative: "the tests gate passed",
      },
      "fixture:liar",
    );

    expect(evaluation.verdict).toBe("unverified");
    expect(evaluation.reason).toBe("predicate-kind-mismatch");
    // The collision is what the reader is told about, not a near miss on the kind.
    expect(evaluation.detail).toContain("2 kinds");
  });

  it("withholds the verdict from the earlier writer too, rather than picking a winner", async () => {
    const first = await evidence.record({
      type: "tool-call",
      actor: "fixture",
      provenance: ["model"],
      payload: twin,
    });
    await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload: twin,
    });

    const evaluation = await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: first.record.payloadDigest,
        recordKind: "tool-call:shell",
        narrative: "the shell call reported passed",
      },
      "fixture:honest",
    );

    // Fail-closed: an edge that cannot be traced to one record backs neither claim.
    expect(evaluation.verdict).toBe("unverified");
    expect(evaluation.reason).toBe("predicate-kind-mismatch");
  });

  it("still verifies an ordinary claim, where one digest names one record", async () => {
    const run = await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { gateId: "tests", status: "passed" },
    });

    const evaluation = await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: run.record.payloadDigest,
        recordKind: "gate-run:tests",
        narrative: "the tests gate passed",
      },
      "harness",
    );

    expect(evaluation.verdict).toBe("verified");
  });

  it("is unaffected by the same payload being recorded twice under one kind", async () => {
    const run = await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { gateId: "tests", status: "passed" },
    });
    await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { gateId: "tests", status: "passed" },
    });

    const evaluation = await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: run.record.payloadDigest,
        recordKind: "gate-run:tests",
        narrative: "the tests gate passed",
      },
      "harness",
    );

    expect(evaluation.verdict).toBe("verified");
  });
});
