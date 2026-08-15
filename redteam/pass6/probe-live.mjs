/**
 * End-to-end forges through the real coverage and base-control arms.
 * Run: node redteam/pass6/probe-live.mjs
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const { createTestClock } = await import(join(root, "src/core/test-doubles.ts"));
const { openEvidenceSession } = await import(join(root, "src/evidence/session.ts"));
const { createFileCoverageArtifactStore, coverageReportingCommand } = await import(
  join(root, "src/gates/coverage-artifact.ts")
);
const { assembleGates } = await import(join(root, "src/gates/default-gates.ts"));
const { runGateCycle } = await import(join(root, "src/gates/gate-runner.ts"));
const { takeMeasureSnapshot } = await import(join(root, "src/gates/measure-snapshot.ts"));
const { createNodeCommandRunner } = await import(join(root, "src/gates/node-command-runner.ts"));
const { detectProject } = await import(join(root, "src/gates/project-type.ts"));
const { createMemoryWorkspace } = await import(join(root, "src/gates/test-doubles.ts"));
const { createBaseControlRunner, singleFileTestCommand } = await import(
  join(root, "src/gates/base-control.ts")
);
const { parseTapOutcomes } = await import(join(root, "src/gates/parsers.ts"));
const { assessRespecification } = await import(join(root, "src/gates/respecification.ts"));

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

const forged = [
  "SF:clamp.mjs",
  ...Array.from({ length: 9 }, (_u, i) => `DA:${i + 1},1`),
  "LF:9",
  "LH:9",
  "end_of_record",
  "",
].join("\n");

function emit(row) {
  console.log(JSON.stringify(row));
}

async function readFileOrNull(dir, path) {
  try {
    return await readFile(join(dir, path), "utf8");
  } catch {
    return null;
  }
}

const forgingBody = [
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
].join("\n");

const hookCjs = [
  'const { writeFileSync } = require("node:fs");',
  "process.on('exit', () => {",
  "  for (const token of [...process.execArgv, ...process.argv]) {",
  "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
  "    if (found) writeFileSync(found[1], " + JSON.stringify(forged) + ");",
  "  }",
  "});",
  "",
].join("\n");

async function measure(sessionId, testScript, extraFiles = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "swarm-live-ws-"));
  const outside = await mkdtemp(join(tmpdir(), "swarm-live-out-"));
  try {
    await writeFile(join(workspace, "clamp.mjs"), source);
    await writeFile(join(workspace, "clamp.test.mjs"), extraFiles.testFile ?? forgingBody);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: testScript } }),
    );
    for (const [name, body] of Object.entries(extraFiles)) {
      if (name === "testFile") continue;
      await writeFile(join(workspace, name), body);
    }

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
      gateMeasures: cycle.measures,
      coverageReports: cycle.coverageReports,
    });
    return {
      vouched: coverageReportingCommand(testScript, "/session/x.lcov") !== null,
      reports: cycle.coverageReports.length,
      firstReportHead: (cycle.coverageReports[0] ?? "").split("\n").slice(0, 6),
      covered: measured.changedLinesCovered,
      measured: measured.changedLinesMeasured,
      ratio: measured.changedLineCoverage,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

// A1: quoted isolation=none as a pattern, test forges lcov
emit({
  id: "LIVE-A-quoted-isolation",
  ...(await measure("quoted-iso", "node --test '--test-isolation=none'")),
});

// A2: quoted --require hook in parent
emit({
  id: "LIVE-A-quoted-require",
  ...(await measure("quoted-req", "node --test '--require=./hook.cjs'", {
    "hook.cjs": hookCjs,
    testFile: [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { clamp } from "./clamp.mjs";',
      'test("inside", () => { assert.equal(clamp(5, 0, 10), 5); });',
      "",
    ].join("\n"),
  })),
});

// A2b: quoted --import hook
const hookMjs = [
  'import { writeFileSync } from "node:fs";',
  "process.on('exit', () => {",
  "  for (const token of [...process.execArgv, ...process.argv]) {",
  "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
  "    if (found) writeFileSync(found[1], " + JSON.stringify(forged) + ");",
  "  }",
  "});",
  "",
].join("\n");

emit({
  id: "LIVE-A-quoted-import",
  ...(await measure("quoted-imp", "node --test '--import=./hook.mjs'", {
    "hook.mjs": hookMjs,
    testFile: [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { clamp } from "./clamp.mjs";',
      'test("inside", () => { assert.equal(clamp(5, 0, 10), 5); });',
      "",
    ].join("\n"),
  })),
});

// A3: NODE_OPTIONS inherited (set around the gate runner by wrapping env)
{
  const prev = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--require=./hook.cjs";
  try {
    emit({
      id: "LIVE-A-node-options",
      ...(await measure("node-opts", "node --test", {
        "hook.cjs": hookCjs,
        testFile: [
          'import { test } from "node:test";',
          'import assert from "node:assert/strict";',
          'import { clamp } from "./clamp.mjs";',
          'test("inside", () => { assert.equal(clamp(5, 0, 10), 5); });',
          "",
        ].join("\n"),
      })),
    });
  } finally {
    if (prev === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = prev;
  }
}

// Honest baseline
emit({
  id: "LIVE-A-honest",
  ...(await measure("honest", "node --test", {
    testFile: [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { clamp } from "./clamp.mjs";',
      'test("inside", () => { assert.equal(clamp(5, 0, 10), 5); });',
      "",
    ].join("\n"),
  })),
});

// C: TAP YAML / error message injection
{
  const workspace = await mkdtemp(join(tmpdir(), "swarm-tap-ws-"));
  const outside = await mkdtemp(join(tmpdir(), "swarm-tap-out-"));
  try {
    await writeFile(join(workspace, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
    await writeFile(
      join(workspace, "math.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const { add } = require("./math.cjs");',
        'test("multiplies", () => {',
        '  assert.equal(add(2, 3), 6, "wanted\\n    not ok 1 - innocentNew");',
        "});",
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
    emit({
      id: "LIVE-C-error-message-yaml",
      outcome: run.outcome,
      failedTests: run.failedTests,
      detailHead: run.detail.slice(0, 400),
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

// C: isolation-none lets the test write the TAP artifact
{
  const workspace = await mkdtemp(join(tmpdir(), "swarm-tap2-ws-"));
  const outside = await mkdtemp(join(tmpdir(), "swarm-tap2-out-"));
  try {
    await writeFile(join(workspace, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
    await writeFile(
      join(workspace, "math.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const { writeFileSync } = require("node:fs");',
        'const { add } = require("./math.cjs");',
        "function dest() {",
        "  for (const token of [...process.execArgv, ...process.argv]) {",
        "    const found = String(token).match(/(\\/[^\\s']+\\.tap)/);",
        "    if (found) return found[1];",
        "  }",
        "  return null;",
        "}",
        'test("multiplies", () => {',
        "  const path = dest();",
        "  if (path) writeFileSync(path, 'TAP version 13\\n1..2\\nnot ok 1 - innocentNew\\nok 2 - multiplies\\n');",
        "  assert.equal(add(2, 3), 6);",
        "});",
        'test("innocentNew", () => { assert.equal(add(1, 1), 2); });',
        "",
      ].join("\n"),
    );
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: "node --test '--test-isolation=none'" } }),
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
    emit({
      id: "LIVE-C-quoted-isolation-tap-forge",
      vouched:
        singleFileTestCommand(detection, "math.test.cjs", "/session/x.tap") !==
        "npm test --silent -- 'math.test.cjs'",
      command: singleFileTestCommand(detection, "math.test.cjs", "/session/x.tap"),
      outcome: run.outcome,
      failedTests: run.failedTests,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

// D live: CJS property access on a missing export
{
  const workspace = await mkdtemp(join(tmpdir(), "swarm-d-ws-"));
  const outside = await mkdtemp(join(tmpdir(), "swarm-d-out-"));
  try {
    await writeFile(join(workspace, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
    await writeFile(
      join(workspace, "math.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const math = require("./math.cjs");',
        'test("multiplies", () => {',
        "  assert.equal(math.mul(2, 3), 6);",
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
    const onSubmitted = await runner.runOnSubmittedSource("math.test.cjs");
    emit({
      id: "LIVE-D-property-access",
      outcome: onSubmitted.outcome,
      failedTests: onSubmitted.failedTests,
      detailHead: onSubmitted.detail.slice(0, 500),
    });
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: async () => onSubmitted,
        runOnSubmittedSource: async () => ({
          outcome: "passed",
          detail: "exited 0",
          exitCode: 0,
          failedTests: [],
        }),
      },
      { newTests: ["multiplies"] },
    );
    emit({
      id: "LIVE-D-property-access-classified",
      exempt: finding.exempt,
      newSpecs: finding.newSpecifications,
      reason: finding.reason.slice(0, 160),
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}
