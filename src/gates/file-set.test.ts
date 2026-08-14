import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { claimPayloadSchema } from "../evidence/claim.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import {
  checkFileSet,
  createFileSetRegistry,
  emptyFileSet,
  FileSetAlreadyDeclaredError,
  normalizePath,
} from "./file-set.ts";

let root = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-file-set-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "file-set-session",
    clock: createTestClock(1_700_000_000_000),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function payloadOf(recorder: EvidenceRecorder, type: string): Record<string, unknown> {
  const record = recorder.records().find((candidate) => candidate.type === type);
  return (recorder.payloads().get(record?.payloadDigest ?? "") ?? {}) as Record<string, unknown>;
}

describe("declared file set membership", () => {
  it("normalizes a path so two spellings cannot both pass", () => {
    expect(normalizePath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizePath("src\\a.ts")).toBe("src/a.ts");
    expect(normalizePath("/src/a.ts")).toBe("src/a.ts");
  });

  it("names every changed file that falls outside the declared set", async () => {
    const registry = createFileSetRegistry(evidence);
    await registry.declare(["src/a.ts", "src/a.test.ts"], "model");

    const verdict = checkFileSet(registry.state(), ["src/a.ts", "src/b.ts", "README.md"]);

    expect(verdict.outside).toEqual(["README.md", "src/b.ts"]);
    expect(verdict.declaredCount).toBe(2);
    expect(verdict.wasDeclared).toBe(true);
  });

  it("reports that nothing was declared, which is not the same as an empty set passing", () => {
    const verdict = checkFileSet(emptyFileSet, ["src/a.ts"]);

    expect(verdict.wasDeclared).toBe(false);
    expect(verdict.outside).toEqual(["src/a.ts"]);
  });

  it("records the declaration on the ledger before any editing happens", async () => {
    const registry = createFileSetRegistry(evidence);
    await registry.declare(["src/b.ts", "src/a.ts", "src/a.ts"], "model");

    expect(payloadOf(evidence, "file-set-declared")).toEqual({
      files: ["src/a.ts", "src/b.ts"],
      fileCount: 2,
    });
  });

  it("refuses a second declaration, because replacing the set would hide the widening", async () => {
    const registry = createFileSetRegistry(evidence);
    await registry.declare(["src/a.ts"], "model");

    await expect(registry.declare(["src/b.ts"], "model")).rejects.toBeInstanceOf(
      FileSetAlreadyDeclaredError,
    );
    expect(registry.state().allowed.has("src/b.ts")).toBe(false);
  });
});

describe("the declaration has to precede the edit it authorizes", () => {
  async function recordWrite(path: string): Promise<void> {
    await evidence.record({
      type: "tool-call",
      actor: "model",
      provenance: ["model"],
      payload: { toolName: "write", kind: "write", decision: "allowed", facts: { path } },
    });
  }

  it("does not let a declaration authorize a write the ledger already carries", async () => {
    const registry = createFileSetRegistry(evidence);
    await recordWrite("src/b.ts");
    const state = await registry.declare(["src/a.ts", "src/b.ts"], "model");

    // Set membership alone says this is fine, which is what made declaring afterwards work.
    expect(state.allowed.has("src/b.ts")).toBe(true);
    expect(checkFileSet(state, ["src/b.ts"]).outside).toEqual([]);
    expect(checkFileSet(state, ["src/b.ts"]).editedBeforeAuthorized).toEqual(["src/b.ts"]);
  });

  it("authorizes a write the declaration precedes", async () => {
    const registry = createFileSetRegistry(evidence);
    await registry.declare(["src/a.ts"], "model");
    await recordWrite("src/a.ts");

    expect(checkFileSet(registry.state(), ["src/a.ts"]).editedBeforeAuthorized).toEqual([]);
  });

  it("clears it on a recorded amendment, exactly as an out-of-set edit is cleared", async () => {
    const registry = createFileSetRegistry(evidence);
    await recordWrite("src/b.ts");
    await registry.declare(["src/a.ts", "src/b.ts"], "model");
    const amended = await registry.amend(["src/b.ts"], "edited before it was declared", "model");

    // The point was never to forbid it. It is to put the widening in front of a reviewer.
    expect(checkFileSet(amended, ["src/b.ts"]).editedBeforeAuthorized).toEqual([]);
    expect(amended.amendments).toHaveLength(1);
  });

  it("counts writes and not reads, since reading a file authorizes nothing", async () => {
    const registry = createFileSetRegistry(evidence);
    await evidence.record({
      type: "tool-call",
      actor: "model",
      provenance: ["model"],
      payload: {
        toolName: "read",
        kind: "read",
        decision: "allowed",
        facts: { path: "src/b.ts" },
      },
    });
    const state = await registry.declare(["src/b.ts"], "model");

    expect(checkFileSet(state, ["src/b.ts"]).editedBeforeAuthorized).toEqual([]);
  });

  it("ignores a write the sandbox refused, which never touched the file", async () => {
    const registry = createFileSetRegistry(evidence);
    await evidence.record({
      type: "tool-call",
      actor: "model",
      provenance: ["model"],
      payload: {
        toolName: "write",
        kind: "write",
        decision: "denied",
        denial: "sandbox",
        facts: { path: "src/b.ts" },
      },
    });
    const state = await registry.declare(["src/b.ts"], "model");

    expect(checkFileSet(state, ["src/b.ts"]).editedBeforeAuthorized).toEqual([]);
  });
});

describe("amending the declared file set", () => {
  it("widens the set and records the amendment with its stated reason", async () => {
    const registry = createFileSetRegistry(evidence);
    await registry.declare(["src/a.ts"], "model");
    const state = await registry.amend(["src/b.ts"], "the fix needs a shared helper", "model");

    expect([...state.allowed].sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(payloadOf(evidence, "file-set-amended")).toEqual({
      files: ["src/b.ts"],
      added: ["src/b.ts"],
      addedCount: 1,
      reason: "the fix needs a shared helper",
      amendment: true,
      fileCountAfter: 2,
    });
    expect(checkFileSet(state, ["src/a.ts", "src/b.ts"]).outside).toEqual([]);
  });

  it("puts the widening in front of a reviewer as a claim the harness verified", async () => {
    const registry = createFileSetRegistry(evidence);
    await registry.declare(["src/a.ts"], "model");
    await registry.amend(["src/b.ts"], "the fix needs a shared helper", "model");

    const claimRecord = evidence.records().find((record) => record.type === "claim");
    const claim = claimPayloadSchema.parse(
      evidence.payloads().get(claimRecord?.payloadDigest ?? ""),
    );
    const amendment = evidence
      .records()
      .find((record) => record.type === "file-set-amended")?.payloadDigest;

    expect(claim.record).toBe(amendment);
    expect(claim.predicate).toBe("amendment == true && addedCount == 1 && fileCountAfter == 2");
    expect(claim.narrative).toContain("src/b.ts");
  });

  it("names what a widening-nothing amendment was about, since `added` cannot", async () => {
    const registry = createFileSetRegistry(evidence);
    await registry.declare(["src/a.ts"], "model");
    await registry.amend(["src/a.ts"], "belt and braces", "model");

    expect(payloadOf(evidence, "file-set-amended")).toMatchObject({
      files: ["src/a.ts"],
      added: [],
      addedCount: 0,
    });
  });
});
