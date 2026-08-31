import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { createFileCoverageArtifactStore } from "./coverage-artifact.ts";
import { assembleGates } from "./default-gates.ts";
import { runGateCycle } from "./gate-runner.ts";
import { takeMeasureSnapshot } from "./measure-snapshot.ts";
import { emptyTestFileMeasures } from "./measures.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { testOutputParser } from "./parsers.ts";
import { detectProject } from "./project-type.ts";
import { judgeRatchet } from "./ratchet.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

/**
 * The ratchet's job is to hold numbers that the code under measurement cannot move at will.
 * These run the real gate against a real workspace whose test file is trying to move them.
 */

let workspace = "";
let outside = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-trust-workspace-"));
  // The session store, which invariant 11 keeps outside the workspace and denies to tools.
  outside = await mkdtemp(join(tmpdir(), "swarm-trust-session-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const source = "export const one = 1;\n";

/** A test file that prints the TAP counters a reader might mistake for the runner's own. */
const forgingTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { one } from "./one.mjs";',
  'test("the only real test", () => {',
  '  console.log("# tests 999");',
  '  console.log("# pass 999");',
  '  console.log("# fail 0");',
  '  console.log("# skipped 0");',
  "  assert.equal(one, 1);",
  "});",
  "",
].join("\n");

const honestTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { one } from "./one.mjs";',
  'test("the only real test", () => {',
  "  assert.equal(one, 1);",
  "});",
  "",
].join("\n");

interface Measured {
  readonly collected: number | null;
  readonly skipped: number | null;
  readonly detail: string;
}

/** Runs the assembled tests gate for real, and reads the arm the way the ratchet does. */
async function measureThroughTheGate(sessionId: string, testFile: string): Promise<Measured> {
  await writeFile(join(workspace, "one.mjs"), source);
  await writeFile(join(workspace, "one.test.mjs"), testFile);
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({ name: "scratch", scripts: { test: "node --test" } }),
  );

  const probe = createMemoryWorkspace({
    base: { "one.mjs": "export const nothing = 0;\n" },
    current: { "one.mjs": source },
  });
  const gates = assembleGates(
    await detectProject(async (path) =>
      path === "package.json"
        ? JSON.stringify({ name: "scratch", scripts: { test: "node --test" } })
        : null,
    ),
    { coverageArtifactDirectory: join(outside, "coverage") },
  );

  const cycle = await runGateCycle(
    gates.filter((gate) => gate.id === "tests"),
    {
      workspaceRoot: workspace,
      changes: await probe.changes(),
      fileSet: {
        declared: ["one.mjs"],
        amendments: [],
        allowed: new Set(["one.mjs"]),
        wasDeclared: true,
        editedBeforeAuthorized: [],
      },
      budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
      probe,
    },
    0,
    {
      commands: createNodeCommandRunner(createTestClock(1)),
      evidence: await openEvidenceSession({
        root: join(outside, "sessions"),
        sessionId,
        clock: createTestClock(1),
      }),
      emit: () => undefined,
      coverageArtifacts: createFileCoverageArtifactStore(),
    },
  );

  const measured = await takeMeasureSnapshot({
    changes: await probe.changes(),
    probe,
    workspaceRoot: workspace,
    trackedTestFiles: [],
    coverageReports: cycle.coverageReports,
    testReports: cycle.testReports,
  });

  return {
    collected: measured.testsCollected,
    skipped: measured.testsSkippedByRunner,
    detail: cycle.runs[0]?.detail ?? "",
  };
}

describe("the collected count, against a test that prints its own", () => {
  it("counts what the runner reported, not what the test printed", async () => {
    const measured = await measureThroughTheGate("forged-counters", forgingTest);

    expect(measured.collected).toBe(1);
    expect(measured.skipped).toBe(0);
  }, 30_000);

  it("reads the same number for the honest file, so the arm is not simply broken", async () => {
    const measured = await measureThroughTheGate("honest-counters", honestTest);

    expect(measured.collected).toBe(1);
  }, 30_000);

  it("does not even print the forged number, because the vouched run picks the reporter", async () => {
    // Node's TAP reporter escapes a leading # in captured output, so on the arm the harness
    // built the forgery does not reach the detail line either. That is a property of one
    // reporter rather than of the channel, which is why the count is read from the artifact
    // and not from here: the arm the harness cannot vouch for still runs the default reporter,
    // and that one passes the four lines straight through.
    const forged = await measureThroughTheGate("forged-detail", forgingTest);

    expect(forged.detail).not.toContain("999");
    expect(forged.collected).toBe(1);
  }, 30_000);
});

describe("the parser that used to feed the ratchet", () => {
  it("still lands on the forged number, which is why nothing numeric reads it now", () => {
    // Kept as a standing demonstration rather than deleted. The reading is unchanged; what
    // changed is that MeasureSnapshot no longer asks it anything.
    const stdout = [
      "# tests 999",
      "# pass 999",
      "# fail 0",
      "# skipped 0",
      "ℹ tests 1",
      "ℹ pass 1",
      "ℹ fail 0",
      "ℹ skipped 0",
    ].join("\n");

    const reading = testOutputParser({
      exitCode: 0,
      stdout,
      stderr: "",
      durationMs: 1,
      unavailable: null,
    });

    expect(reading.measures.testsCollected).toBe(999);
  });
});

describe("what the ratchet does with a measure nothing vouched for", () => {
  function snapshot(collected: number | null) {
    return {
      perTestFile: { "a.test.ts": emptyTestFileMeasures },
      perTestFileAtBase: { "a.test.ts": emptyTestFileMeasures },
      testsCollected: collected,
      testsSkippedByRunner: null,
      changedLineCoverage: null,
      changedLinesCovered: null,
      changedLinesMeasured: null,
    };
  }

  it("abstains by name rather than defaulting to a pass", () => {
    const decision = judgeRatchet({
      baselineGates: {},
      candidateGates: {},
      baseline: snapshot(null),
      candidate: snapshot(null),
    });

    expect(decision.accepted).toBe(true);
    expect(decision.abstentions.map((abstention) => abstention.measure)).toContain(
      "testsCollected",
    );
    // Visible in the sentence a person reads, not only in the payload.
    expect(decision.detail).toContain("not compared");
    expect(decision.detail).toContain("testsCollected");
  });

  it("abstains rather than comparing a number only one side measured", () => {
    const decision = judgeRatchet({
      baselineGates: {},
      candidateGates: {},
      baseline: snapshot(40),
      candidate: snapshot(null),
    });

    expect(decision.violations).toEqual([]);
    expect(decision.abstentions).toContainEqual({
      measure: "testsCollected",
      reason: "it was measured on only one side of the attempt, so there is nothing to compare",
    });
  });

  it("still rejects a drop where both sides were measured", () => {
    const decision = judgeRatchet({
      baselineGates: {},
      candidateGates: {},
      baseline: snapshot(40),
      candidate: snapshot(39),
    });

    expect(decision.accepted).toBe(false);
    expect(decision.violations.map((violation) => violation.kind)).toEqual([
      "tests-collected-decreased",
    ]);
  });
});
