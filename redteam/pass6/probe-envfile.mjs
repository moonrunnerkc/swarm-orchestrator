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

const source = [
  "export function clamp(value, low, high) {",
  "  if (value < low) { return low; }",
  "  if (value > high) { return high; }",
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

async function readFileOrNull(dir, path) {
  try {
    return await readFile(join(dir, path), "utf8");
  } catch {
    return null;
  }
}

async function measure(testScript, files) {
  const workspace = await mkdtemp(join(tmpdir(), "swarm-envf-ws-"));
  const outside = await mkdtemp(join(tmpdir(), "swarm-envf-out-"));
  try {
    await writeFile(join(workspace, "clamp.mjs"), source);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: testScript } }),
    );
    for (const [name, body] of Object.entries(files)) {
      await writeFile(join(workspace, name), body);
    }
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": source },
    });
    const gates = assembleGates(await detectProject((p) => readFileOrNull(workspace, p)), {
      coverageArtifactDirectory: join(outside, "coverage"),
    });
    const cycle = await runGateCycle(
      gates.filter((g) => g.id === "tests"),
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
          sessionId: "envfile",
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
      vouched: coverageReportingCommand(testScript, "/s/x.lcov") !== null,
      command: coverageReportingCommand(testScript, "/s/x.lcov"),
      covered: measured.changedLinesCovered,
      measured: measured.changedLinesMeasured,
      ratio: measured.changedLineCoverage,
      head: (cycle.coverageReports[0] ?? "").split("\n").slice(0, 4),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

const honestTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { clamp } from "./clamp.mjs";',
  'test("inside", () => { assert.equal(clamp(5, 0, 10), 5); });',
  "",
].join("\n");

console.log(
  JSON.stringify({
    id: "LIVE-A-quoted-env-file",
    ...(await measure("node --test '--env-file=.env'", {
      "clamp.test.mjs": honestTest,
      "hook.cjs": hookCjs,
      ".env": "NODE_OPTIONS=--require=./hook.cjs\n",
    })),
  }),
);

console.log(
  JSON.stringify({
    id: "LIVE-A-quoted-env-file-direct-require",
    ...(await measure("node --test '--env-file=./evil.env'", {
      "clamp.test.mjs": honestTest,
      "hook.cjs": hookCjs,
      "evil.env": "NODE_OPTIONS=--require=./hook.cjs\n",
    })),
  }),
);
