import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { assembleGates } from "./default-gates.ts";
import { runGateCycle } from "./gate-runner.ts";
import { harnessReportingCommand } from "./harness-reporting.ts";
import { takeMeasureSnapshot } from "./measure-snapshot.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { processIsolation } from "./node-test-command.ts";
import { detectProject } from "./project-type.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

/**
 * The headline property: a coverage number the harness did not obtain from a runner-authored
 * file is not a coverage number at all. The end-to-end test below runs node's own test runner
 * for real, because the forgery this closes is a test printing a coverage table, and a double
 * that never executes the test cannot demonstrate that it did not work.
 */

describe("the invocation a runner is asked to write a report with", () => {
  it("asks node's runner for lcov, on a stream of its own", () => {
    const argv = harnessReportingCommand("node --test");

    expect(argv).toContain("--experimental-test-coverage");
    expect(argv).toContain("--test-reporter=lcov");
    // Two reporters, two streams, so neither has to be picked out of the other. Naming any
    // reporter replaces the default one, which is why stdout is restated.
    expect(argv).toContain("--test-reporter=tap");
    expect(argv).toContain("--test-reporter-destination=stdout");
    expect(argv).toContain("--test-reporter-destination=stderr");
  });

  it("asks for both reports on streams, and names no file at all", () => {
    // No destination path anywhere. A path is an argument of the spawned process, `ps` hands
    // it to any test that asks, and the file is writable by anything running as the same user.
    const argv = harnessReportingCommand("node --test");

    expect(argv).toContain("--test-reporter-destination=stdout");
    expect(argv).toContain("--test-reporter-destination=stderr");
    expect(argv?.some((argument) => argument.includes(".tap"))).toBe(false);
    expect(argv?.some((argument) => argument.includes(".lcov"))).toBe(false);
  });

  it("puts the flags in front of the file patterns, where node accepts them", () => {
    const argv = harnessReportingCommand("node --test 'src/**/*.test.mjs'");

    expect(argv?.indexOf("--experimental-test-coverage")).toBeLessThan(
      argv?.indexOf("src/**/*.test.mjs") ?? -1,
    );
  });

  it("declines every command it cannot ask for a report, rather than guessing", () => {
    // Null leaves the arm abstaining by name. A guess would leave it reporting a number.
    expect(harnessReportingCommand("vitest run")).toBeNull();
    expect(harnessReportingCommand(undefined)).toBeNull();
    expect(harnessReportingCommand("node --test && node other.mjs")).toBeNull();
    expect(harnessReportingCommand("node --test --test-reporter=spec")).toBeNull();
    expect(harnessReportingCommand("node --test --experimental-test-coverage")).toBeNull();
    // A flag quoted into the position a file pattern goes: there is no shell to unquote it
    // back, and the recognizer reads it as the flag it is rather than as a path.
    expect(harnessReportingCommand("node --test '--test-isolation=none'")).toBeNull();
    expect(harnessReportingCommand("node --test '--require=./hook.cjs'")).toBeNull();
    expect(harnessReportingCommand("node --test '--env-file=.env'")).toBeNull();
  });

  /**
   * This test used to assert the opposite: that a declared `--test-isolation=none` was stripped
   * and replaced. That rewrite lost three times to spellings the strip did not recognize, so
   * the arm no longer corrects a command it did not fully recognize. It abstains, and the
   * ratchet renders the abstention as not measured. Same commit, same reason, every spelling.
   */
  it("abstains on a command that declares an isolation setting of its own", () => {
    const controlled = harnessReportingCommand("node --test");

    expect(controlled).toContain(processIsolation);
    for (const body of [
      "node --test --test-isolation=none 'src/*.test.mjs'",
      'node --test --test-isolation="none"',
      `node --test --test-isolation=\${MODE}`,
      "node --test --test-isolation=process",
    ]) {
      expect({
        body,
        command: harnessReportingCommand(body),
      }).toEqual({
        body,
        command: null,
      });
    }
  });
});

