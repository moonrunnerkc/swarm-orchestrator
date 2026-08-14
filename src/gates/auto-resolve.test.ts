import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoopEvent } from "../core/loop-events.ts";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { type AutoResolveOutcome, type ResolveAttempt, runAutoResolve } from "./auto-resolve.ts";
import type { FileSetState } from "./file-set.ts";
import type { DiffBudget, GateContext, GateDefinition } from "./gate-definition.ts";
import { citedRecords, outstandingJustifications } from "./gate-runner.ts";
import { diffBudgetGate } from "./inspection-gates.ts";
import { measureTestFile } from "./measures.ts";
import { exitCodeParser, testOutputParser } from "./parsers.ts";
import type { BaseControlRunner } from "./respecification.ts";
import {
  createMemoryCheckpoint,
  createMemoryWorkspace,
  createStubBaseControl,
  createStubCommandRunner,
  type MemoryWorkspace,
} from "./test-doubles.ts";

const sourcePath = "src/math.ts";
const testPath = "src/math.test.ts";

const brokenSource = "export function add(a: number, b: number): number {\n  return a - b;\n}\n";
const fixedSource = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
const lintOffendingSource =
  "export function add(a: number, b: number): number {\n  var sum = a + b;\n  return sum;\n}\n";

const originalTests = [
  "import { it, expect } from 'vitest';",
  "import { add } from './math.ts';",
  "it('adds small numbers', () => {",
  "  expect(add(1, 2)).toBe(3);",
  "  expect(add(2, 2)).toBe(4);",
  "});",
  "it('adds zero', () => {",
  "  expect(add(0, 0)).toBe(0);",
  "});",
].join("\n");

let root = "";
let evidence: EvidenceRecorder;
let events: LoopEvent[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-auto-resolve-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "auto-resolve-session",
    clock: createTestClock(1_700_000_000_000),
  });
  events = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const declaredFileSet: FileSetState = {
  declared: [sourcePath, testPath],
  amendments: [],
  allowed: new Set([sourcePath, testPath]),
  wasDeclared: true,
};

/**
 * A test run the harness can actually observe: the assertions in the file are satisfied
 * only by the fixed source, and the TAP counters come out of the file's own measures. That
 * makes "delete the failing tests" produce a genuinely green tests gate, which is the whole
 * point of the fourth acceptance case.
 */
const testsGate: GateDefinition = {
  id: "tests",
  title: "tests",
  severity: "blocking",
  source: { kind: "command", command: "run-tests" },
  parse: testOutputParser,
};

const lintGate: GateDefinition = {
  id: "lint",
  title: "lint",
  severity: "blocking",
  source: { kind: "command", command: "run-lint" },
  parse: exitCodeParser,
};

function stubCommands(workspace: MemoryWorkspace) {
  return createStubCommandRunner((command) => {
    const source = workspace.files.get(sourcePath) ?? "";
    const measures = measureTestFile(workspace.files.get(testPath) ?? null);

    if (command === "run-lint") {
      return source.includes("var ")
        ? { exitCode: 1, stdout: `${sourcePath}: "var" is not allowed` }
        : { exitCode: 0, stdout: "" };
    }

    const failing = source.includes("a + b") ? 0 : measures.tests;
    return {
      exitCode: failing === 0 ? 0 : 1,
      stdout: [
        "TAP version 13",
        `1..${measures.tests}`,
        `# tests ${measures.tests}`,
        `# pass ${measures.tests - failing}`,
        `# fail ${failing}`,
        `# skipped ${measures.skips}`,
      ].join("\n"),
    };
  });
}

interface Harness {
  readonly workspace: MemoryWorkspace;
  run(resolve: ResolveAttempt, baseControl?: BaseControlRunner | null): Promise<AutoResolveOutcome>;
}

function harness(
  options: {
    cap?: number;
    fileSet?: FileSetState;
    budgets?: DiffBudget;
    gates?: readonly GateDefinition[];
  } = {},
): Harness {
  const workspace = createMemoryWorkspace({
    base: { [sourcePath]: fixedSource, [testPath]: originalTests },
    current: { [sourcePath]: brokenSource, [testPath]: originalTests },
  });
  const commands = stubCommands(workspace);

  const context = async (): Promise<GateContext> => ({
    workspaceRoot: "/workspace",
    changes: await workspace.changes(),
    fileSet: options.fileSet ?? declaredFileSet,
    budgets: options.budgets ?? { maxChangedFiles: 12, maxAddedLines: 600 },
    probe: workspace,
  });

  return {
    workspace,
    run: (resolve, baseControl = null) =>
      runAutoResolve({
        gates: options.gates ?? [testsGate, lintGate],
        context,
        cycleDeps: {
          commands,
          evidence,
          emit: (event) => {
            events.push(event);
          },
        },
        evidence,
        checkpoint: createMemoryCheckpoint(workspace),
        baseControl,
        resolve,
        emit: (event) => {
          events.push(event);
        },
        cap: options.cap ?? 3,
      }),
  };
}

