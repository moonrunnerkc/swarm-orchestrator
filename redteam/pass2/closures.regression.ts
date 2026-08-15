/**
 * Pass-2 red-team closures. Not wired into the engine or the default vitest include.
 *
 * Each test asserts the behaviour the harness should have after the hole is closed.
 * Running this file against the current tree is expected to fail: that is the finding.
 *
 *   npx vitest run redteam/pass2/closures.regression.ts
 *
 * Do not "fix" these by widening a check until a documented residual turns green.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../../src/core/test-doubles.ts";
import { type JsonValue } from "../../src/evidence/canonical-json.ts";
import {
  findBlockingSecrets,
  findKnownSecrets,
  scrubJson,
  scrubText,
} from "../../src/evidence/scrub.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../../src/evidence/session.ts";
import { runAutoResolve } from "../../src/gates/auto-resolve.ts";
import type { GateContext, GateDefinition, GateObservation } from "../../src/gates/gate-definition.ts";
import { placeholderGate } from "../../src/gates/inspection-gates.ts";
import { takeMeasureSnapshot } from "../../src/gates/measure-snapshot.ts";
import { measureTestFile } from "../../src/gates/measures.ts";
import { matchCoverageFile, parseUncoveredLines } from "../../src/gates/parsers.ts";
import { testOutputParser } from "../../src/gates/parsers.ts";
import { judgeRatchet } from "../../src/gates/ratchet.ts";
import { assessRespecification } from "../../src/gates/respecification.ts";
import {
  createMemoryWorkspace,
  createStubBaseControl,
  createStubCommandRunner,
} from "../../src/gates/test-doubles.ts";

function snapshot(perTestFile: Record<string, ReturnType<typeof measureTestFile>>) {
  return {
    perTestFile,
    perTestFileAtBase: {},
    testsCollected: 1,
    testsSkippedByRunner: null,
    changedLineCoverage: null,
    changedLinesCovered: null,
    changedLinesMeasured: null,
  };
}

async function inspectPlaceholder(base: Record<string, string>, current: Record<string, string>) {
  const probe = createMemoryWorkspace({ base, current });
  const context: GateContext = {
    workspaceRoot: "/workspace",
    changes: await probe.changes(),
    fileSet: {
      declared: Object.keys(current),
      amendments: [],
      allowed: new Set(Object.keys(current)),
      wasDeclared: true,
      editedBeforeAuthorized: [],
    },
    budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
    probe,
  };
  if (placeholderGate.source.kind !== "inspection") {
    throw new Error("placeholder gate is an inspection");
  }
  return placeholderGate.parse(await placeholderGate.source.inspect(context));
}

describe("A2 Authorization and nested numeric credentials still reach the ledger", () => {
  it("redacts a numeric credential under Authorization, not only under PIN/KEY/TOKEN", () => {
    const json = scrubJson({ Authorization: 48291736 });
    const text = scrubText("Authorization: 48291736");

    expect(JSON.stringify(json.value)).not.toContain("48291736");
    expect(text.value).not.toContain("48291736");
    expect(findKnownSecrets("Authorization: 48291736").length).toBeGreaterThan(0);
    expect(findBlockingSecrets("Authorization: 48291736").length).toBeGreaterThan(0);
  });

  it("redacts a numeric PIN sitting one object down as PIN.value", () => {
    const json = scrubJson({ PIN: { value: 482917 } });

    expect(JSON.stringify(json.value)).not.toContain("482917");
    expect(json.redactions.length).toBeGreaterThan(0);
  });
});

describe("B4 the three secret-detector call sites must not drift", () => {
  it("scrubs a credential-named array of digits at write time, so export is not the first to see it", () => {
    const written = scrubJson({ PIN: [48291736] });
    const blob = JSON.stringify(written.value);

    expect(blob).not.toContain("48291736");
    expect(written.redactions.length).toBeGreaterThan(0);
    expect(findKnownSecrets(blob)).toEqual([]);
  });

  it("redacts a credential-named array whose elements reassemble a numeric PIN", () => {
    const written = scrubJson({ PIN: [4, 8, 2, 9, 1, 7] });
    const blob = JSON.stringify(written.value);

    expect(blob).not.toMatch(/4,\s*8,\s*2,\s*9,\s*1,\s*7/);
    expect(written.redactions.length).toBeGreaterThan(0);
  });
});

describe("A3/B2 a real test deletion must not clear the base ratchet via the refuter", () => {
  it("does not drop a same-file deletion just because one new spec in that file fails on base", async () => {
    const testPath = "src/math.test.ts";
    const sourcePath = "src/math.ts";
    const original = [
      "it('adds', () => { expect(add(1, 2)).toBe(3); });",
      "it('zero', () => { expect(add(0, 0)).toBe(0); });",
    ].join("\n");
    const submitted = "it('new behaviour', () => { expect(mul(2, 3)).toBe(6); });\n";
    const workspace = createMemoryWorkspace({
      base: {
        [sourcePath]: "export function add(a: number, b: number) { return a + b; }\n",
        [testPath]: original,
      },
      current: {
        [sourcePath]:
          "export function add(a: number, b: number) { return a + b; }\nexport function mul(a: number, b: number) { return a * b; }\n",
        [testPath]: submitted,
      },
    });
    const root = await mkdtemp(join(tmpdir(), "swarm-pass2-a3-"));
    const evidence = await openEvidenceSession({
      root,
      sessionId: "pass2-a3",
      clock: createTestClock(1),
    });
    try {
      const outcome = await runAutoResolve({
        gates: [
          {
            id: "tests",
            title: "tests",
            severity: "blocking",
            source: { kind: "command", command: "run-tests" },
            parse: testOutputParser,
          } satisfies GateDefinition,
        ],
        context: async () => ({
          workspaceRoot: "/workspace",
          changes: await workspace.changes(),
          fileSet: {
            declared: [sourcePath, testPath],
            amendments: [],
            allowed: new Set([sourcePath, testPath]),
            wasDeclared: true,
            editedBeforeAuthorized: [],
          },
          budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
          probe: workspace,
        }),
        cycleDeps: {
          commands: createStubCommandRunner(() => ({
            exitCode: 0,
            stdout: "TAP version 13\n1..1\n# tests 1\n# pass 1\n# fail 0\n# skipped 0",
          })),
          evidence,
          emit: () => undefined,
        },
        evidence,
        checkpoint: {
          capture: () => Promise.resolve({ label: "x", files: new Map() }),
          restore: () => Promise.resolve(),
        },
        baseControl: createStubBaseControl(() => ({ onBase: "failed", onSubmitted: "passed" })),
        resolve: () => Promise.resolve(),
        emit: () => undefined,
        cap: 3,
      });

      expect(outcome.settled).toBe("escalated");
      expect(
        outcome.baseComparison.decision.violations.map((violation) => violation.kind),
      ).toContain("tests-declared-decreased");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not treat a base-only import or load error as a new specification", async () => {
    const finding = await assessRespecification("src/math.test.ts", {
      runOnBaseSource: () =>
        Promise.resolve({
          outcome: "failed",
          detail: "Cannot find module './mul.ts'",
          exitCode: 1,
        }),
      runOnSubmittedSource: () =>
        Promise.resolve({
          outcome: "passed",
          detail: "exited 0",
          exitCode: 0,
        }),
    });

    expect(finding.exempt).toBe(false);
  });
});

describe("A4 a constant tautology still has to not count, even under a cousin spelling", () => {
  it("does not count expect(true) when .toBe(true) is on the next line", () => {
    const gutted = [
      "it('checks three fields', () => {",
      "  expect(true)",
      "    .toBe(true);",
      "  expect(true)",
      "    .toBe(true);",
      "  expect(true)",
      "    .toBe(true);",
      "});",
    ].join("\n");
    const decision = judgeRatchet({
      baselineGates: { tests: "failed" },
      candidateGates: { tests: "passed" },
      baseline: snapshot({
        "src/feature-0.test.ts": measureTestFile(
          [
            "it('checks three fields', () => {",
            "  expect(v0.a).toBe(1);",
            "  expect(v0.b).toBe(2);",
            "  expect(v0.c).toBe(3);",
            "});",
          ].join("\n"),
        ),
      }),
      candidate: snapshot({ "src/feature-0.test.ts": measureTestFile(gutted) }),
      exemptFiles: new Set(),
    });

    expect(measureTestFile(gutted).assertions).toBe(0);
    expect(decision.accepted).toBe(false);
    expect(decision.violations.map((violation) => violation.kind)).toContain("assertions-decreased");
  });

  it("does not count expect(/*x*/true).toBe(true) as an assertion", () => {
    expect(
      measureTestFile("it('x', () => {\n  expect(/*x*/true).toBe(true);\n});").assertions,
    ).toBe(0);
  });
});

