import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import {
  coverageArtifactPath,
  coverageReportingCommand,
  createFileCoverageArtifactStore,
} from "./coverage-artifact.ts";
import { assembleGates } from "./default-gates.ts";
import { runGateCycle } from "./gate-runner.ts";
import { takeMeasureSnapshot } from "./measure-snapshot.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { detectProject } from "./project-type.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

/**
 * The headline property: a coverage number the harness did not obtain from a runner-authored
 * file is not a coverage number at all. The end-to-end test below runs node's own test runner
 * for real, because the forgery this closes is a test printing a coverage table, and a double
 * that never executes the test cannot demonstrate that it did not work.
 */

describe("the command a runner is asked to write a report with", () => {
  it("asks node's runner for lcov beside the output it already prints", () => {
    const command = coverageReportingCommand("node --test", "/session/coverage/tests.lcov");

    expect(command).toContain("--experimental-test-coverage");
    expect(command).toContain("--test-reporter=lcov");
    expect(command).toContain("--test-reporter-destination='/session/coverage/tests.lcov'");
    // The counters the ratchet reads still have to arrive on stdout, and naming any reporter
    // replaces the default one.
    expect(command).toContain("--test-reporter-destination=stdout");
  });

  it("puts the flags in front of the file patterns, where node accepts them", () => {
    const command = coverageReportingCommand("node --test 'src/**/*.test.mjs'", "/c/tests.lcov");

    expect(command?.indexOf("--experimental-test-coverage")).toBeLessThan(
      command?.indexOf("'src/**/*.test.mjs'") ?? -1,
    );
  });

  it("declines every command it cannot ask for a report, rather than guessing", () => {
    // Null leaves the arm abstaining by name. A guess would leave it reporting a number.
    expect(coverageReportingCommand("vitest run", "/c/tests.lcov")).toBeNull();
    expect(coverageReportingCommand(undefined, "/c/tests.lcov")).toBeNull();
    expect(coverageReportingCommand("node --test && node other.mjs", "/c/tests.lcov")).toBeNull();
    expect(
      coverageReportingCommand("node --test --test-reporter=spec", "/c/tests.lcov"),
    ).toBeNull();
    expect(
      coverageReportingCommand("node --test --experimental-test-coverage", "/c/tests.lcov"),
    ).toBeNull();
  });

  it("forces process isolation, replacing a shared-process setting rather than joining it", () => {
    const forced = coverageReportingCommand("node --test", "/c/tests.lcov");
    const shared = coverageReportingCommand(
      "node --test --test-isolation=none 'src/*.test.mjs'",
      "/c/tests.lcov",
    );

    expect(forced).toContain("--test-isolation=process");
    // Node takes the last setting it is given, so the declared one has to go rather than be
    // argued with: under a shared process the test can write the report the harness reads.
    expect(shared).toContain("--test-isolation=process");
    expect(shared).not.toContain("--test-isolation=none");
    expect(shared).toContain("'src/*.test.mjs'");
  });

  it("keeps one report per gate id, including when a gate id carries a language", () => {
    expect(coverageArtifactPath("/session/coverage", "tests:node")).toBe(
      "/session/coverage/tests-node.lcov",
    );
  });
});

describe("the report store", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "swarm-coverage-store-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads back nothing when the runner wrote nothing", async () => {
    const store = createFileCoverageArtifactStore();

    expect(await store.read(join(directory, "absent.lcov"))).toBeNull();
  });

  it("drops an earlier run's report, so a stale file cannot pass as this run's", async () => {
    const store = createFileCoverageArtifactStore();
    const path = join(directory, "nested", "tests.lcov");
    await mkdir(join(directory, "nested"), { recursive: true });
    await writeFile(path, "SF:src/old.ts\nDA:1,0\nend_of_record\n");

    await store.clear(path);

    expect(await store.read(path)).toBeNull();
  });
});

describe("coverage of changed lines comes from the artifact, never from what ran", () => {
  let workspace = "";
  /** Stands in for the session store: the report goes somewhere the workspace is not. */
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
  }

  /** Runs the assembled tests gate for real and reads the arm the way the ratchet does. */
  async function measureThroughTheGate(scenario: Scenario) {
    await writeFile(join(workspace, "clamp.mjs"), source);
    await writeFile(join(workspace, "clamp.test.mjs"), scenario.testFile);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: scenario.testScript } }),
    );

    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": source },
    });
    const gates = assembleGates(await detectProject((path) => readFileOrNull(workspace, path)), {
      coverageArtifactDirectory: join(outside, "coverage"),
    });

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
        commands: createNodeCommandRunner(createTestClock(1)),
        evidence: await openEvidenceSession({
          root: join(outside, "sessions"),
          sessionId: scenario.sessionId,
          clock: createTestClock(1),
        }),
        emit: () => undefined,
        coverageArtifacts: createFileCoverageArtifactStore(),
      },
    );

    return {
      cycle,
      measured: await takeMeasureSnapshot({
        changes: await probe.changes(),
        probe,
        trackedTestFiles: [],
        gateMeasures: cycle.measures,
        coverageReports: cycle.coverageReports,
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
    // the only thing read.
    expect(measured.changedLinesMeasured).toBeGreaterThan(0);
    expect(measured.changedLineCoverage).toBeLessThan(1);
    expect(measured.changedLineCoverage).toBeGreaterThan(0);
  });

  it("does not hand the test the report path, even where the project asked for one process", async () => {
    // The project asks for a shared process twice over, once in the script and once in the
    // environment, which is what used to put the destination in the test's own argv. The test
    // looks for it there and writes a complete, well-formed lcov claiming every line, at the
    // end of the run as well as during it.
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
      testScript: "NODE_OPTIONS=--test-isolation=none node --test --test-isolation=none",
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

    expect(measured.changedLineCoverage).not.toBeNull();
    expect(measured.changedLineCoverage).toBeLessThan(1);
    // The branches this test never takes are in the report, which a forged one would not say.
    expect(cycle.coverageReports[0] ?? "").toMatch(/DA:\d+,0/);
  });
});

async function readFileOrNull(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return null;
  }
}
