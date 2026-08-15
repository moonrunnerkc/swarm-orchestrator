import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../core/clock.ts";
import type { LoopEvent } from "../core/loop-events.ts";
import { bundleSourceFromRecorder, exportBundle, readBundle } from "../evidence/bundle.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { createEphemeralSigningKey } from "../evidence/signing.ts";
import type { ResolveAttempt } from "./auto-resolve.ts";
import { runGatesEngine } from "./engine.ts";
import { describeEscalation } from "./escalation.ts";
import { createFileSetRegistry, type FileSetRegistry } from "./file-set.ts";

/**
 * The phase acceptance run, against a real git repository with real test execution. The
 * unit tests prove the ratchet's arithmetic; this proves the whole path, including that the
 * attempt history survives into a bundle a reviewer can open.
 */

const run = promisify(execFile);

let workspace = "";
let sessionRoot = "";
let evidence: EvidenceRecorder;
let fileSet: FileSetRegistry;
let events: LoopEvent[] = [];

const wallClock: Clock = {
  now: () => 1_700_000_000_000,
  sleep: () => Promise.resolve(),
};

const correctSource = [
  "export function add(a, b) {",
  "  return a + b;",
  "}",
  "",
  "export function classify(value) {",
  "  if (value < 0) {",
  "    return 'negative';",
  "  }",
  "  return 'other';",
  "}",
  "",
].join("\n");

const brokenSource = correctSource.replace("return a + b;", "return a - b;");

const seededTests = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { add, classify } from './math.js';",
  "",
  "test('adds', () => {",
  "  assert.equal(add(1, 2), 3);",
  "  assert.equal(add(2, 2), 4);",
  "});",
  "",
  "test('classifies negatives', () => {",
  "  assert.equal(classify(-1), 'negative');",
  "  assert.equal(classify(-5), 'negative');",
  "});",
  "",
].join("\n");

const lintScript = [
  "import { readFileSync, readdirSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "let offenders = 0;",
  "for (const name of readdirSync('src')) {",
  "  const text = readFileSync(join('src', name), 'utf8');",
  "  if (/\\bvar\\s/.test(text)) {",
  '    console.log("src/" + name + ": var is not allowed");',
  "    offenders += 1;",
  "  }",
  "}",
  "process.exit(offenders === 0 ? 0 : 1);",
  "",
].join("\n");

async function git(...args: string[]): Promise<void> {
  await run("git", args, { cwd: workspace });
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(join(workspace, path, ".."), { recursive: true });
  await writeFile(join(workspace, path), contents, "utf8");
}

/** A repository whose committed state already carries the failing test. */
async function seedRepository(source: string, testScript = "node --test"): Promise<void> {
  const manifest = {
    name: "scratch",
    type: "module",
    scripts: {
      test: testScript,
      lint: "node tools/lint.mjs",
    },
  };
  await write("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await write("src/math.js", source);
  await write("src/math.test.js", seededTests);
  await write("tools/lint.mjs", lintScript);

  await git("init", "--quiet");
  await git("config", "user.email", "gates@example.com");
  await git("config", "user.name", "gates");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "seed");
}

const gateOverrides = {
  // Direct commands rather than npm wrappers: the same gate definitions, without paying
  // for a package manager on every one of a dozen runs.
  tests: "node --test",
  lint: "node tools/lint.mjs",
  typecheck: "node --check src/math.js",
  format: "node --check src/math.test.js",
};

function runGates(resolve: ResolveAttempt, cap = 3) {
  return runGatesEngine({
    workspaceRoot: workspace,
    baseRef: "HEAD",
    evidence,
    fileSet,
    clock: wallClock,
    emit: (event) => {
      events.push(event);
    },
    resolve,
    cap,
    gateOptions: { commandOverrides: gateOverrides },
    // No override for the control runs: the seeded project declares node's own runner, so the
    // engine builds the control command the way it does in production, artifact and all. The
    // override this replaces printed TAP and wrote no artifact, which now attributes nothing.
  });
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-acceptance-"));
  sessionRoot = await mkdtemp(join(tmpdir(), "swarm-acceptance-session-"));
  evidence = await openEvidenceSession({
    root: sessionRoot,
    sessionId: "acceptance-session",
    clock: wallClock,
  });
  fileSet = createFileSetRegistry(evidence);
  events = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(sessionRoot, { recursive: true, force: true });
});

