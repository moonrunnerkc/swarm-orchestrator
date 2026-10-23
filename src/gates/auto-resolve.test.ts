import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoopEvent } from "../core/loop-events.ts";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { rederiveRatchet } from "../evidence/verifier/rederive.mjs";
import {
  type AutoResolveOutcome,
  type CandidateReviewHook,
  describeRejectedCandidate,
  type OwedFollowUp,
  type RejectedCandidate,
  type ResolveAttempt,
  type ResolveRequest,
  runAutoResolve,
} from "./auto-resolve.ts";
import type { FileSetState } from "./file-set.ts";
import type {
  DiffBudget,
  GateContext,
  GateDefinition,
  GateObservation,
} from "./gate-definition.ts";
import { justifiedRecords, outstandingJustifications } from "./gate-runner.ts";
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
  editedBeforeAuthorized: [],
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
  source: {
    kind: "command",
    command: "run-tests",
    // As production does: a vector the harness built, which is what makes its stdout a stream
    // the harness picked the reporter for and therefore a result it can count.
    argv: ["node", "--test", "--test-reporter=tap", "--test-reporter-destination=stdout"],
  },
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

    if (command.startsWith("run-lint")) {
      return source.includes("var ")
        ? { exitCode: 1, stdout: `${sourcePath}: "var" is not allowed` }
        : { exitCode: 0, stdout: "" };
    }

    const failing = source.includes("a + b") ? 0 : measures.tests;
    const names = Object.keys(measures.perTest);

    // The result points and the counters on one stream, which is what node's TAP reporter
    // writes and what the harness now counts off.
    return {
      exitCode: failing === 0 ? 0 : 1,
      stdout: [
        "TAP version 13",
        ...names.map(
          (name, index) => `${index < failing ? "not ok" : "ok"} ${index + 1} - ${name}`,
        ),
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
  /** From now on every command is refused before it spawns, as a spent wall budget does. */
  refuseCommandsFromNow(): void;
  /** What one command answers from now on, in place of the stub's own reading. */
  respond(command: string, observation: Partial<GateObservation>): void;
}

const refusal =
  "execution refused before spawn: no time remained in the wall budget, so this gate measured nothing";

/** The stub runner, with a switch that turns every later command into a refusal. */
function refusable(
  inner: ReturnType<typeof createStubCommandRunner>,
  state: { refuse: boolean },
): ReturnType<typeof createStubCommandRunner> {
  const refused = () =>
    Promise.resolve({
      exitCode: 128,
      stdout: "",
      stderr: refusal,
      durationMs: 0,
      unavailable: refusal,
    });
  return {
    commands: inner.commands,
    run: (command, options) => (state.refuse ? refused() : inner.run(command, options)),
    runVouched: (argv, options) => (state.refuse ? refused() : inner.runVouched(argv, options)),
  };
}

function harness(
  options: {
    cap?: number;
    fileSet?: FileSetState;
    budgets?: DiffBudget;
    gates?: readonly GateDefinition[];
    /** What the base tree prints for a gate, or null where nothing can measure it. */
    atBase?: (gate: GateDefinition) => { exitCode: number; stdout: string } | null;
    followUp?: OwedFollowUp;
    continuation?: OwedFollowUp;
    review?: CandidateReviewHook;
  } = {},
): Harness {
  const workspace = createMemoryWorkspace({
    base: { [sourcePath]: fixedSource, [testPath]: originalTests },
    current: { [sourcePath]: brokenSource, [testPath]: originalTests },
  });
  const refusing = { refuse: false };
  const scripted = new Map<string, Partial<GateObservation>>();
  const stub = stubCommands(workspace);
  const commands = refusable(
    {
      commands: stub.commands,
      run: (command, options) => {
        const answer = scripted.get(command);
        if (answer === undefined) return stub.run(command, options);
        return Promise.resolve({
          exitCode: answer.exitCode ?? 0,
          stdout: answer.stdout ?? "",
          stderr: answer.stderr ?? "",
          durationMs: answer.durationMs ?? 1,
          unavailable: answer.unavailable ?? null,
        });
      },
      runVouched: (argv, options) => stub.runVouched(argv, options),
    },
    refusing,
  );

  const context = async (): Promise<GateContext> => ({
    workspaceRoot: "/workspace",
    changes: await workspace.changes(),
    fileSet: options.fileSet ?? declaredFileSet,
    budgets: options.budgets ?? { maxChangedFiles: 12, maxAddedLines: 600 },
    probe: workspace,
  });

  return {
    workspace,
    refuseCommandsFromNow: () => {
      refusing.refuse = true;
    },
    respond: (command, observation) => {
      scripted.set(command, observation);
    },
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
        ...(options.followUp === undefined ? {} : { followUp: options.followUp }),
        ...(options.continuation === undefined ? {} : { continuation: options.continuation }),
        ...(options.review === undefined ? {} : { review: options.review }),
        ...(options.atBase === undefined
          ? {}
          : {
              measureAtBase: (gate: GateDefinition) => {
                const observed = options.atBase?.(gate) ?? null;
                return Promise.resolve(
                  observed === null
                    ? null
                    : { ...observed, stderr: "", durationMs: 1, unavailable: null },
                );
              },
            }),
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
    // One for the retry, one for the final state against the base commit.
    expect(ledgerPayloads("ratchet-decision").map((payload) => payload.scope)).toEqual([
      "retry",
      "base",
    ]);
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

describe("the ratchet against the base commit", () => {
  const twoTests = originalTests;
  const oneTest = [
    "import { it, expect } from 'vitest';",
    "import { add } from './math.ts';",
    "it('adds zero', () => {",
    "  expect(add(0, 0)).toBe(0);",
    "});",
  ].join("\n");

  function runFromBase(base: string, current: string): Promise<AutoResolveOutcome> {
    const workspace = createMemoryWorkspace({
      base: { [sourcePath]: fixedSource, [testPath]: base },
      current: { [sourcePath]: fixedSource, [testPath]: current },
    });

    return runAutoResolve({
      gates: [testsGate],
      context: async () => ({
        workspaceRoot: "/workspace",
        changes: await workspace.changes(),
        fileSet: declaredFileSet,
        budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
        probe: workspace,
      }),
      cycleDeps: {
        commands: stubCommands(workspace),
        evidence,
        emit: () => undefined,
      },
      evidence,
      checkpoint: createMemoryCheckpoint(workspace),
      baseControl: null,
      resolve: () => Promise.resolve(),
      emit: () => undefined,
      cap: 3,
    });
  }

  it("rejects a deletion that made the first cycle green before any retry was judged", async () => {
    const outcome = await runFromBase(twoTests, oneTest);

    // The gate itself is honestly green: the surviving test passes. What is not honest is
    // that a test the base commit had is gone, and no retry ever ran to be judged.
    expect(outcome.firstCycle.statuses.tests).toBe("passed");
    expect(outcome.attempts).toEqual([]);
    expect(outcome.baseComparison.decision.accepted).toBe(false);
    expect(outcome.baseComparison.decision.violations.map((violation) => violation.kind)).toEqual([
      "tests-declared-decreased",
      "assertions-decreased",
    ]);
    expect(outcome.settled).toBe("escalated");
    expect(outcome.escalation?.gateId).toBe("ratchet");
  });

  it("stays green when the run left the tests where the base commit had them", async () => {
    const outcome = await runFromBase(twoTests, twoTests);

    expect(outcome.settled).toBe("green");
    expect(outcome.baseComparison.decision.accepted).toBe(true);
  });

  it("records the base comparison as its own ledger decision, on every run", async () => {
    await runFromBase(twoTests, twoTests);

    const decisions = ledgerPayloads("ratchet-decision");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ scope: "base", attempt: 0, accepted: true });
  });

  it("names the measures it could not compare rather than counting them", async () => {
    await runFromBase(twoTests, twoTests);

    const decision = ledgerPayloads("ratchet-decision")[0];
    expect(decision?.detail).toContain("not compared: testsCollected, changedLineCoverage");
  });
});

describe("a gate that withheld its pass", () => {
  /**
   * The sinon launch of 2026-10-21: every gate passed or stood down, lint's pass withheld
   * because the change had altered what the closure read as its instrument, so the cycle was
   * never green, the owed follow-up and a third attempt were spent on nothing, and the
   * escalation named an "unknown" gate with "a blocking failure that is no longer in the final
   * cycle" over a tree with no failure in it. The gate that withheld its pass is the one to name.
   */
  it("escalates naming that gate and its reason, not an unknown gate", async () => {
    const withheld =
      "the runner reported a pass, but this change altered the instrument that measured it (src/math.ts), so the pass is the project's report, not evidence";
    const withholdingLint: GateDefinition = {
      ...lintGate,
      source: { kind: "command", command: "run-withheld-lint" },
    };
    const test = harness({ cap: 1, gates: [testsGate, withholdingLint] });
    test.respond("run-withheld-lint", { exitCode: 0, unavailable: withheld });

    const outcome = await test.run(() => {
      test.workspace.write(sourcePath, fixedSource);
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("escalated");
    expect(outcome.finalCycle.blockingFailures).toEqual([]);
    expect(outcome.finalCycle.statuses).toEqual({ tests: "passed", lint: "not-applicable" });
    expect(outcome.escalation).toMatchObject({
      gateId: "lint",
      title: "lint withheld its pass",
      attemptsUsed: 1,
    });
    expect(outcome.escalation?.reason).toBe(withheld);
  });
});

describe("a cycle the harness could not run", () => {
  /**
   * The repair attempt used the last of the wall budget, and the candidate's gates were refused
   * before they could spawn. The ratchet used to read "passed before, now failed" off that
   * refusal, reject the attempt as a regression, revert the fix, and then match the refusal at
   * the base commit (also refused) to report the gate failing there the same way.
   */
  it("abstains on the refused gates, keeps the work, and escalates naming the budget rather than a regression", async () => {
    const test = harness({ cap: 1 });

    const outcome = await test.run(() => {
      test.workspace.write(sourcePath, fixedSource);
      test.refuseCommandsFromNow();
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts).toHaveLength(1);
    const decision = outcome.attempts[0]?.decision;
    expect(decision?.accepted).toBe(true);
    expect(decision?.violations).toEqual([]);
    // Only a gate that passed before is compared: lint did, tests was the failure being fixed.
    const gates = (decision?.abstentions ?? []).filter((abstention) =>
      abstention.measure.startsWith("gate:"),
    );
    expect(gates.map((abstention) => abstention.measure)).toEqual(["gate:lint"]);
    expect(gates[0]?.reason).toContain("could not be run in this attempt");
    // The fix stands in the tree: nothing measured it, and nothing measured against it either.
    expect(test.workspace.files.get(sourcePath)).toBe(fixedSource);
    expect(outcome.finalCycle.statuses).toEqual({
      tests: "not-applicable",
      lint: "not-applicable",
    });
    expect(outcome.escalation).toMatchObject({
      gateId: "unmeasured",
      title: "the gates could not be run",
      attemptsRejectedByRatchet: 0,
      failingAtBase: [],
    });
    expect(outcome.escalation?.reason).toContain("tests, lint could not be run");
    expect(outcome.escalation?.reason).toContain("no time remained in the wall budget");
    expect(outcome.escalation?.reason).toContain("is not a pass");
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

describe("the attempt after a rollback", () => {
  it("is told what the rolled-back candidate fixed, broke and why it was refused, from the restored workspace", async () => {
    const test = harness({ cap: 2 });
    const requests: ResolveRequest[] = [];
    const seenSource: (string | undefined)[] = [];

    // Attempt 1 fixes the failing tests and breaks lint, as mime launch 11's second repair fixed
    // the planned check and broke seven project tests. Attempt 2 then fixes it properly.
    const outcome = await test.run((request) => {
      requests.push(request);
      seenSource.push(test.workspace.files.get(sourcePath));
      test.workspace.write(sourcePath, request.attempt === 1 ? lintOffendingSource : fixedSource);
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("green");
    expect(requests[0]?.rejected).toBeNull();
    const second = requests[1];
    // It starts from the restored workspace, and the restored cycle is still the one it is in.
    expect(seenSource[1]).toBe(brokenSource);
    expect(second?.cycle.attempt).toBe(0);
    expect(second?.gateOutput).toContain("gate tests");
    // And it is told about the regression the rejected candidate introduced.
    expect(second?.rejected).toMatchObject({
      attempt: 1,
      improved: ["tests"],
      regressed: ["lint"],
      changedFiles: [sourcePath],
    });
    expect(second?.rejected?.reason).toBe(outcome.attempts[0]?.decision.detail);
    expect(second?.rejected?.failures).toContain('"var" is not allowed');
    expect(second?.rejected?.ratchetRecord).toBe(outcome.attempts[0]?.ratchetRecord);

    const brief = describeRejectedCandidate(second?.rejected as RejectedCandidate);
    expect(brief).toContain("Attempt 1 was rolled back");
    expect(brief).toContain("Gates it fixed: tests. Gates it broke: lint.");
    // The rejected change itself, against the restored file the worker is editing, since a
    // worker cannot read the evidence record the brief names.
    expect(second?.rejected?.diff).toBe(
      [
        `--- ${sourcePath} (restored)`,
        `+++ ${sourcePath} (rejected attempt)`,
        "@@ -1,4 +1,5 @@",
        " export function add(a: number, b: number): number {",
        "-  return a - b;",
        "+  var sum = a + b;",
        "+  return sum;",
        " }",
        " ",
      ].join("\n"),
    );
    expect(brief).toContain("The rejected change, against the files as they are now");
    expect(brief).toContain("+  var sum = a + b;");

    // The rejected files stay retrievable after the workspace was put back.
    const kept = ledgerPayloads("verification-command").find(
      (payload) => payload.rule === "rejected-candidate-v1",
    );
    expect(kept).toMatchObject({
      attempt: 1,
      ratchetRecord: second?.rejected?.ratchetRecord,
      files: [{ path: sourcePath, contents: lintOffendingSource, truncated: false }],
    });
    expect(
      evidence
        .records()
        .find(
          (record) =>
            record.type === "verification-command" &&
            record.payloadDigest === second?.rejected?.candidateRecord,
        ),
    ).toBeDefined();
  });

  it("forgets the rolled-back candidate once a later attempt is accepted", async () => {
    const test = harness({ cap: 3, gates: [testsGate, lintGate] });
    const requests: ResolveRequest[] = [];
    await test.run((request) => {
      requests.push(request);
      // 1: rejected (breaks lint). 2: accepted but still failing tests with lint clean. 3: fixed.
      const next =
        request.attempt === 1
          ? lintOffendingSource
          : request.attempt === 2
            ? brokenSource.replace("a - b", "b - a")
            : fixedSource;
      test.workspace.write(sourcePath, next);
      return Promise.resolve();
    });
    expect(requests[1]?.rejected?.attempt).toBe(1);
    expect(requests[2]?.rejected).toBeNull();
    expect(requests[2]?.cycle.attempt).toBe(2);
  });
});

describe("the ratchet against a retry that deletes the failing tests", () => {
  it("rejects the deletion even though the tests gate turned green, and counts the attempt", async () => {
    const test = harness();

    const outcome = await test.run(() => {
      // Nothing is left to fail, so the gate stops objecting: it now abstains rather than
      // passing, because a runner that collected nothing measured nothing. Either way the
      // ratchet is what has to catch this, and the numbers it reads are unchanged.
      test.workspace.write(testPath, "import { it, expect } from 'vitest';\n");
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts).toHaveLength(3);

    const first = outcome.attempts[0];
    expect(first?.cycle.statuses.tests).toBe("not-applicable");
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
  // A whole-file re-specification: both tests the base declared are gone and both tests here
  // are new. Two fewer assertions than the base, so the ratchet has something to reject and
  // the escape hatch has something to do.
  const respecifiedTests = [
    "import { it, expect } from 'vitest';",
    "import { add } from './math.ts';",
    "it('adds negative numbers', () => {",
    "  expect(add(-1, -2)).toBe(-3);",
    "});",
    "it('adds fractions', () => {",
    "  expect(add(0.5, 0.25)).toBe(0.75);",
    "});",
  ].join("\n");

  const bothNew = ["adds fractions", "adds negative numbers"];

  it("lets a genuinely new specification through without tripping the ratchet", async () => {
    const test = harness();

    const outcome = await test.run(
      () => {
        test.workspace.write(sourcePath, fixedSource);
        test.workspace.write(testPath, respecifiedTests);
        return Promise.resolve();
      },
      createStubBaseControl(() => ({
        onBase: "failed",
        onSubmitted: "passed",
        failedOnBase: bothNew,
      })),
    );

    expect(outcome.settled).toBe("green");
    expect(outcome.attempts[0]?.decision.accepted).toBe(true);
    expect(outcome.attempts[0]?.decision.newSpecifications).toEqual(
      bothNew.map((name) => `${testPath}::${name}`),
    );
  });

  it("catches a deletion sitting beside a single new specification", async () => {
    // The hole granularity closes: one proven new specification used to exempt the whole
    // file, so every deletion beside it travelled through unexamined. It pays for one.
    const test = harness();

    const outcome = await test.run(
      () => {
        test.workspace.write(sourcePath, fixedSource);
        test.workspace.write(
          testPath,
          [
            "import { it, expect } from 'vitest';",
            "import { add } from './math.ts';",
            "it('adds negative numbers', () => {",
            "  expect(add(-1, -2)).toBe(-3);",
            "});",
          ].join("\n"),
        );
        return Promise.resolve();
      },
      createStubBaseControl(() => ({
        onBase: "failed",
        onSubmitted: "passed",
        failedOnBase: ["adds negative numbers"],
      })),
    );

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts[0]?.decision.accepted).toBe(false);
    expect(outcome.attempts[0]?.decision.violations.map((violation) => violation.kind)).toContain(
      "tests-declared-decreased",
    );
    // The new specification is still recognized as one; what it does not do is cover the
    // second deletion as well.
    expect(outcome.attempts[0]?.decision.newSpecifications).toEqual([
      `${testPath}::adds negative numbers`,
    ]);
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
      createStubBaseControl(() => ({
        onBase: "failed",
        onSubmitted: "passed",
        failedOnBase: bothNew,
      })),
    );

    const decision = ledgerPayloads("ratchet-decision")[0];
    expect(decision?.respecification).toEqual([
      {
        file: testPath,
        exempt: true,
        newSpecifications: bothNew,
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
      outstandingJustifications(outcome.finalCycle, justifiedRecords(evidence)).map(
        (gate) => gate.gateId,
      ),
    ).toEqual(["diff-budget"]);

    await evidence.submitClaim(
      {
        predicate: "measures.changedFiles >= 1",
        record: budget?.record ?? null,
        recordKind: "gate-run:diff-budget",
        narrative: "the fix touches one file and the budget was set to zero for this test",
      },
      "model",
    );

    expect(outstandingJustifications(outcome.finalCycle, justifiedRecords(evidence))).toEqual([]);
  });
});

/**
 * Twenty-eight campaign runs escalated at a lint, format or typecheck gate that failed on the
 * base tree exactly as it failed after the run: clippy missing from an image, mypy over four
 * hundred untyped files, gofmt over a module cache. The model was told the gate failed and
 * spent its attempts on it. The base is measured now, and a failure it already has is named.
 */
describe("a gate that fails at the base commit too", () => {
  const preexistingLint = 'src/math.ts: "var" is not allowed';

  it("is named to the model and in the escalation, and recorded as a gate-baseline run", async () => {
    const requests: string[] = [];
    const subject = harness({
      cap: 1,
      atBase: (gate) =>
        gate.id === "lint" ? { exitCode: 1, stdout: preexistingLint } : { exitCode: 0, stdout: "" },
    });
    subject.workspace.write(sourcePath, lintOffendingSource);

    const outcome = await subject.run((request) => {
      requests.push(request.gateOutput);
      subject.workspace.write(sourcePath, lintOffendingSource);
      return Promise.resolve();
    });

    expect(outcome.settled).toBe("escalated");
    expect(requests[0]).toContain("gate lint (lint) FAILED");
    expect(requests[0]).toContain("fails the same way at the base commit");
    expect(requests[0]).not.toContain("gate tests (tests) FAILED: fails the same way");
    expect(outcome.escalation?.failingAtBase).toEqual(["lint"]);
    // Only the gate that failed is measured at the base: the tests pass here and are not.
    const baselines = evidence.records().filter((record) => record.type === "gate-baseline");
    expect(baselines).toHaveLength(1);
    expect(evidence.payloads().get(baselines[0]?.payloadDigest ?? "")).toMatchObject({
      gateId: "lint",
      status: "failed",
      stdout: preexistingLint,
    });
  });

  it("is not named where the base failed differently, or passed", async () => {
    const requests: string[] = [];
    const subject = harness({
      cap: 1,
      atBase: (gate) =>
        gate.id === "lint"
          ? { exitCode: 1, stdout: "src/other.ts: unused import" }
          : { exitCode: 0, stdout: "" },
    });
    subject.workspace.write(sourcePath, lintOffendingSource);

    const outcome = await subject.run((request) => {
      requests.push(request.gateOutput);
      return Promise.resolve();
    });

    expect(requests[0]).not.toContain("fails the same way at the base commit");
    expect(outcome.escalation?.failingAtBase).toEqual([]);
  });

  it("names nothing where nothing can measure the base", async () => {
    const subject = harness({ cap: 1 });
    subject.workspace.write(sourcePath, lintOffendingSource);

    const outcome = await subject.run(() => Promise.resolve());

    expect(outcome.escalation?.failingAtBase).toEqual([]);
    expect(evidence.records().some((record) => record.type === "gate-baseline")).toBe(false);
  });
});

describe("a follow-up owed on work no gate measures", () => {
  const owed: OwedFollowUp = {
    identity: "sha256:outcomes",
    brief: "Requested behaviour no sealed check exercises: add(2, 3) gives 5.",
  };
  const followUps = () =>
    ledgerPayloads("verification-command").filter((one) => one.rule === "outcome-follow-up-v1");

  it("is given once, as an attempt, when the gates are already green, and never again", async () => {
    const test = harness({ followUp: owed });
    test.workspace.write(sourcePath, fixedSource);
    const requests: ResolveRequest[] = [];
    const outcome = await test.run((request) => {
      requests.push(request);
      return Promise.resolve();
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ attempt: 1, followUp: owed.brief, gateOutput: "" });
    expect(outcome.settled).toBe("green");
    expect(outcome.followUp).toMatchObject({
      identity: owed.identity,
      state: "given",
      attempt: 1,
      accepted: true,
    });
    expect(followUps()).toEqual([
      expect.objectContaining({ state: "given", attempt: 1, accepted: true }),
    ]);
  });

  it("comes after the repairs the gates asked for, from the same cap", async () => {
    const test = harness({ followUp: owed });
    const requests: ResolveRequest[] = [];
    const outcome = await test.run((request) => {
      requests.push(request);
      if (request.attempt === 1) test.workspace.write(sourcePath, fixedSource);
      return Promise.resolve();
    });
    expect(requests.map((one) => one.followUp === undefined)).toEqual([true, false]);
    expect(outcome.followUp).toMatchObject({ state: "given", attempt: 2 });
  });

  it("rolls back a follow-up that breaks a passing gate, and leaves the run green on the state before it", async () => {
    const test = harness({ followUp: owed });
    test.workspace.write(sourcePath, fixedSource);
    const outcome = await test.run(() => {
      test.workspace.write(sourcePath, brokenSource);
      return Promise.resolve();
    });
    expect(outcome.followUp).toMatchObject({ state: "given", attempt: 1, accepted: false });
    expect(test.workspace.files.get(sourcePath)).toBe(fixedSource);
    expect(outcome.settled).toBe("green");
    expect(outcome.attempts).toHaveLength(1);
  });

  it("is withheld, and says why, when the cap was spent on what the gates measured", async () => {
    const test = harness({ cap: 1, followUp: owed });
    const outcome = await test.run(() => {
      test.workspace.write(sourcePath, fixedSource);
      return Promise.resolve();
    });
    expect(outcome.settled).toBe("green");
    expect(outcome.followUp).toMatchObject({
      state: "withheld",
      attempt: null,
      reason: "no attempt was left under the cap of 1",
    });
  });

  it("is withheld when the gates never went green, rather than spending an attempt beside a failure", async () => {
    const test = harness({ cap: 2, followUp: owed });
    const outcome = await test.run(() => Promise.resolve());
    expect(outcome.settled).toBe("escalated");
    expect(outcome.followUp).toMatchObject({
      state: "withheld",
      reason: expect.stringContaining("the gates were not green"),
    });
  });

  it("is withheld with the budget's own reason when too little remains for an attempt", async () => {
    const test = harness({ followUp: owed });
    test.workspace.write(sourcePath, fixedSource);
    const outcome = await test.run(() =>
      Promise.reject(new Error("repair stopped: no usable budget remains for attempt 1")),
    );
    expect(outcome.followUp).toMatchObject({
      state: "withheld",
      attempt: null,
      reason: expect.stringContaining("no usable budget remains"),
    });
    expect(outcome.settled).toBe("green");
  });
});

describe("the continuation owed to a task loop that stopped at its step limit", () => {
  const owedContinuation: OwedFollowUp = {
    identity: "sha256:continuation",
    brief:
      "The task's first loop stopped at its step limit before it reported the task done; finish what the task still requires.",
  };
  const owedOutcomes: OwedFollowUp = {
    identity: "sha256:outcomes",
    brief: "Requested behaviour no sealed check exercises: add(2, 3) gives 5.",
  };
  const continuations = () =>
    ledgerPayloads("verification-command").filter((one) => one.rule === "task-continuation-v1");

  it("is given once the gates are green, as an attempt from the cap, before any outcome follow-up", async () => {
    const test = harness({ continuation: owedContinuation, followUp: owedOutcomes });
    test.workspace.write(sourcePath, fixedSource);
    const requests: ResolveRequest[] = [];
    const outcome = await test.run((request) => {
      requests.push(request);
      return Promise.resolve();
    });
    expect(requests.map((one) => [one.attempt, one.followUpKind, one.followUp])).toEqual([
      [1, "continuation", owedContinuation.brief],
      [2, "outcomes", owedOutcomes.brief],
    ]);
    expect(outcome.settled).toBe("green");
    expect(outcome.continuation).toMatchObject({
      identity: owedContinuation.identity,
      state: "given",
      attempt: 1,
      accepted: true,
    });
    expect(outcome.followUp).toMatchObject({ state: "given", attempt: 2, accepted: true });
    expect(continuations()).toEqual([
      expect.objectContaining({ state: "given", attempt: 1, accepted: true }),
    ]);
  });

  it("comes after the narrow repair the gates asked for, from the same cap", async () => {
    const test = harness({ continuation: owedContinuation });
    const requests: ResolveRequest[] = [];
    const outcome = await test.run((request) => {
      requests.push(request);
      if (request.attempt === 1) test.workspace.write(sourcePath, fixedSource);
      return Promise.resolve();
    });
    expect(requests.map((one) => one.followUpKind ?? "repair")).toEqual(["repair", "continuation"]);
    expect(outcome.continuation).toMatchObject({ state: "given", attempt: 2, accepted: true });
    expect(outcome.settled).toBe("green");
  });

  it("keeps a continuation that adds a test the base lacks, and accounts for the added test from the harness's own measures", async () => {
    const test = harness({ continuation: owedContinuation });
    test.workspace.write(sourcePath, fixedSource);
    const added = `${originalTests}\nit('adds negatives', () => {\n  expect(add(-1, -2)).toBe(-3);\n});\n`;
    const outcome = await test.run(
      () => {
        test.workspace.write(testPath, added);
        return Promise.resolve();
      },
      createStubBaseControl(() => ({
        onBase: "failed",
        onSubmitted: "passed",
        failedOnBase: ["adds negatives"],
      })),
    );
    expect(outcome.continuation).toMatchObject({ state: "given", attempt: 1, accepted: true });
    expect(test.workspace.files.get(testPath)).toBe(added);
    expect(outcome.regressionTests).toMatchObject({
      testsGate: "passed",
      files: [
        {
          path: testPath,
          testsAdded: ["adds negatives"],
          testsRemoved: [],
          assertionsAdded: 1,
          onBaseSource: { outcome: "failed", failedTests: ["adds negatives"] },
        },
      ],
    });
    expect(ledgerPayloads("verification-command")).toContainEqual(
      expect.objectContaining({ rule: "regression-tests-v1", testsGate: "passed" }),
    );
  });

  it("says when no test file changed, and when nothing can run the added tests on the base's source", async () => {
    const test = harness({ continuation: owedContinuation });
    test.workspace.write(sourcePath, fixedSource);
    const untouched = await test.run(() => Promise.resolve());
    expect(untouched.regressionTests).toMatchObject({ files: [], testsGate: "passed" });
    const again = harness({ continuation: owedContinuation });
    again.workspace.write(sourcePath, fixedSource);
    const added = `${originalTests}\nit('adds negatives', () => {\n  expect(add(-1, -2)).toBe(-3);\n});\n`;
    const unmeasured = await again.run(() => {
      again.workspace.write(testPath, added);
      return Promise.resolve();
    }, null);
    expect(unmeasured.regressionTests?.files[0]).toMatchObject({
      testsAdded: ["adds negatives"],
      onBaseSource: null,
    });
  });

  it("rolls back a continuation that weakens the tests, and leaves the run green on the state before it", async () => {
    const test = harness({ continuation: owedContinuation });
    test.workspace.write(sourcePath, fixedSource);
    const weakened = originalTests.replace("  expect(add(2, 2)).toBe(4);\n", "");
    const outcome = await test.run(() => {
      test.workspace.write(testPath, weakened);
      return Promise.resolve();
    });
    expect(outcome.continuation).toMatchObject({ state: "given", attempt: 1, accepted: false });
    expect(test.workspace.files.get(testPath)).toBe(originalTests);
    expect(outcome.settled).toBe("green");
    expect(outcome.attempts).toHaveLength(1);
  });

  it("is withheld, and says why, when the cap was spent on repairs or the gates never went green", async () => {
    const spent = harness({ cap: 1, continuation: owedContinuation });
    const first = await spent.run(() => {
      spent.workspace.write(sourcePath, fixedSource);
      return Promise.resolve();
    });
    expect(first.settled).toBe("green");
    expect(first.continuation).toMatchObject({
      state: "withheld",
      attempt: null,
      reason: "no attempt was left under the cap of 1",
    });
    const never = harness({ cap: 2, continuation: owedContinuation });
    const second = await never.run(() => Promise.resolve());
    expect(second.settled).toBe("escalated");
    expect(second.continuation).toMatchObject({
      state: "withheld",
      reason: expect.stringContaining("the gates were not green"),
    });
  });
});

describe("the experimental review of a green candidate", () => {
  const reviewOf = (
    examined: { brief: string | null },
    calls: string[],
    measured: () => Record<string, "passed" | "failed"> = () => ({}),
  ): CandidateReviewHook => ({
    examine: () => {
      calls.push("examine");
      return Promise.resolve({
        identity: "review sha256:probes",
        brief: examined.brief,
        parts: { "probe: kept": "passed", "probe: requested": "failed" },
        claims: ["probe: requested"],
        record: "sha256:examination",
      });
    },
    measure: () => {
      calls.push("measure");
      return Promise.resolve({ parts: measured(), claims: ["probe: requested"] });
    },
    withhold: (reason) => {
      calls.push(`withhold: ${reason}`);
      return Promise.resolve("sha256:withheld");
    },
  });
  const source = (marker: string) => `${fixedSource}\n// ${marker}\n`;
  const reading = (test: Harness) => () => {
    const now = test.workspace.files.get(sourcePath) ?? "";
    return {
      "probe: kept": now.includes("BROKE_KEPT") ? ("failed" as const) : ("passed" as const),
      "probe: requested": now.includes("MET_REQUEST") ? ("passed" as const) : ("failed" as const),
    };
  };

  it("is examined once the gates are green, before the follow-up on outcomes, and its findings get one attempt", async () => {
    const calls: string[] = [];
    const owed = { identity: "sha256:outcomes", brief: "outcomes" };
    let test: Harness | null = null;
    test = harness({
      followUp: owed,
      review: reviewOf({ brief: "Probe probe, case 1 (missed-requirement)" }, calls, () =>
        reading(test as Harness)(),
      ),
    });
    test.workspace.write(sourcePath, fixedSource);
    const requests: ResolveRequest[] = [];
    const outcome = await test.run((request) => {
      requests.push(request);
      calls.push(`attempt ${request.attempt} ${request.followUpKind}`);
      if (request.followUpKind === "review")
        test?.workspace.write(sourcePath, source("MET_REQUEST"));
      return Promise.resolve();
    });
    // The review is asked before the follow-up on outcomes, whose brief rides in its attempt.
    expect(calls).toEqual(["examine", "attempt 1 review", "measure"]);
    expect(requests[0]?.followUp).toContain("missed-requirement");
    expect(requests[0]?.followUp).toContain("outcomes");
    expect(outcome.review).toMatchObject({ state: "given", attempt: 1, accepted: true });
    expect(outcome.followUp).toMatchObject({ state: "given", attempt: 1, accepted: true });
    expect(outcome.reviewExamination).toBe("sha256:examination");
    const decision = ledgerPayloads("ratchet-decision").find((one) => one.attempt === 1) as {
      parts: { before: Record<string, unknown>; after: Record<string, unknown> };
    };
    expect(decision.parts.before["candidate-review"]).toEqual({
      "probe: kept": "passed",
      "probe: requested": "failed",
    });
    expect(decision.parts.after["candidate-review"]).toEqual({
      "probe: kept": "passed",
      "probe: requested": "passed",
    });
  });

  it("owes nothing where the review established nothing", async () => {
    const calls: string[] = [];
    const test = harness({ review: reviewOf({ brief: null }, calls) });
    test.workspace.write(sourcePath, fixedSource);
    let attempts = 0;
    const outcome = await test.run(() => {
      attempts += 1;
      return Promise.resolve();
    });
    expect(attempts).toBe(0);
    expect(calls).toEqual(["examine"]);
    expect(outcome.reviewExamination).toBe("sha256:examination");
    expect(outcome.review).toBeNull();
    expect(outcome.settled).toBe("green");
  });

  it("rolls back an attempt that meets the review's request by breaking a case its kept part held", async () => {
    const calls: string[] = [];
    let test: Harness | null = null;
    test = harness({
      review: reviewOf({ brief: "findings" }, calls, () => reading(test as Harness)()),
    });
    test.workspace.write(sourcePath, fixedSource);
    const outcome = await test.run(() => {
      test?.workspace.write(sourcePath, source("MET_REQUEST BROKE_KEPT"));
      return Promise.resolve();
    });
    expect(outcome.review).toMatchObject({ state: "given", accepted: false });
    expect(test.workspace.files.get(sourcePath)).toBe(fixedSource);
    expect(outcome.settled).toBe("green");
    const decision = ledgerPayloads("ratchet-decision").find((one) => one.attempt === 1) as {
      violations: { kind: string; detail: string }[];
    };
    expect(decision.violations).toEqual([
      expect.objectContaining({
        kind: "gate-part-regressed",
        detail:
          "probe: kept in the candidate-review readings passed before this attempt and now reports failed",
      }),
    ]);
    // The bundled verifier re-derives the same refusal from the decision's own record.
    expect(rederiveRatchet(decision).violations).toEqual(["gate-part-regressed"]);
  });

  it("waits for the task's continuation, and says so when no attempt is left to act on a finding", async () => {
    const calls: string[] = [];
    const test = harness({
      cap: 1,
      continuation: { identity: "sha256:continuation", brief: "continue" },
      review: reviewOf({ brief: "findings" }, calls),
    });
    test.workspace.write(sourcePath, fixedSource);
    const outcome = await test.run((request) => {
      calls.push(`attempt ${request.attempt} ${request.followUpKind}`);
      return Promise.resolve();
    });
    expect(calls).toEqual([
      "attempt 1 continuation",
      "withhold: no attempt was left under the cap of 1 for what a review could find",
    ]);
    expect(outcome.reviewExamination).toBe("sha256:withheld");
    expect(outcome.review).toBeNull();
  });
});
