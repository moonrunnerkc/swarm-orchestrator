/**
 * Live: does a rewritten command that still carries a trailing none actually run
 * tests in the reporter process so they can author the lcov the harness reads?
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const { createTestClock } = await import(join(root, "src/core/test-doubles.ts"));
const { openEvidenceSession } = await import(join(root, "src/evidence/session.ts"));
const { coverageReportingCommand, createFileCoverageArtifactStore } = await import(
  join(root, "src/gates/coverage-artifact.ts")
);
const { assembleGates } = await import(join(root, "src/gates/default-gates.ts"));
const { runGateCycle } = await import(join(root, "src/gates/gate-runner.ts"));
const { takeMeasureSnapshot } = await import(join(root, "src/gates/measure-snapshot.ts"));
const { createNodeCommandRunner } = await import(join(root, "src/gates/node-command-runner.ts"));
const { detectProject } = await import(join(root, "src/gates/project-type.ts"));
const { createMemoryWorkspace } = await import(join(root, "src/gates/test-doubles.ts"));

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
  `const forged = ${JSON.stringify(forged)};`,
  "function destination() {",
  "  for (const token of [...process.execArgv, ...process.argv]) {",
  "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
  "    if (found) return found[1];",
  "  }",
  "  return null;",
  "}",
  "const saw = destination();",
  "const write = () => {",
  "  const path = destination();",
  "  if (path) writeFileSync(path, forged);",
  "};",
  "process.on('exit', write);",
  'test("inside", () => {',
  "  assert.equal(clamp(5, 0, 10), 5);",
  "  write();",
  "  console.error('PASS4_SAW_DEST=' + JSON.stringify(saw));",
  "  console.error('PASS4_EXECARGV=' + JSON.stringify(process.execArgv));",
  "  console.error('PASS4_ARGV=' + JSON.stringify(process.argv));",
  "});",
  "",
].join("\n");

async function readFileOrNull(dir, path) {
  try {
    return await readFile(join(dir, path), "utf8");
  } catch {
    return null;
  }
}

async function measure(label, testScript, extraFiles = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "pass4-a-ws-"));
  const outside = await mkdtemp(join(tmpdir(), "pass4-a-out-"));
  try {
    await writeFile(join(workspace, "clamp.mjs"), source);
    await writeFile(join(workspace, "clamp.test.mjs"), extraFiles.testFile ?? forgingTest);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: testScript } }),
    );
    for (const [name, contents] of Object.entries(extraFiles)) {
      if (name === "testFile") continue;
      await writeFile(join(workspace, name), contents);
    }

    const rewritten = coverageReportingCommand(testScript, join(outside, "coverage", "tests.lcov"));
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": source },
    });
    const gates = assembleGates(await detectProject((path) => readFileOrNull(workspace, path)), {
      coverageArtifactDirectory: join(outside, "coverage"),
    });
    const testsGate = gates.find((gate) => gate.id === "tests");

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
          sessionId: label,
          clock: createTestClock(1),
        }),
        emit: () => undefined,
        coverageArtifacts: createFileCoverageArtifactStore(),
      },
    );

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: cycle.measures,
      coverageReports: cycle.coverageReports,
    });

    const stderr = cycle.runs[0]?.observation.stderr ?? "";
    const saw = /PASS4_SAW_DEST=(.*)$/m.exec(stderr)?.[1] ?? null;
    const report = cycle.coverageReports[0] ?? null;
    const forgedTook = report === forged;

    return {
      label,
      testScript,
      rewritten,
      gateCommand: testsGate?.source.kind === "command" ? testsGate.source.command : null,
      coverage: measured.changedLineCoverage,
      measuredLines: measured.changedLinesMeasured,
      forgedTook,
      sawDest: saw,
      reportHasUncovered: report?.includes("DA:") && /DA:\d+,0/.test(report ?? ""),
      reportHead: report?.split("\n").slice(0, 4),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

const cases = [
  ["quoted-single", "node --test --test-isolation='none'"],
  ["quoted-double", 'node --test --test-isolation="none"'],
  ["subst-value", "node --test --test-isolation=$(echo none)"],
  ["subst-default", "node --test --test-isolation=${ISOLATION:-none}"],
  ["backtick-value", "node --test --test-isolation=`echo none`"],
  ["env-node-options", "env NODE_OPTIONS=--test-isolation=none node --test"],
  ["prefix-node-options", "NODE_OPTIONS=--test-isolation=none node --test"],
  ["honest-none-stripped", "node --test --test-isolation=none"],
];

for (const [label, script] of cases) {
  const result = await measure(label, script);
  console.log(JSON.stringify(result, null, 2));
}