describe("acceptance 1: a seeded failing test is auto-resolved within the cap", () => {
  it("fixes the source, reports green, and leaves the whole attempt history in the bundle", async () => {
    await seedRepository(brokenSource);
    await fileSet.declare(["src/math.js"], "model");

    const { gates, outcome } = await runGates(async () => {
      await write("src/math.js", correctSource);
    });

    expect(outcome.settled).toBe("green");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.firstCycle.statuses.tests).toBe("failed");
    expect(outcome.finalCycle.statuses.tests).toBe("passed");

    const destination = join(sessionRoot, "bundle");
    await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination,
      signingKey: createEphemeralSigningKey(),
      clock: wallClock,
    });

    const bundle = await readBundle(destination);
    const gateRuns = bundle.records.filter((record) => record.type === "gate-run");
    const ratchets = bundle.records.filter((record) => record.type === "ratchet-decision");

    // Two cycles of the full gate set, the attempt that separated them, and the final state
    // judged against the base commit.
    expect(gateRuns.length).toBe(gates.length * 2);
    expect(
      ratchets.map(
        (record) => (bundle.payloads.get(record.payloadDigest) as { scope?: string }).scope,
      ),
    ).toEqual(["retry", "base"]);

    const failing = gateRuns
      .map((record) => bundle.payloads.get(record.payloadDigest) as Record<string, unknown>)
      .find((payload) => payload.gateId === "tests" && payload.attempt === 0);
    expect(String(failing?.stdout)).toContain("# fail 1");
    expect(failing?.measures).toMatchObject({ testsCollected: 2, testsFailed: 1 });

    // The embedded verifier is what a reviewer runs, so the bundle has to satisfy it.
    const verified = await run("node", [join(destination, "verify.mjs"), destination]);
    expect(verified.stdout).toContain("every check passed");
  }, 60_000);
});

describe("acceptance 2: an oscillation escalates rather than looping", () => {
  it("rejects each regression, restores the workspace, and stops at the cap", async () => {
    await seedRepository(brokenSource);
    await fileSet.declare(["src/math.js"], "model");

    // Fixing the test breaks lint. The ratchet never accepts the trade, so the loop cannot
    // ping-pong: it spends its attempts and escalates.
    const { outcome } = await runGates(async () => {
      await write(
        "src/math.js",
        correctSource.replace("return a + b;", "var sum = a + b;\n  return sum;"),
      );
    });

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts).toHaveLength(3);
    expect(outcome.attempts.every((attempt) => !attempt.decision.accepted)).toBe(true);
    expect(outcome.attempts[0]?.decision.violations[0]?.kind).toBe("gate-regressed");
    expect(outcome.escalation?.attemptsRejectedByRatchet).toBe(3);

    // The rejected state does not survive: the file is back to what the repository held.
    expect(await readFile(join(workspace, "src/math.js"), "utf8")).toBe(brokenSource);

    const escalation = outcome.escalation;
    if (escalation === null) {
      throw new Error("an escalated run must carry an escalation payload");
    }
    const report = describeEscalation(escalation);
    expect(report).toContain("Escalating after 3 of 3 attempts");
    expect(report).toContain("rejected by the ratchet");
  }, 60_000);
});

describe("acceptance 3: an introduced placeholder blocks", () => {
  it("blocks the TODO even though the tests themselves pass", async () => {
    await seedRepository(brokenSource);
    await fileSet.declare(["src/math.js"], "model");

    const { outcome } = await runGates(async () => {
      await write("src/math.js", `// TODO: handle the zero case properly\n${correctSource}`);
    }, 1);

    expect(outcome.settled).toBe("escalated");
    const placeholder = outcome.attempts[0]?.cycle.runs.find(
      (gate) => gate.gateId === "placeholder",
    );
    expect(placeholder?.status).toBe("failed");
    expect(placeholder?.detail).toContain("TODO: handle the zero case properly");
    // The tests gate really did go green; the placeholder gate is what held the line.
    expect(outcome.attempts[0]?.cycle.statuses.tests).toBe("passed");
  }, 60_000);
});

