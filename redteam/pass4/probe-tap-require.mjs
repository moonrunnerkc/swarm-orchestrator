/**
 * Part D second framing: --require in the parent writes the TAP artifact the
 * control runner then attributes from.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const { createTestClock } = await import(join(root, "src/core/test-doubles.ts"));
const { createBaseControlRunner, singleFileTestCommand } = await import(
  join(root, "src/gates/base-control.ts")
);
const { createFileCoverageArtifactStore } = await import(
  join(root, "src/gates/coverage-artifact.ts")
);
const { createNodeCommandRunner } = await import(join(root, "src/gates/node-command-runner.ts"));
const { detectProject } = await import(join(root, "src/gates/project-type.ts"));
const { assembleGates } = await import(join(root, "src/gates/default-gates.ts"));
const { coverageReportingCommand } = await import(join(root, "src/gates/coverage-artifact.ts"));
const { takeMeasureSnapshot } = await import(join(root, "src/gates/measure-snapshot.ts"));
const { createMemoryWorkspace } = await import(join(root, "src/gates/test-doubles.ts"));

const workspace = await mkdtemp(join(tmpdir(), "pass4-tapreq-ws-"));
const outside = await mkdtemp(join(tmpdir(), "pass4-tapreq-out-"));

const setup = [
  'const { writeFileSync } = require("node:fs");',
  "function dest() {",
  "  for (const token of [...process.execArgv, ...process.argv]) {",
  "    const found = String(token).match(/(\\/[^\\s']+\\.tap)/);",
  "    if (found) return found[1];",
  "  }",
  "  return null;",
  "}",
  "const path = dest();",
  "if (path) {",
  "  process.stderr.write('PASS4_TAP_REQUIRE=' + path + '\\n');",
  "  process.on('exit', () => {",
  "    writeFileSync(path, [",
  "      'TAP version 13',",
  "      '1..2',",
  "      'not ok 1 - innocentNew',",
  "      'ok 2 - multiplies',",
  "      '',",
  "    ].join('\\n'));",
  "  });",
  "}",
  "",
].join("\n");

await writeFile(join(workspace, "setup.cjs"), setup);
await writeFile(join(workspace, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
await writeFile(
  join(workspace, "math.test.cjs"),
  [
    'const { test } = require("node:test");',
    'const assert = require("node:assert/strict");',
    'const { add } = require("./math.cjs");',
    'test("multiplies", () => { assert.equal(add(2, 3), 5); });',
    'test("innocentNew", () => { assert.equal(add(1, 1), 2); });',
    "",
  ].join("\n"),
);
await writeFile(
  join(workspace, "package.json"),
  JSON.stringify({ name: "scratch", scripts: { test: "node --require ./setup.cjs --test" } }),
);

const detection = await detectProject(async (path) => {
  try {
    return await readFile(join(workspace, path), "utf8");
  } catch {
    return null;
  }
});
const runner = createBaseControlRunner({
  workspace: { workspaceRoot: workspace, baseRef: "HEAD" },
  commands: createNodeCommandRunner(createTestClock(1)),
  singleFileCommand: (file, artifact) => singleFileTestCommand(detection, file, artifact),
  outcomeArtifacts: {
    directory: join(outside, "controls"),
    store: createFileCoverageArtifactStore(),
  },
});
const run = await runner.runOnSubmittedSource("math.test.cjs");
console.log(
  JSON.stringify({
    case: "require-writes-tap",
    outcome: run.outcome,
    failedTests: run.failedTests,
    dest: /PASS4_TAP_REQUIRE=(\S+)/.exec(run.detail)?.[1] ?? null,
  }),
);

// Abstain confirmation: command the rewrite declines
const declined = coverageReportingCommand("node --test && echo done", "/tmp/x.lcov");
const detection2 = {
  types: ["node"],
  manifests: ["package.json"],
  nodeScripts: ["test"],
  nodeScriptCommands: { test: "vitest run" },
  pythonTools: [],
};
const gates = assembleGates(detection2, { coverageArtifactDirectory: "/tmp/cov" });
const tests = gates.find((g) => g.id === "tests");
const artifactSet =
  tests?.source.kind === "command" ? tests.source.coverageArtifact : undefined;

const probe = createMemoryWorkspace({
  base: { "clamp.mjs": "export const n = 0;\n" },
  current: {
    "clamp.mjs": "export function clamp(v, l, h) { if (v < l) return l; return v; }\n",
  },
});
const measured = await takeMeasureSnapshot({
  changes: await probe.changes(),
  probe,
  trackedTestFiles: [],
  gateMeasures: {},
  coverageReports: [],
});

console.log(
  JSON.stringify({
    case: "cannot-rewrite-abstains",
    pipeOrAnd: declined,
    vitestArtifact: artifactSet ?? null,
    emptyReportsCoverage: measured.changedLineCoverage,
  }),
);

await rm(workspace, { recursive: true, force: true });
await rm(outside, { recursive: true, force: true });
