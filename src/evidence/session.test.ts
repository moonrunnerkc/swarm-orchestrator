import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { verifyChain } from "./ledger.ts";
import { createSessionId, type EvidenceRecorder, openEvidenceSession } from "./session.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-session-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function openSession(): Promise<EvidenceRecorder> {
  return openEvidenceSession({
    root,
    sessionId: "20260813T120000-abc123",
    clock: createTestClock(1_700_000_000_000),
  });
}

describe("evidence session", () => {
  it("puts the ledger and blobs under the session directory, outside any workspace", async () => {
    const evidence = await openSession();

    expect(evidence.directory).toBe(join(root, "20260813T120000-abc123"));
    expect(evidence.ledgerPath).toBe(join(evidence.directory, "ledger.jsonl"));
    expect(evidence.blobs.directory).toBe(join(evidence.directory, "blobs"));
  });

  it("records a payload as a blob and the chain entry that names it", async () => {
    const evidence = await openSession();

    const { record } = await evidence.record({
      type: "tool-call",
      actor: "harness",
      provenance: ["model"],
      payload: { toolName: "shell", facts: { exitCode: 0 } },
    });

    expect(record.type).toBe("tool-call");
    expect(record.provenance).toEqual(["model"]);
    expect(await evidence.blobs.get(record.payloadDigest)).toEqual({
      toolName: "shell",
      facts: { exitCode: 0 },
    });
    expect(verifyChain(evidence.records()).ok).toBe(true);
  });

  it("scrubs known credential shapes before the payload reaches disk", async () => {
    const evidence = await openSession();

    const { record, redactions } = await evidence.record({
      type: "tool-call",
      actor: "harness",
      provenance: ["model"],
      payload: { output: "GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz" },
    });

    const onDisk = await readFile(evidence.blobs.pathFor(record.payloadDigest), "utf8");
    expect(onDisk).not.toContain("ghp_0123456789abcdefghijklmnopqrstuvwxyz");
    expect(onDisk).toContain("redacted");
    expect(redactions).not.toEqual([]);
  });

  it("returns the harness verdict for a claim, computed after it is recorded", async () => {
    const evidence = await openSession();
    const { record } = await evidence.record({
      type: "tool-call",
      actor: "harness",
      provenance: ["model"],
      payload: { facts: { exitCode: 0 }, tests: { collected: 47, failed: 0 } },
    });

    const verified = await evidence.submitClaim(
      {
        predicate: "tests.failed == 0 && tests.collected >= 47",
        record: record.payloadDigest,
        narrative: "the suite is green",
      },
      "test-model",
    );
    const overClaimed = await evidence.submitClaim(
      { predicate: "tests.collected >= 100", record: record.payloadDigest, narrative: "" },
      "test-model",
    );

    expect(verified.verdict).toBe("verified");
    expect(overClaimed).toMatchObject({ verdict: "unverified", reason: "predicate-false" });
    expect(evidence.records().filter((entry) => entry.type === "claim")).toHaveLength(2);
  });

  it("will not resolve a digest that no record in the chain carries", async () => {
    const evidence = await openSession();
    // A blob that exists in the store but was never recorded is not evidence.
    const orphan = await evidence.blobs.put({ tests: { failed: 0 } });

    const evaluation = await evidence.submitClaim(
      { predicate: "tests.failed == 0", record: orphan, narrative: "" },
      "test-model",
    );

    expect(evaluation).toMatchObject({ verdict: "unverified", reason: "record-not-found" });
  });
});

describe("session ids", () => {
  it("derives from the injected clock and random source, not ambient ones", () => {
    const clock = createTestClock(1_700_000_000_000);
    const id = createSessionId(clock, { next: () => 0.5 });

    expect(id).toBe(
      `${new Date(1_700_000_000_000).toISOString().replace(/[-:]/g, "").slice(0, 15)}-7fffff`,
    );
    expect(createSessionId(clock, { next: () => 0.5 })).toBe(id);
  });
});
