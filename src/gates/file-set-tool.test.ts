import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { createFileSetRegistry } from "./file-set.ts";
import { createAmendFileSetTool, createDeclareFileSetTool } from "./file-set-tool.ts";

/**
 * The tool the planner declares its file set through. Invariant 12 depends on the declaration
 * reaching the ledger before the edits, and on a widening being visible rather than silent;
 * the ordering is tested at the gate level, and this is the wrapper the model actually calls.
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
  return evidence
    .records()
    .filter((record) => record.type === type)
    .map(
      (record) => (evidence.payloads().get(record.payloadDigest) ?? {}) as Record<string, unknown>,
    );
}

describe("declaring a file set", () => {
  it("records the declaration and answers with what it now covers", async () => {
    const { declare, registry } = tools();

    const output = await declare.execute({ files: ["src/b.ts", "src/a.ts"] });

    expect(output.text).toBe("declared 2 file(s): src/a.ts, src/b.ts");
    expect(output.facts).toEqual({ declaredFiles: 2 });
    expect(registry.state().allowed).toEqual(new Set(["src/a.ts", "src/b.ts"]));
    expect(recordsOfType("file-set-declared")).toHaveLength(1);
  });

  it("touches no path itself, so the sandbox has nothing to rule on", () => {
    // The declaration is evidence about what the run intends, not an edit. A tool that
    // declared paths here would have the sandbox ruling on files nobody has written yet.
    expect(tools().declare.pathsFrom({ files: ["src/a.ts"] })).toEqual([]);
    expect(tools().declare.kind).toBe("evidence");
  });

  it("answers a second declaration rather than throwing, and keeps the first", async () => {
    // A second declaration is refused, and the refusal reaches the model as output it can act
    // on. Throwing would surface as a tool failure with the reason buried in an error string.
    const { declare, registry } = tools();
    await declare.execute({ files: ["src/a.ts"] });

    const output = await declare.execute({ files: ["src/b.ts"] });

    expect(output.text).toMatch(/already/i);
    expect(output.facts).toEqual({ declaredFiles: 1 });
    expect(registry.state().allowed).toEqual(new Set(["src/a.ts"]));
    expect(recordsOfType("file-set-declared")).toHaveLength(1);
  });

  it("refuses an empty set at the schema, so nothing declares nothing", () => {
    // Thrown rather than rejected: the schema parses before the body runs, so a malformed
    // call never reaches the registry at all.
    expect(() => tools().declare.execute({ files: [] })).toThrow(/expected array to have >=1/);
  });
});

describe("amending a file set", () => {
  it("widens the set and records the reason a reviewer reads", async () => {
    const { declare, amend, registry } = tools();
    await declare.execute({ files: ["src/a.ts"] });

    const output = await amend.execute({
      files: ["src/b.ts"],
      reason: "the fix needs the caller as well",
    });

    expect(output.text).toBe("the declared file set now covers 2 file(s)");
    expect(output.facts).toEqual({ declaredFiles: 2, amendments: 1 });
    expect(registry.state().allowed).toEqual(new Set(["src/a.ts", "src/b.ts"]));
    expect(recordsOfType("file-set-amended")[0]).toMatchObject({
      reason: "the fix needs the caller as well",
    });
  });

  it("records every file the amendment names, not only the ones it widened the set by", async () => {
    // An amendment naming a file already in the set still records it. Recording only the
    // additions would leave the record saying less than the amendment said.
    const { declare, amend } = tools();
    await declare.execute({ files: ["src/a.ts"] });

    await amend.execute({ files: ["src/a.ts", "src/b.ts"], reason: "both, deliberately" });

    expect(recordsOfType("file-set-amended")[0]?.files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("counts each amendment, so a run that kept widening says so", async () => {
    const { declare, amend } = tools();
    await declare.execute({ files: ["src/a.ts"] });

    await amend.execute({ files: ["src/b.ts"], reason: "one" });
    const second = await amend.execute({ files: ["src/c.ts"], reason: "two" });

    expect(second.facts).toEqual({ declaredFiles: 3, amendments: 2 });
  });

  it("demands a reason at the schema, because an unexplained widening is a silent one", () => {
    const { amend } = tools();

    expect(() => amend.execute({ files: ["src/b.ts"] })).toThrow(/expected string/);
    expect(() => amend.execute({ files: ["src/b.ts"], reason: "" })).toThrow(
      /expected string to have >=1/,
    );
  });
});