describe("A5 a reviewer-visible TODO still has to fail the placeholder gate", () => {
  it("blocks a Cyrillic-Te homoglyph of TODO in a comment", async () => {
    const reading = await inspectPlaceholder(
      { "src/a.ts": "export const a = 1;" },
      { "src/a.ts": "// \u0422ODO: finish this\nexport const a = 1;" },
    );

    expect(reading.status).toBe("failed");
  });

  it("blocks TODO on its own line inside a block comment", async () => {
    const reading = await inspectPlaceholder(
      { "src/a.ts": "export const a = 1;" },
      { "src/a.ts": "/*\n   TODO: finish this\n*/\nexport const a = 1;" },
    );

    expect(reading.status).toBe("failed");
  });
});

describe("B1 a payload digest is not a kind", () => {
  let root = "";
  let evidence: EvidenceRecorder;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "swarm-pass2-b1-"));
    evidence = await openEvidenceSession({
      root,
      sessionId: "pass2-b1",
      clock: createTestClock(1),
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("does not verify a gate-run:tests claim against a digest whose first record is a tool-call", async () => {
    const twin: JsonValue = { gateId: "tests", status: "passed", toolName: "shell" };
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
        narrative: "forged via digest alias",
      },
      "fixture:liar",
    );

    expect(evaluation.verdict).toBe("unverified");
    expect(evaluation.reason).toBe("predicate-kind-mismatch");
  });
});