describe("acceptance 4: holding the tests gate green by deleting the failing tests", () => {
  it("is rejected by the numeric ratchet, and the attempt still counts", async () => {
    await seedRepository(brokenSource);
    await fileSet.declare(["src/math.js", "src/math.test.js"], "model");

    const survivingTest = [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { classify } from './math.js';",
      "",
      "test('classifies negatives', () => {",
      "  assert.equal(classify(-1), 'negative');",
      "});",
      "",
    ].join("\n");

    const { outcome } = await runGates(async () => {
      await write("src/math.test.js", survivingTest);
    }, 2);

    const first = outcome.attempts[0];
    expect(first?.cycle.statuses.tests).toBe("passed");
    expect(first?.decision.accepted).toBe(false);
    expect(first?.decision.violations.map((violation) => violation.kind)).toContain(
      "tests-declared-decreased",
    );
    expect(first?.decision.violations.map((violation) => violation.kind)).toContain(
      "assertions-decreased",
    );
    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.settled).toBe("escalated");
    expect(await readFile(join(workspace, "src/math.test.js"), "utf8")).toBe(seededTests);
  }, 90_000);
});

describe("acceptance 5: a legitimate new specification passes through the escape hatch", () => {
  it("accepts a submitted test that fails on the base commit and passes on the new source", async () => {
    // The repository is green as committed. The task changes behaviour and re-specifies the
    // test for it, which deletes the test that asserted the old behaviour: without the escape
    // hatch the ratchet blocks it.
    await seedRepository(correctSource);
    await fileSet.declare(["src/math.js", "src/math.test.js"], "model");

    // Break the build first so auto-resolve has something to resolve.
    await write("src/math.js", brokenSource);

    const respecifiedSource = correctSource.replace("return 'other';", "return 'non-negative';");
    const respecifiedTests = [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { add, classify } from './math.js';",
      "",
      "test('adds', () => {",
      "  assert.equal(add(1, 2), 3);",
      "  assert.equal(add(2, 2), 4);",
      "});",
      "",
      "test('classifies non-negatives', () => {",
      "  assert.equal(classify(1), 'non-negative');",
      "});",
      "",
    ].join("\n");

    const { outcome } = await runGates(async () => {
      await write("src/math.js", respecifiedSource);
      await write("src/math.test.js", respecifiedTests);
    }, 1);

    expect(outcome.settled).toBe("green");
    expect(outcome.attempts[0]?.decision.accepted).toBe(true);
    // Exactly the re-specified test, named. The exemption is what one test bought, not what
    // the file was granted.
    expect(outcome.attempts[0]?.decision.newSpecifications).toEqual([
      "src/math.test.js::classifies non-negatives",
    ]);

    const finding = outcome.attempts[0]?.respecification[0];
    expect(finding?.exempt).toBe(true);
    expect(finding?.newSpecifications).toEqual(["classifies non-negatives"]);
    expect(finding?.payload.controls.submittedTestOnBaseSource).toContain("failed");
    expect(finding?.payload.controls.submittedTestOnSubmittedSource).toContain("passed");
  }, 90_000);

  it("still catches a test deleted beside the re-specified one", async () => {
    // Granularity is the whole point: the same edit, plus the deletion of a test the
    // re-specification says nothing about. One new specification pays for one deletion.
    await seedRepository(correctSource);
    await fileSet.declare(["src/math.js", "src/math.test.js"], "model");
    await write("src/math.js", brokenSource);

    const respecifiedSource = correctSource.replace("return 'other';", "return 'non-negative';");
    const withDeletion = [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { classify } from './math.js';",
      "",
      "test('classifies non-negatives', () => {",
      "  assert.equal(classify(1), 'non-negative');",
      "});",
      "",
    ].join("\n");

    const { outcome } = await runGates(async () => {
      await write("src/math.js", respecifiedSource);
      await write("src/math.test.js", withDeletion);
    }, 1);

    expect(outcome.settled).toBe("escalated");
    expect(outcome.attempts[0]?.decision.accepted).toBe(false);
    expect(outcome.attempts[0]?.decision.violations.map((violation) => violation.kind)).toContain(
      "tests-declared-decreased",
    );
    // The re-specification is still recognized; it just does not cover the deleted test too.
    expect(outcome.attempts[0]?.decision.newSpecifications).toEqual([
      "src/math.test.js::classifies non-negatives",
    ]);
  }, 90_000);
});