function ledgerPayloads(type: string): readonly Record<string, unknown>[] {
  return evidence
    .records()
    .filter((record) => record.type === type)
    .map(
      (record) => (evidence.payloads().get(record.payloadDigest) ?? {}) as Record<string, unknown>,
    );
}

describe("auto-resolve within the cap", () => {
  it("fixes an injected failing test on the first attempt and reports green", async () => {
    const test = harness();

    const outcome = await test.run(({ attempt }) => {
      expect(attempt).toBe(1);
      test.workspace.write(sourcePath, fixedSource);
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("green");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.decision.accepted).toBe(true);
    expect(outcome.finalCycle.blockingFailures).toEqual([]);
  });

  it("hands the model the gate's own output rather than a summary of it", async () => {
    const test = harness();
    let shown = "";

    await test.run(({ gateOutput }) => {
      shown = gateOutput;
      test.workspace.write(sourcePath, fixedSource);
      return Promise.resolve();
    });

    expect(shown).toContain("gate tests (tests) FAILED");
    expect(shown).toContain("# fail 2");
    expect(shown).toContain("evidence record: sha256:");
  });

  it("records every gate run and every ratchet decision on the ledger", async () => {
    const test = harness();

    await test.run(() => {
      test.workspace.write(sourcePath, fixedSource);
      return Promise.resolve();
    });

    const gateRuns = ledgerPayloads("gate-run");
    // Two gates, run once before the attempt and once after it.
    expect(gateRuns).toHaveLength(4);
    expect(gateRuns.map((payload) => [payload.gateId, payload.attempt, payload.status])).toEqual([
      ["tests", 0, "failed"],
      ["lint", 0, "passed"],
      ["tests", 1, "passed"],
      ["lint", 1, "passed"],
    ]);
    expect(gateRuns[0]?.stdout).toContain("# fail 2");
    expect(ledgerPayloads("ratchet-decision")).toHaveLength(1);
  });

  it("emits a gate event carrying the digest of the record it was written from", async () => {
    const test = harness();
    await test.run(() => {
      test.workspace.write(sourcePath, fixedSource);
      return Promise.resolve();
    });

    const gateEvents = events.filter((event) => event.type === "gate");
    const digests = new Set(
      evidence
        .records()
        .filter((record) => record.type === "gate-run")
        .map((record) => record.payloadDigest),
    );

    expect(gateEvents).toHaveLength(4);
    for (const event of gateEvents) {
      expect(digests.has(event.record)).toBe(true);
    }
  });
});

describe("the ratchet under an oscillation", () => {
  it("rejects the regression and escalates instead of looping between two states", async () => {
    const test = harness();

    // The classic oscillation: the fix for the test breaks lint, and the fix for lint
    // brings the test back.
    const outcome = await test.run(() => {
      test.workspace.write(sourcePath, lintOffendingSource);
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts).toHaveLength(3);
    expect(outcome.attempts.every((attempt) => !attempt.decision.accepted)).toBe(true);
    expect(outcome.attempts[0]?.decision.violations[0]?.kind).toBe("gate-regressed");
    expect(outcome.escalation?.attemptsRejectedByRatchet).toBe(3);
    expect(outcome.escalation?.gateId).toBe("tests");
  });

  it("returns the workspace to the last accepted state after a rejection", async () => {
    const test = harness();

    await test.run(() => {
      test.workspace.write(sourcePath, lintOffendingSource);
      return Promise.resolve();
    });

    expect(test.workspace.files.get(sourcePath)).toBe(brokenSource);
  });

  it("records the escalation and the attempt history that led to it", async () => {
    const test = harness();
    await test.run(() => {
      test.workspace.write(sourcePath, lintOffendingSource);
      return Promise.resolve();
    });

    const escalation = ledgerPayloads("escalation")[0];
    expect(escalation).toMatchObject({ gateId: "tests", attemptsUsed: 3, cap: 3 });
    expect((escalation?.history as unknown[]) ?? []).toHaveLength(3);
    expect(events.some((event) => event.type === "escalated")).toBe(true);
  });
});

describe("the ratchet against a retry that deletes the failing tests", () => {
  it("rejects the deletion even though the tests gate turned green, and counts the attempt", async () => {
    const test = harness();

    const outcome = await test.run(() => {
      // The tests gate goes green because there is nothing left to fail.
      test.workspace.write(testPath, "import { it, expect } from 'vitest';\n");
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts).toHaveLength(3);

    const first = outcome.attempts[0];
    expect(first?.cycle.statuses.tests).toBe("passed");
    expect(first?.decision.accepted).toBe(false);
    expect(first?.decision.violations.map((violation) => violation.kind)).toEqual([
      "tests-declared-decreased",
      "assertions-decreased",
      "tests-collected-decreased",
    ]);
    expect(test.workspace.files.get(testPath)).toBe(originalTests);
  });

  it("rejects a retry that silences the failing tests by skipping them", async () => {
    const test = harness();

    const outcome = await test.run(() => {
      test.workspace.write(testPath, originalTests.replaceAll("it(", "it.skip("));
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts[0]?.decision.violations.map((violation) => violation.kind)).toContain(
      "skip-markers-increased",
    );
  });
});

describe("the escape hatch inside the loop", () => {
  const respecifiedTests = [
    "import { it, expect } from 'vitest';",
    "import { add } from './math.ts';",
    "it('adds small numbers', () => {",
    "  expect(add(1, 2)).toBe(3);",
    "});",
  ].join("\n");

  it("lets a genuinely new specification through without tripping the ratchet", async () => {
    const test = harness();

    const outcome = await test.run(
      () => {
        test.workspace.write(sourcePath, fixedSource);
        test.workspace.write(testPath, respecifiedTests);
        return Promise.resolve();
      },
      createStubBaseControl(() => ({ onBase: "failed", onSubmitted: "passed" })),
    );

    expect(outcome.settled).toBe("green");
    expect(outcome.attempts[0]?.decision.accepted).toBe(true);
    expect(outcome.attempts[0]?.decision.exemptFiles).toEqual([testPath]);
  });

  it("rejects the same edit when the control shows the test also passed on the base source", async () => {
    const test = harness();

    const outcome = await test.run(
      () => {
        test.workspace.write(sourcePath, fixedSource);
        test.workspace.write(testPath, respecifiedTests);
        return Promise.resolve();
      },
      createStubBaseControl(() => ({ onBase: "passed", onSubmitted: "passed" })),
    );

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts[0]?.decision.accepted).toBe(false);
    expect(outcome.attempts[0]?.decision.violations.map((violation) => violation.kind)).toContain(
      "assertions-decreased",
    );
  });

  it("records both controls, granted or not, in the ratchet's own record", async () => {
    const test = harness();

    await test.run(
      () => {
        test.workspace.write(sourcePath, fixedSource);
        test.workspace.write(testPath, respecifiedTests);
        return Promise.resolve();
      },
      createStubBaseControl(() => ({ onBase: "failed", onSubmitted: "passed" })),
    );

    const decision = ledgerPayloads("ratchet-decision")[0];
    expect(decision?.respecification).toEqual([
      {
        file: testPath,
        exempt: true,
        reason: expect.stringContaining("new specification"),
        controls: {
          submittedTestOnBaseSource: "failed: stub control",
          submittedTestOnSubmittedSource: "passed: stub control",
        },
      },
    ]);
  });
});

describe("a resolver that cannot run", () => {
  it("counts the attempt, restores the workspace, and records why", async () => {
    const test = harness({ cap: 1 });

    const outcome = await test.run(() => Promise.reject(new Error("the model is unreachable")));

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.decision.detail).toContain("the model is unreachable");
    expect(ledgerPayloads("ratchet-decision")[0]?.accepted).toBe(false);
  });
});

describe("gates with nothing to resolve", () => {
  it("does not spend an attempt when the first cycle is already green", async () => {
    const test = harness();
    test.workspace.write(sourcePath, fixedSource);

    let called = 0;
    const outcome = await test.run(() => {
      called += 1;
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("green");
    expect(outcome.attempts).toEqual([]);
    expect(called).toBe(0);
  });
});

describe("an advisory gate that demands a justification", () => {
  it("reports the demand as outstanding until a claim cites the gate's record", async () => {
    const test = harness({
      budgets: { maxChangedFiles: 0, maxAddedLines: 0 },
      gates: [testsGate, lintGate, diffBudgetGate],
    });

    const outcome = await test.run(() => {
      // A fix that differs from the base commit, so there is a diff to be over budget.
      test.workspace.write(sourcePath, `${fixedSource}export const version = 2;\n`);
      return Promise.resolve();
    });

    const budget = outcome.finalCycle.runs.find((gate) => gate.gateId === "diff-budget");
    expect(budget?.status).toBe("failed");
    // Advisory, so the run is still green: over budget does not block.
    expect(outcome.settled).toBe("green");
    expect(
      outstandingJustifications(outcome.finalCycle, citedRecords(evidence)).map(
        (gate) => gate.gateId,
      ),
    ).toEqual(["diff-budget"]);

    await evidence.submitClaim(
      {
        predicate: "measures.changedFiles >= 1",
        record: budget?.record ?? null,
        narrative: "the fix touches one file and the budget was set to zero for this test",
      },
      "model",
    );

    expect(outstandingJustifications(outcome.finalCycle, citedRecords(evidence))).toEqual([]);
  });
});