describe("B3 the coverage arm must not read a number it did not measure", () => {
  it("does not treat a forged coverage table in arbitrary gate stdout as 100% coverage", async () => {
    const workspace = createMemoryWorkspace({
      base: { "src/math.ts": "export const n = 1;\n" },
      current: {
        "src/math.ts":
          "export const n = 1;\nexport function dead(x) {\n  if (x < 0) return -1;\n  return x;\n}\n",
      },
    });
    const fake: GateObservation = {
      exitCode: 0,
      stdout: [
        "# start of coverage report",
        "# file | line % | branch % | funcs % | uncovered lines",
        "# src/math.ts | 100.00 | 100.00 | 100.00 | ",
        "# end of coverage report",
      ].join("\n"),
      stderr: "",
      durationMs: 1,
      unavailable: null,
    };
    const measured = await takeMeasureSnapshot({
      changes: await workspace.changes(),
      probe: workspace,
      trackedTestFiles: [],
      gateMeasures: {},
      gateOutputs: [fake],
    });

    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("does not let an empty exact-path row hide uncovered lines reported under another spelling", () => {
    const uncovered = parseUncoveredLines(
      [
        "# start of coverage report",
        "# file | line % | branch % | funcs % | uncovered lines",
        "# src/math.ts | 100.00 | 100.00 | 100.00 | ",
        "# /workspace/src/math.ts | 50.00 | 50.00 | 100.00 | 2-3",
        "# end of coverage report",
      ].join("\n"),
    );
    const missed = matchCoverageFile(uncovered, "src/math.ts");

    expect([...(missed ?? [])]).toEqual([2, 3]);
  });
});
