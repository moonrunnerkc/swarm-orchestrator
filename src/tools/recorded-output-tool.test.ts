import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { createToolChokepoint } from "./chokepoint.ts";
import { createLedgerChokepointRecorder } from "./chokepoint-record.ts";
import { createClaimTool } from "./claim-tool.ts";
import { createPolicyGuard } from "./policy-guard.ts";
import { createRecordedOutputTool } from "./recorded-output-tool.ts";
import { defineTool } from "./tool-definition.ts";

/**
 * A verbose command through the real chokepoint and ledger: the model is shown a bounded view, the
 * ledger keeps what was captured, and the omitted lines come back through the chokepoint by the
 * evidence reference the view gave. The shell is a stand-in that prints a fixed log.
 */
let root = "";
let evidence: EvidenceRecorder;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-recorded-output-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "s",
    clock: createTestClock(1_700_000_000_000),
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const log = [
  "exit code: 1",
  "stdout:",
  ...Array.from({ length: 3_000 }, (_, index) =>
    index === 1_499
      ? "not ok 1500 - the middle case fails: expected 3 but got 4"
      : `ok ${index + 1} - fine`,
  ),
  "# fail 1",
].join("\n");

function chokepoint() {
  const guard = createPolicyGuard({
    workspaceRoot: "/work/repo",
    homeDir: "/home/dev",
    shellAllowlist: ["npm"],
    deniedRoots: [],
    realpath: (path) => path,
  });
  const shell = defineTool({
    name: "shell",
    description: "prints a fixed log",
    inputSchema: z.object({ command: z.string() }),
    kind: "shell",
    pathsFrom: () => [],
    execute: () =>
      Promise.resolve({
        text: log,
        facts: {
          command: "npm test",
          exitCode: 1,
          timedOut: false,
          cancelled: false,
          truncated: false,
        },
      }),
  });
  return createToolChokepoint({
    definitions: [shell, createRecordedOutputTool(evidence), createClaimTool(evidence, "fixture")],
    guard,
    confirm: () => Promise.resolve("yes"),
    recorder: createLedgerChokepointRecorder(evidence),
  });
}

const recordOf = (output: string) =>
  /evidence record (sha256:[0-9a-f]{64})/.exec(output)?.[1] ?? "";

describe("a verbose command's output", () => {
  it("reaches the model as a bounded view while the ledger keeps the captured output", async () => {
    const invoker = chokepoint();
    const outcome = await invoker.invoke({
      callId: "c1",
      toolName: "shell",
      input: { command: "npm test" },
      provenance: "model",
    });
    expect(outcome.output.length).toBeLessThan(14_000);
    expect(outcome.output).toContain("recorded status: exit code 1");
    expect(outcome.output).toContain("1,502: not ok 1500 - the middle case fails");
    const record = recordOf(outcome.output);
    const stored = evidence.payloads().get(record) as {
      output?: string;
      facts?: { exitCode?: number };
    };
    expect(stored.output).toBe(log);
    expect(stored.facts?.exitCode).toBe(1);
  });

  it("gives back omitted lines by the evidence reference, through the chokepoint, labelled as recorded output", async () => {
    const invoker = chokepoint();
    const shown = await invoker.invoke({
      callId: "c1",
      toolName: "shell",
      input: { command: "npm test" },
      provenance: "model",
    });
    const record = recordOf(shown.output);
    const lines = await invoker.invoke({
      callId: "c2",
      toolName: "read_recorded_output",
      input: { record, startLine: 1_501, endLine: 1_503 },
      provenance: "model",
    });
    expect(lines.failed).toBe(false);
    expect(lines.output).toContain("lines 1,501 to 1,503 of 3,003 of the output recorded on");
    expect(lines.output).toContain(
      "1,502: not ok 1500 - the middle case fails: expected 3 but got 4",
    );
    expect(lines.output).not.toContain("1,504:");
    const found = await invoker.invoke({
      callId: "c3",
      toolName: "read_recorded_output",
      input: { record, contains: "not ok" },
      provenance: "model",
    });
    expect(found.output).toContain("1 line(s) containing");
    expect(found.output).toContain("1,502: not ok 1500");
    // The reading itself is a recorded call, as every call is.
    expect(evidence.records().filter((one) => one.type === "tool-call")).toHaveLength(6);
  });

  it("refuses a reference that names no recorded tool output of this session", async () => {
    const invoker = chokepoint();
    const unknown = await invoker.invoke({
      callId: "c1",
      toolName: "read_recorded_output",
      input: { record: `sha256:${"0".repeat(64)}`, startLine: 1, endLine: 2 },
      provenance: "model",
    });
    expect(unknown.failed).toBe(true);
    expect(unknown.output).toContain("no tool output of this session is recorded under");
  });

  it("leaves a claim about the command's recorded facts exactly as it was", async () => {
    const invoker = chokepoint();
    const shown = await invoker.invoke({
      callId: "c1",
      toolName: "shell",
      input: { command: "npm test" },
      provenance: "model",
    });
    const claim = (predicate: string, callId: string) =>
      invoker.invoke({
        callId,
        toolName: "claim",
        input: { predicate, record: recordOf(shown.output), recordKind: "tool-call:shell" },
        provenance: "model",
      });
    // Evaluated against the recorded facts, never against the view the model was shown.
    expect((await claim("facts.exitCode == 0", "c2")).output).toContain(
      "UNVERIFIED (predicate-false)",
    );
    expect((await claim("facts.exitCode == 1", "c3")).output).toMatch(/^VERIFIED/);
  });
});
