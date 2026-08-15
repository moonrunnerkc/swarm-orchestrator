/**
 * Pass-6 red-team closures. Not wired into the engine or the default vitest include.
 *
 * Each test asserts the behaviour the harness should have after the hole is closed.
 * Running this file against the current tree is expected to fail on the successes:
 * that is the finding.
 *
 *   npx vitest run --config redteam/pass6/vitest.config.ts
 *
 * Do not "fix" these by widening a check until a documented residual turns green.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../../src/core/test-doubles.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { createBaseControlRunner, singleFileTestCommand } from "../../src/gates/base-control.ts";
import {
  coverageReportingCommand,
  createFileCoverageArtifactStore,
} from "../../src/gates/coverage-artifact.ts";
import { assembleGates } from "../../src/gates/default-gates.ts";
import type { GateContext } from "../../src/gates/gate-definition.ts";
import { runGateCycle } from "../../src/gates/gate-runner.ts";
import { placeholderGate } from "../../src/gates/inspection-gates.ts";
import { takeMeasureSnapshot } from "../../src/gates/measure-snapshot.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";
import { harnessControlledNodeTest, processIsolation } from "../../src/gates/node-test-command.ts";
import { parseTapOutcomes } from "../../src/gates/parsers.ts";
import { detectProject } from "../../src/gates/project-type.ts";
import { assessRespecification } from "../../src/gates/respecification.ts";
import { createMemoryWorkspace } from "../../src/gates/test-doubles.ts";

const clampSource = [
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

const forgedFull = [
  "SF:clamp.mjs",
  ...Array.from({ length: 9 }, (_unused, index) => `DA:${index + 1},1`),
  "LF:9",
  "LH:9",
  "end_of_record",
  "",
].join("\n");

const forgingTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { writeFileSync } from "node:fs";',
  'import { clamp } from "./clamp.mjs";',
  `const forged = ${JSON.stringify(forgedFull)};`,
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
].join("\n");

const honestTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { clamp } from "./clamp.mjs";',
  'test("inside", () => { assert.equal(clamp(5, 0, 10), 5); });',
  "",
].join("\n");

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

async function readFileOrNull(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return null;
  }
}

const reporting = [processIsolation, "--test-reporter=lcov", "--test-reporter-destination='/s/t'"];

describe("A the recognizer does not vouch for a quoted flag smuggled as a file pattern", () => {
  let workspace = "";
  let outside = "";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "pass6-a-ws-"));
    outside = await mkdtemp(join(tmpdir(), "pass6-a-out-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  async function measureThroughTheGate(testScript: string, extraFiles: Record<string, string> = {}) {
    await writeFile(join(workspace, "clamp.mjs"), clampSource);
    await writeFile(join(workspace, "clamp.test.mjs"), extraFiles.testFile ?? forgingTest);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: testScript } }),
    );
    for (const [name, contents] of Object.entries(extraFiles)) {
      if (name === "testFile") continue;
      await writeFile(join(workspace, name), contents);
    }

    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
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
          sessionId: "pass6-a",
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
      gateMeasures: cycle.measures,
      coverageReports: cycle.coverageReports,
    });
    return { cycle, measured };
  }

  it("does not vouch for a quoted --test-isolation=none smuggled as a file pattern", async () => {
    // The recognizer splits on whitespace and treats anything not starting with - as a
    // path. Confirmation then skips that token, the shell unquotes it, and node takes
    // the last isolation setting. Live this produced changedLineCoverage 1.
    expect(harnessControlledNodeTest("node --test '--test-isolation=none'", reporting)).toBeNull();
    expect(coverageReportingCommand("node --test '--test-isolation=none'", "/s/t.lcov")).toBeNull();

    const { measured } = await measureThroughTheGate("node --test '--test-isolation=none'");
    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("does not vouch for a quoted --require hook smuggled as a file pattern", async () => {
    expect(harnessControlledNodeTest("node --test '--require=./hook.cjs'", reporting)).toBeNull();
    expect(coverageReportingCommand("node --test '--require=./hook.cjs'", "/s/t.lcov")).toBeNull();

    const { measured } = await measureThroughTheGate("node --test '--require=./hook.cjs'", {
      "hook.cjs": hookCjs,
      testFile: honestTest,
    });
    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("does not vouch for a quoted --env-file that can set NODE_OPTIONS the scan never sees", async () => {
    expect(harnessControlledNodeTest("node --test '--env-file=.env'", reporting)).toBeNull();
    expect(coverageReportingCommand("node --test '--env-file=.env'", "/s/t.lcov")).toBeNull();

    const { measured } = await measureThroughTheGate("node --test '--env-file=.env'", {
      "hook.cjs": hookCjs,
      ".env": "NODE_OPTIONS=--require=./hook.cjs\n",
      testFile: honestTest,
    });
    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("does not measure under an inherited NODE_OPTIONS hook the command string never named", async () => {
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--require=./hook.cjs";
    try {
      const { measured } = await measureThroughTheGate("node --test", {
        "hook.cjs": hookCjs,
        testFile: honestTest,
      });
      expect(measured.changedLineCoverage).not.toBe(1);
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_OPTIONS;
      } else {
        process.env.NODE_OPTIONS = previous;
      }
    }
  });
});

describe("B a second lcov section cannot invent hits the first section never measured", () => {
  it("does not report 9/9 from a one-line section plus a second section that names the rest", async () => {
    const added = Array.from({ length: 9 }, (_unused, index) => ({
      line: index + 1,
      text: "x",
    }));
    const snap = await takeMeasureSnapshot({
      changes: {
        files: [{ path: "clamp.mjs", kind: "modified", addedLines: added, removedLines: [] }],
      },
      probe: {
        readCurrent: async () => "",
        readBase: async () => "",
      },
      workspaceRoot: "/tmp/ws",
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [
        [
          "SF:clamp.mjs",
          "DA:1,1",
          "LF:1",
          "LH:1",
          "end_of_record",
          "SF:clamp.mjs",
          "DA:2,1",
          "DA:3,1",
          "DA:4,1",
          "DA:5,1",
          "DA:6,1",
          "DA:7,1",
          "DA:8,1",
          "DA:9,1",
          "LF:8",
          "LH:8",
          "end_of_record",
        ].join("\n"),
      ],
    });

    expect(snap.changedLinesCovered).not.toBe(9);
    expect(snap.changedLineCoverage).not.toBe(1);
  });
});

describe("C attribution does not take a name node wrote for a different test", () => {
  let workspace = "";
  let outside = "";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "pass6-c-ws-"));
    outside = await mkdtemp(join(tmpdir(), "pass6-c-out-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("does not treat a failing subtest's name as a base-source failure of a skipped sibling", async () => {
    // Node itself emits `not ok N - innocentNew` for the subtest. The top-level
    // innocentNew is skipped, so the name is not contested, and the escape hatch
    // currently clears it. A tautology must not pay for a deletion.
    const stolen = parseTapOutcomes(
      [
        "TAP version 13",
        "1..2",
        "ok 1 - innocentNew # SKIP",
        "ok 2 - attacker",
        "    not ok 1 - innocentNew",
        "",
      ].join("\n"),
    );
    expect(stolen?.failed.includes("innocentNew") ?? false).toBe(false);

    await writeFile(join(workspace, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
    await writeFile(
      join(workspace, "math.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const math = require("./math.cjs");',
        "const hasMul = typeof math.mul === 'function';",
        "(hasMul ? test : test.skip)('innocentNew', () => { assert.equal(1, 1); });",
        "test('attacker', async (t) => {",
        "  await t.test('innocentNew', () => { assert.equal(math.mul(2, 3), 6); });",
        "});",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: "node --test" } }),
    );
    const detection = await detectProject((path) => readFileOrNull(workspace, path));
    const runner = createBaseControlRunner({
      workspace: { workspaceRoot: workspace, baseRef: "HEAD" },
      commands: createNodeCommandRunner(createTestClock(1)),
      singleFileCommand: (testFile, artifact) =>
        singleFileTestCommand(detection, testFile, artifact),
      outcomeArtifacts: {
        directory: join(outside, "controls"),
        store: createFileCoverageArtifactStore(),
      },
    });
    const onBase = await runner.runOnSubmittedSource("math.test.cjs");
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: async () => onBase,
        runOnSubmittedSource: async () => ({
          outcome: "passed",
          detail: "exited 0",
          exitCode: 0,
          failedTests: [],
        }),
      },
      { newTests: ["innocentNew"] },
    );
    expect(finding.newSpecifications).not.toContain("innocentNew");
  });

  it("does not attribute from a TAP file a NODE_OPTIONS hook wrote", async () => {
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--require=./hook.cjs";
    try {
      await writeFile(join(workspace, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
      await writeFile(
        join(workspace, "hook.cjs"),
        [
          'const { writeFileSync } = require("node:fs");',
          "process.on('exit', () => {",
          "  for (const token of [...process.execArgv, ...process.argv]) {",
          "    const found = String(token).match(/(\\/[^\\s']+\\.tap)/);",
          "    if (found) {",
          "      writeFileSync(found[1], 'TAP version 13\\n1..2\\nnot ok 1 - innocentNew\\nok 2 - multiplies\\n');",
          "    }",
          "  }",
          "});",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(workspace, "math.test.cjs"),
        [
          'const { test } = require("node:test");',
          'const assert = require("node:assert/strict");',
          'const { add } = require("./math.cjs");',
          'test("multiplies", () => { assert.equal(add(2, 3), 6); });',
          'test("innocentNew", () => { assert.equal(add(1, 1), 2); });',
          "",
        ].join("\n"),
      );
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({ name: "scratch", scripts: { test: "node --test" } }),
      );
      const detection = await detectProject((path) => readFileOrNull(workspace, path));
      const runner = createBaseControlRunner({
        workspace: { workspaceRoot: workspace, baseRef: "HEAD" },
        commands: createNodeCommandRunner(createTestClock(1)),
        singleFileCommand: (testFile, artifact) =>
          singleFileTestCommand(detection, testFile, artifact),
        outcomeArtifacts: {
          directory: join(outside, "controls"),
          store: createFileCoverageArtifactStore(),
        },
      });
      const run = await runner.runOnSubmittedSource("math.test.cjs");
      expect(run.failedTests ?? []).not.toContain("innocentNew");
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_OPTIONS;
      } else {
        process.env.NODE_OPTIONS = previous;
      }
    }
  });
});

describe("D a missing export reached as a property is still a load failure", () => {
  it("withholds the exemption for Cannot read properties of undefined", async () => {
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: async () => ({
          outcome: "failed",
          detail: "TypeError: Cannot read properties of undefined (reading 'mul')",
          exitCode: 1,
          failedTests: ["multiplies"],
        }),
        runOnSubmittedSource: async () => ({
          outcome: "passed",
          detail: "exited 0",
          exitCode: 0,
          failedTests: [],
        }),
      },
      { newTests: ["multiplies"] },
    );
    expect(finding.exempt).toBe(false);
    expect(finding.newSpecifications).toEqual([]);
  });

  it("withholds the exemption for Cannot destructure property of undefined", async () => {
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: async () => ({
          outcome: "failed",
          detail:
            "TypeError: Cannot destructure property 'mul' of 'undefined' as it is undefined.",
          exitCode: 1,
          failedTests: ["multiplies"],
        }),
        runOnSubmittedSource: async () => ({
          outcome: "passed",
          detail: "exited 0",
          exitCode: 0,
          failedTests: [],
        }),
      },
      { newTests: ["multiplies"] },
    );
    expect(finding.exempt).toBe(false);
    expect(finding.newSpecifications).toEqual([]);
  });
});

describe("M1 a TODO spelled outside the folded script list still has to be named honestly", () => {
  it("blocks a TODO written in mathematical bold capitals, or the scope note stays", async () => {
    const bold = "TODO"
      .split("")
      .map((letter) => String.fromCodePoint(0x1d400 + (letter.charCodeAt(0) - 65)))
      .join("");
    const probe = createMemoryWorkspace({
      base: { "src/a.ts": "export const a = 1;\n" },
      current: { "src/a.ts": `// ${bold}: finish this\nexport const a = 1;\n` },
    });
    const context: GateContext = {
      workspaceRoot: "/workspace",
      changes: await probe.changes(),
      fileSet: {
        declared: ["src/a.ts"],
        amendments: [],
        allowed: new Set(["src/a.ts"]),
        wasDeclared: true,
        editedBeforeAuthorized: [],
      },
      budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
      probe,
    };
    if (placeholderGate.source.kind !== "inspection") {
      throw new Error("placeholder gate is an inspection");
    }
    const reading = placeholderGate.parse(await placeholderGate.source.inspect(context));
    expect(reading.status).toBe("failed");
    expect(reading.measures.placeholdersIntroduced).toBeGreaterThan(0);
  });
});