describe("a retry that erodes coverage of the lines it changed", () => {
  it("is rejected on the coverage numeric even though every gate would have gone green", async () => {
    // The corpus calls this shape coverage erosion and dead-branch insertion. It keeps every
    // count the other numerics watch, so only an executed coverage measure sees it.
    const lintingSource = correctSource.replace(
      "  return a + b;",
      "  var total = a - b;\n  return total;",
    );
    await seedRepository(lintingSource);
    await fileSet.declare(["src/math.js"], "model");

    const withCoveredFix = correctSource.replace(
      "  return a + b;",
      "  var total = a + b;\n  return total;",
    );
    const withDeadBranch = correctSource.replace(
      "  return 'other';",
      "  if (value > 1000) {\n    return 'huge';\n  }\n  return 'other';",
    );

    const { outcome } = await runGates(async ({ attempt }) => {
      // Attempt 1 fixes the tests and leaves lint failing. Attempt 2 fixes lint and smuggles
      // in a branch no test reaches.
      await write("src/math.js", attempt === 1 ? withCoveredFix : withDeadBranch);
    }, 2);

    const [first, second] = outcome.attempts;
    expect(first?.decision.accepted).toBe(true);
    expect(second?.cycle.statuses).toMatchObject({ tests: "passed", lint: "passed" });
    expect(second?.decision.accepted).toBe(false);
    expect(second?.decision.violations.map((violation) => violation.kind)).toEqual([
      "changed-line-coverage-decreased",
    ]);
    expect(outcome.settled).toBe("escalated");
  }, 90_000);
});

describe("the gates measure coverage of changed lines from an executed run", () => {
  it("reports the ratio from the runner's own coverage report", async () => {
    await seedRepository(correctSource);
    await fileSet.declare(["src/math.js"], "model");

    // A new branch nothing exercises: the added lines are measured and found uncovered.
    await write(
      "src/math.js",
      correctSource.replace(
        "  return 'other';",
        "  if (value > 1000) {\n    return 'huge';\n  }\n  return 'other';",
      ),
    );

    const { outcome } = await runGates(() => Promise.resolve(), 1);
    const testsRun = outcome.firstCycle.runs.find((gate) => gate.gateId === "tests");

    expect(testsRun?.status).toBe("passed");
    // The number came out of the report the runner wrote, not out of what it printed.
    expect(testsRun?.coverageReport).toContain("SF:");
    expect(outcome.firstCycle.coverageReports).toHaveLength(1);
    // Three lines added, none of them reached by any test, so the ratio is measured and low.
    expect(outcome.finalMeasures.changedLinesMeasured).toBeGreaterThan(0);
    expect(outcome.finalMeasures.changedLineCoverage).toBeLessThan(1);
    expect(outcome.finalMeasures.changedLineCoverage).not.toBeNull();
  }, 60_000);

  it("measures it from the command it assembled itself, with nothing configured", async () => {
    // The case above pre-configures the coverage flag, which is how the arm looked alive
    // while being dead in ordinary use: a project that just declares `node --test` printed
    // no report, so the measure was null on every run and the ratchet abstained forever.
    await seedRepository(correctSource, "node --test");
    await fileSet.declare(["src/math.js"], "model");
    await write(
      "src/math.js",
      correctSource.replace(
        "  return 'other';",
        "  if (value > 1000) {\n    return 'huge';\n  }\n  return 'other';",
      ),
    );

    const { gates, outcome } = await runGatesEngine({
      workspaceRoot: workspace,
      baseRef: "HEAD",
      evidence,
      fileSet,
      clock: wallClock,
      emit: () => undefined,
      resolve: () => Promise.resolve(),
      cap: 1,
      // Everything but the tests gate, so the assembled test command is the thing under test.
      gateOptions: {
        commandOverrides: {
          lint: gateOverrides.lint,
          typecheck: gateOverrides.typecheck,
          format: gateOverrides.format,
        },
      },
    });

    const testsGate = gates.find((gate) => gate.id === "tests");
    expect(testsGate?.source).toMatchObject({
      command: expect.stringContaining("--test-reporter=lcov"),
      coverageArtifact: expect.stringContaining("tests.lcov"),
    });
    expect(outcome.finalMeasures.changedLinesMeasured).toBeGreaterThan(0);
    expect(outcome.finalMeasures.changedLineCoverage).toBeLessThan(1);
  }, 60_000);
});