describe("coverage of changed lines comes from a stream the harness owns", () => {
  let workspace = "";
  /** Stands in for the session store, which is where the evidence session lives. */
  let outside = "";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "swarm-coverage-run-"));
    outside = await mkdtemp(join(tmpdir(), "swarm-coverage-session-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  /**
   * clamp has three branches and every test below exercises one of them, so honest coverage of
   * the changed lines is well under 100%. What varies between the cases is how the test tries
   * to say otherwise.
   */
  const source = [
    "export function clamp(value, low, high) {",
    "  if (value < low) {",
    "    return low;",
    "  }",
    "  if (value > high) {",
    "    return high;",
    "  }",
    "  return value;",
    "}",
    "",
  ].join("\n");

  interface Scenario {
    readonly sessionId: string;
    readonly testFile: string;
    readonly testScript: string;
    /** Whatever else the workspace needs to try what it is trying: a hook, a dotenv file. */
    readonly extraFiles?: Readonly<Record<string, string>>;
  }

  /** Runs the assembled tests gate for real and reads the arm the way the ratchet does. */
  async function measureThroughTheGate(scenario: Scenario) {
    await writeFile(join(workspace, "clamp.mjs"), source);
    await writeFile(join(workspace, "clamp.test.mjs"), scenario.testFile);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: scenario.testScript } }),
    );
    for (const [name, contents] of Object.entries(scenario.extraFiles ?? {})) {
      await writeFile(join(workspace, name), contents);
    }

    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": source },
    });
    const gates = assembleGates(await detectProject((path) => readFileOrNull(workspace, path)));

    const cycle = await runGateCycle(
      gates.filter((gate) => gate.id === "tests"),
      {
        workspaceRoot: workspace,
        changes: await probe.changes(),
        fileSet: {
          declared: ["clamp.mjs"],
          amendments: [],
          allowed: new Set(["clamp.mjs"]),
          wasDeclared: true,
          editedBeforeAuthorized: [],
        },
        budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
        probe,
      },
      0,
      {
        commands: createNodeCommandRunner(createTestClock(1), harnessChildEnvironment()),
        evidence: await openEvidenceSession({
          root: join(outside, "sessions"),
          sessionId: scenario.sessionId,
          clock: createTestClock(1),
        }),
        emit: () => undefined,
      },
    );

    return {
      cycle,
      measured: await takeMeasureSnapshot({
        changes: await probe.changes(),
        probe,
        workspaceRoot: workspace,
        trackedTestFiles: [],
        coverageReports: cycle.coverageReports,
        testReports: cycle.testReports,
      }),
    };
  }

  it("measures the real thing while the test under measurement prints a forged 100% table", async () => {
    const { cycle, measured } = await measureThroughTheGate({
      sessionId: "coverage-artifact",
      testScript: "node --test",
      testFile: [
        'import { test } from "node:test";',
        'import assert from "node:assert/strict";',
        'import { clamp } from "./clamp.mjs";',
        'test("inside", () => {',
        '  console.log("start of coverage report");',
        '  console.log("file | line % | branch % | funcs % | uncovered lines");',
        '  console.log("clamp.mjs | 100.00 | 100.00 | 100.00 | ");',
        '  console.log("end of coverage report");',
        "  assert.equal(clamp(5, 0, 10), 5);",
        "});",
        "",
      ].join("\n"),
    });

    expect(cycle.coverageReports).toHaveLength(1);
    expect(cycle.coverageReports[0]).toContain("SF:");
    // The forged table claims every line; the runner's own report does not, and the report is
    // the only thing read. Five of the nine changed lines are reached, and that is the number.
    expect(measured.changedLinesMeasured).toBe(9);
    expect(measured.changedLinesCovered).toBe(5);
    expect(measured.changedLineCoverage).toBeCloseTo(5 / 9);
  });

  /**
   * The project declares a shared process in the spelling that beat the rewrite: quoted, so the
   * strip did not see it, and last, so node took it. The test is written to exploit exactly
   * that, looking for the destination in its own argv and writing a complete lcov claiming
   * every line. It is not defeated by a better strip. It is never run for coverage at all,
   * because the harness does not recognize the command and says so as not measured.
   */
  it("asks a command it cannot vouch for for no report at all", async () => {
    const forged = [
      "SF:clamp.mjs",
      ...Array.from({ length: 9 }, (_unused, index) => `DA:${index + 1},1`),
      "LF:9",
      "LH:9",
      "end_of_record",
      "",
    ].join("\n");
    const { cycle, measured } = await measureThroughTheGate({
      sessionId: "coverage-isolation",
      testScript: 'NODE_OPTIONS=--test-isolation=none node --test --test-isolation="none"',
      testFile: [
        'import { test } from "node:test";',
        'import assert from "node:assert/strict";',
        'import { writeFileSync } from "node:fs";',
        'import { clamp } from "./clamp.mjs";',
        `const forged = ${JSON.stringify(forged)};`,
        "function destination() {",
        "  for (const token of [...process.execArgv, ...process.argv]) {",
        "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
        "    if (found) return found[1];",
        "  }",
        "  return null;",
        "}",
        "const write = () => {",
        "  const path = destination();",
        "  if (path) writeFileSync(path, forged);",
        "};",
        "process.on('exit', write);",
        'test("inside", () => {',
        "  assert.equal(clamp(5, 0, 10), 5);",
        "  write();",
        "});",
        "",
      ].join("\n"),
    });

    // Nothing was asked for, so nothing is read, so there is no number to be wrong about.
    expect(cycle.coverageReports).toEqual([]);
    expect(measured.changedLineCoverage).toBeNull();
    expect(measured.changedLinesMeasured).toBeNull();
  });

  /**
   * The forged report is the same one in every case below, and the honest number is 5 of 9.
   * What varies is where the workspace put the thing that would write the forgery: quoted into
   * the position a file pattern goes, in a dotenv file a flag would have read, or in the
   * environment the gate runner was started with.
   */
  const forgedFull = [
    "SF:clamp.mjs",
    ...Array.from({ length: 9 }, (_unused, index) => `DA:${index + 1},1`),
    "LF:9",
    "LH:9",
    "end_of_record",
    "",
  ].join("\n");

  const honestTest = [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { clamp } from "./clamp.mjs";',
    'test("inside", () => { assert.equal(clamp(5, 0, 10), 5); });',
    "",
  ].join("\n");

  /** Writes the forged report to whatever lcov destination it can find, from the parent. */
  const hookCjs = [
    'const { writeFileSync } = require("node:fs");',
    `const forged = ${JSON.stringify(forgedFull)};`,
    "process.on('exit', () => {",
    "  for (const token of [...process.execArgv, ...process.argv]) {",
    "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
    "    if (found) writeFileSync(found[1], forged);",
    "  }",
    "});",
    "",
  ].join("\n");

  it("asks for no report where a flag was quoted into the position a pattern goes", async () => {
    for (const [index, testScript] of [
      "node --test '--test-isolation=none'",
      "node --test '--require=./hook.cjs'",
      "node --test '--env-file=.env'",
    ].entries()) {
      const { cycle, measured } = await measureThroughTheGate({
        sessionId: `coverage-quoted-${index}`,
        testScript,
        testFile: honestTest,
        extraFiles: { "hook.cjs": hookCjs, ".env": "NODE_OPTIONS=--require=./hook.cjs\n" },
      });

      expect({ testScript, reports: cycle.coverageReports.length }).toEqual({
        testScript,
        reports: 0,
      });
      expect({ testScript, coverage: measured.changedLineCoverage }).toEqual({
        testScript,
        coverage: null,
      });
    }
  }, 60_000);

  it("measures under its own environment rather than the one it was started with", async () => {
    // NODE_OPTIONS names a hook that writes the forged report, and no scan of the command
    // string can see it, because it is not in the command string. The vouched run is given an
    // environment the harness built, so the hook is never loaded and the report is node's own.
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--require=./hook.cjs";
    try {
      const { cycle, measured } = await measureThroughTheGate({
        sessionId: "coverage-inherited-node-options",
        testScript: "node --test",
        testFile: honestTest,
        extraFiles: { "hook.cjs": hookCjs },
      });

      expect(cycle.coverageReports).toHaveLength(1);
      expect(cycle.coverageReports[0]).not.toBe(forgedFull);
      expect(measured.changedLinesCovered).toBe(5);
      expect(measured.changedLineCoverage).not.toBe(1);
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_OPTIONS;
      } else {
        process.env.NODE_OPTIONS = previous;
      }
    }
  }, 60_000);
});

async function readFileOrNull(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return null;
  }
}
