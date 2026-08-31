import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { createFileSetRegistry } from "./file-set.ts";
import { createAmendFileSetTool, createDeclareFileSetTool } from "./file-set-tool.ts";

/**
 * The tool wrapper around invariant 12's declaration. The ordering it protects is tested at
 * the gate; what is tested here is the wrapper: what a caller is told, what reaches the chain,
 * and what happens on the second declaration, which is the case the planner actually hits.
 */

let root = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-file-set-tool-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "file-set-tool-session",
    clock: createTestClock(1_700_000_000_000),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function tools() {
  const registry = createFileSetRegistry(evidence);
  return {
    registry,
    declare: createDeclareFileSetTool(registry, "model"),
    amend: createAmendFileSetTool(registry, "model"),
  };
}

function recordsOfType(type: string): readonly Record<string, unknown>[] {
  const payloads = evidence.payloads();
  return evidence
    .records()
    .filter((record) => record.type === type)
    .map((record) => (payloads.get(record.payloadDigest) ?? {}) as Record<string, unknown>);
}

describe("declaring a file set", () => {
  it("names the files back, sorted, so the caller can see what was taken", async () => {
    const { declare } = tools();

    const outcome = await declare.execute({ files: ["src/b.ts", "src/a.ts"] });

    expect(outcome.text).toBe("declared 2 file(s): src/a.ts, src/b.ts");
    expect(outcome.facts).toMatchObject({ declaredFiles: 2 });
  });

  it("writes the declaration to the chain, which is what the ordering check reads", async () => {
    const { declare } = tools();

    await declare.execute({ files: ["src/a.ts"] });

    expect(recordsOfType("file-set-declared")).toHaveLength(1);
  });

  it("counts a repeated path once", async () => {
    const { declare } = tools();

    const outcome = await declare.execute({ files: ["src/a.ts", "src/a.ts"] });

    expect(outcome.facts).toMatchObject({ declaredFiles: 1 });
  });

  it("reports a second declaration rather than raising, and declares nothing new", async () => {
    // The planner reaching for declare twice is a mistake to answer, not a run to end: the
    // first declaration stands, and a second is refused rather than merged (invariant 15's
    // rule for a graph, and the same reasoning here).
    const { declare } = tools();
    await declare.execute({ files: ["src/a.ts"] });

    const outcome = await declare.execute({ files: ["src/b.ts"] });

    expect(outcome.text).toMatch(/already/i);
    expect(outcome.facts).toMatchObject({ declaredFiles: 1 });
    expect(recordsOfType("file-set-declared")).toHaveLength(1);
  });

  it("names no paths of its own, because a declaration touches no file", async () => {
    expect(tools().declare.pathsFrom({ files: ["src/a.ts"] })).toEqual([]);
  });
});

describe("amending a file set", () => {
  it("reports the widened total and how many amendments there have been", async () => {
    const { declare, amend } = tools();
    await declare.execute({ files: ["src/a.ts"] });

    const outcome = await amend.execute({ files: ["src/b.ts"], reason: "b turned out to matter" });

    expect(outcome.text).toBe("the declared file set now covers 2 file(s)");
    expect(outcome.facts).toMatchObject({ declaredFiles: 2, amendments: 1 });
  });

  it("records the reason, which is what a reviewer reads", async () => {
    const { declare, amend } = tools();
    await declare.execute({ files: ["src/a.ts"] });

    await amend.execute({ files: ["src/b.ts"], reason: "b turned out to matter" });

    expect(recordsOfType("file-set-amended")[0]).toMatchObject({
      reason: "b turned out to matter",
    });
  });

  it("counts a second amendment as a second amendment", async () => {
    const { declare, amend } = tools();
    await declare.execute({ files: ["src/a.ts"] });
    await amend.execute({ files: ["src/b.ts"], reason: "one" });

    const outcome = await amend.execute({ files: ["src/c.ts"], reason: "two" });

    expect(outcome.facts).toMatchObject({ declaredFiles: 3, amendments: 2 });
  });

  it("records a file it already covered, rather than only the ones it widened by", async () => {
    // Invariant 12: an amendment records every file it names. Recording only the widening
    // leaves the record saying less than the amendment did.
    const { declare, amend } = tools();
    await declare.execute({ files: ["src/a.ts"] });

    await amend.execute({ files: ["src/a.ts", "src/b.ts"], reason: "both" });

    expect(recordsOfType("file-set-amended")[0]).toMatchObject({
      files: ["src/a.ts", "src/b.ts"],
    });
  });
});

describe("what both tools refuse before running", () => {
  it("will not take an empty file list", () => {
    const { declare, amend } = tools();

    expect(declare.inputSchema.safeParse({ files: [] }).success).toBe(false);
    expect(amend.inputSchema.safeParse({ files: [], reason: "x" }).success).toBe(false);
  });

  it("will not take an amendment with no reason", () => {
    expect(tools().amend.inputSchema.safeParse({ files: ["src/a.ts"], reason: "" }).success).toBe(
      false,
    );
  });
});
