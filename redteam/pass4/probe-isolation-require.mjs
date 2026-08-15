/**
 * Second framing: even when isolation really is process, workspace --require/--import
 * runs in the reporter process and can see the destination path.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const { createTestClock } = await import(join(root, "src/core/test-doubles.ts"));
const { openEvidenceSession } = await import(join(root, "src/evidence/session.ts"));
const { createFileCoverageArtifactStore } = await import(
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

const honestTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { clamp } from "./clamp.mjs";',
  'test("inside", () => {',
  "  assert.equal(clamp(5, 0, 10), 5);",
  "});",
  "",
].join("\n");

const setupCjs = [
  'const { writeFileSync } = require("node:fs");',
  `const forged = ${JSON.stringify(forged)};`,
  "function destination() {",
  "  for (const token of [...process.execArgv, ...process.argv]) {",
  "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
  "    if (found) return found[1];",
  "  }",
  "  return null;",
  "}",
  "const path = destination();",
  "if (path) {",
  "  process.stderr.write('PASS4_REQUIRE_SAW=' + path + '\\n');",
  "  process.on('exit', () => { writeFileSync(path, forged); });",
  "}",
  "",
].join("\n");

const preloadMjs = [
  'import { writeFileSync } from "node:fs";',
  `const forged = ${JSON.stringify(forged)};`,
  "function destination() {",
  "  for (const token of [...process.execArgv, ...process.argv]) {",
  "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
  "    if (found) return found[1];",
  "  }",
  "  return null;",
  "}",
  "const path = destination();",
  "if (path) {",
  "  process.stderr.write('PASS4_IMPORT_SAW=' + path + '\\n');",
  "  process.on('exit', () => { writeFileSync(path, forged); });",
  "}",
  "",
].join("\n");

async function readFileOrNull(dir, path) {
  try {
    return await readFile(join(dir, path), "utf8");
  } catch {
    return null;
  }
}

async function measure(label, testScript, extraFiles) {
  const workspace = await mkdtemp(join(tmpdir(), "pass4-req-ws-"));
  const outside = await mkdtemp(join(tmpdir(), "pass4-req-out-"));
  try {
    await writeFile(join(workspace, "clamp.mjs"), source);
    await writeFile(join(workspace, "clamp.test.mjs"), honestTest);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: testScript } }),
    );
    for (const [name, contents] of Object.entries(extraFiles)) {
      await writeFile(join(workspace, name), contents);
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
    const report = cycle.coverageReports[0] ?? null;
    return {
      label,
      testScript,
      coverage: measured.changedLineCoverage,
      forgedTook: report === forged,
      reportHasUncovered: /DA:\d+,0/.test(report ?? ""),
      stderrHits: stderr
        .split("\n")
        .filter((line) => line.includes("PASS4_"))
        .slice(0, 4),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

console.log(
  JSON.stringify(
    await measure("require-parent", "node --require ./setup.cjs --test", {
      "setup.cjs": setupCjs,
    }),
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    await measure("import-parent", "node --import ./preload.mjs --test", {
      "preload.mjs": preloadMjs,
    }),
    null,
    2,
  ),
);
