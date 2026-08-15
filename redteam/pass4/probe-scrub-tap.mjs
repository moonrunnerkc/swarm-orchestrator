/**
 * Part D: scrub one-traversal split, TAP attribution.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const { findBlockingSecrets, findKnownSecrets, scrubJson, isMetricName } = await import(
  join(root, "src/evidence/scrub.ts")
);
const { parseTapOutcomes, parseTestOutcomes } = await import(join(root, "src/gates/parsers.ts"));
const { createTestClock } = await import(join(root, "src/core/test-doubles.ts"));
const { createBaseControlRunner, singleFileTestCommand } = await import(
  join(root, "src/gates/base-control.ts")
);
const { createFileCoverageArtifactStore } = await import(
  join(root, "src/gates/coverage-artifact.ts")
);
const { createNodeCommandRunner } = await import(join(root, "src/gates/node-command-runner.ts"));
const { detectProject } = await import(join(root, "src/gates/project-type.ts"));
const { assessRespecification } = await import(join(root, "src/gates/respecification.ts"));

function compareSites(label, object, textVariants) {
  const written = scrubJson(object);
  const exportScan = findKnownSecrets(JSON.stringify(object));
  const exportPretty = findKnownSecrets(JSON.stringify(object, null, 2));
  const gateCompact = findBlockingSecrets(JSON.stringify(object));
  const gatePretty = findBlockingSecrets(JSON.stringify(object, null, 2));
  const extras = {};
  for (const [name, text] of Object.entries(textVariants ?? {})) {
    extras[name] = {
      known: findKnownSecrets(text),
      blocking: findBlockingSecrets(text),
    };
  }
  return {
    label,
    writeRedactions: written.redactions,
    exportCompact: exportScan,
    exportPretty,
    gateCompact,
    gatePretty,
    extras,
  };
}

const scrubCases = [
  compareSites("pretty-pin-array", { PIN: [4, 8, 2, 9, 1, 7, 3, 6] }),
  compareSites("compact-nested-pin", { cfg: { PIN: 48291736 } }),
  compareSites("pin-object-payload", { PIN: { payload: "48291736" } }),
  compareSites("metric-top", { outputTokens: 12345 }),
  compareSites("metric-under-secrets", { secrets: { outputTokens: 12345 } }),
  compareSites("metric-deep", { auth: { nested: { tokensPerSecond: 99 } } }),
  compareSites("almost-json-trailing-comma-text", { unused: 1 }, {
    trailingCommaPretty: '{\n  "PIN": [\n    4,\n    8,\n    2,\n    9\n  ],\n}\n',
    trailingCommaCompact: '{"PIN":[4,8,2,9,1,7,3,6],}',
    jsUnquoted: "{PIN: 48291736}",
    bomJson: "\uFEFF{\"PIN\":48291736}",
    jsonc: '{\n  // pin\n  "PIN": 48291736\n}\n',
    ndjson: '{"PIN":48291736}\n{"OTP":991122}\n',
    dotenv: "PIN=48291736\n",
    splitNonJson: "PIN=\n48291736\n",
    versionTuple: '{"version":[1,2,3,4]}',
    shortArrayUnderPin: '{"PIN":[1,2]}',
    namedSplit: '{"firstHalf":"sk-abcdefghijklmnop","secondHalf":"qrstuvwxyz012345"}',
  }),
  compareSites("credential-in-string-json", { note: "PIN: 48291736" }),
  compareSites("duplicate-keys-text", { PIN: 1111 }, {
    dupKeys: '{"PIN":1111,"PIN":48291736}',
  }),
];

console.log("=== scrub ===");
for (const row of scrubCases) {
  console.log(JSON.stringify(row));
}

// TAP parser: can a test-authored line become a result point?
console.log("=== tap parser ===");
const tapHonest = [
  "TAP version 13",
  "1..2",
  "ok 1 - multiplies",
  "ok 2 - sibling",
  "",
].join("\n");
const tapCommentedForge = [
  "TAP version 13",
  "1..2",
  "ok 1 - multiplies",
  "# not ok 1 - sibling",
  "# ✖ sibling (0.1ms)",
  "ok 2 - sibling",
  "",
].join("\n");
const tapBareForge = [
  "TAP version 13",
  "1..2",
  "ok 1 - multiplies",
  "not ok 2 - sibling",
  "ok 2 - sibling",
  "",
].join("\n");
const tapNoDash = [
  "TAP version 13",
  "1..1",
  "not ok 1 sibling",
  "",
].join("\n");
const tapIndented = [
  "TAP version 13",
  "1..1",
  "    not ok 1 - sibling",
  "ok 1 - multiplies",
  "",
].join("\n");
const tapYaml = [
  "TAP version 13",
  "1..1",
  "ok 1 - multiplies",
  "  ---",
  "  not ok 1 - sibling",
  "  ...",
  "",
].join("\n");
const tapPlanMismatch = [
  "TAP version 13",
  "1..1",
  "ok 1 - multiplies",
  "not ok 2 - sibling",
  "",
].join("\n");
const specWithTapLine = [
  "✔ multiplies (0.3ms)",
  "not ok 1 - sibling",
  "✔ sibling (0.1ms)",
].join("\n");

for (const [label, text] of [
  ["honest", tapHonest],
  ["commented-forge", tapCommentedForge],
  ["bare-forge-contested", tapBareForge],
  ["no-dash", tapNoDash],
  ["indented-subtest", tapIndented],
  ["yaml-block", tapYaml],
  ["plan-mismatch", tapPlanMismatch],
  ["spec-with-tap-line", specWithTapLine],
]) {
  console.log(
    JSON.stringify({
      label,
      tap: parseTapOutcomes(text),
      any: parseTestOutcomes(text),
    }),
  );
}

// Live control: test writes TAP artifact; CJS TypeError withheld
const workspace = await mkdtemp(join(tmpdir(), "pass4-d-ws-"));
const outside = await mkdtemp(join(tmpdir(), "pass4-d-out-"));

async function runControl(files, testFile) {
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(workspace, name), contents);
  }
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
  return runner.runOnSubmittedSource(testFile);
}

console.log("=== live tap artifact write from test ===");
const writeArtifactTest = [
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
  "const path = dest();",
  "if (path) {",
  "  process.stderr.write('PASS4_TAP_DEST=' + path + '\\n');",
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
  'test("multiplies", () => { assert.equal(add(2, 3), 5); });',
  'test("innocentNew", () => { assert.equal(add(1, 1), 2); });',
  "",
].join("\n");

const liveWrite = await runControl(
  {
    "math.cjs": "module.exports = { add: (a, b) => a + b };\n",
    "math.test.cjs": writeArtifactTest,
    "package.json": JSON.stringify({ name: "scratch", scripts: { test: "node --test" } }),
  },
  "math.test.cjs",
);
console.log(
  JSON.stringify({
    case: "test-writes-tap-artifact",
    outcome: liveWrite.outcome,
    failedTests: liveWrite.failedTests,
    destMentioned: liveWrite.detail.includes("PASS4_TAP_DEST"),
  }),
);

// quoted isolation on the npm script for control path
const liveQuoted = await runControl(
  {
    "math.cjs": "module.exports = { add: (a, b) => a + b };\n",
    "math.test.cjs": writeArtifactTest,
    "package.json": JSON.stringify({
      name: "scratch",
      scripts: { test: "node --test --test-isolation='none'" },
    }),
  },
  "math.test.cjs",
);
console.log(
  JSON.stringify({
    case: "control-quoted-none",
    outcome: liveQuoted.outcome,
    failedTests: liveQuoted.failedTests,
    destMentioned: liveQuoted.detail.includes("PASS4_TAP_DEST"),
  }),
);

// CJS load error: require of missing export
console.log("=== cjs load error ===");
await writeFile(join(workspace, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
await writeFile(
  join(workspace, "math.test.cjs"),
  [
    'const { test } = require("node:test");',
    'const assert = require("node:assert/strict");',
    'const { add, mul } = require("./math.cjs");',
    'test("multiplies", () => { assert.equal(mul(2, 3), 6); });',
    "",
  ].join("\n"),
);
const finding = await assessRespecification(
  "math.test.cjs",
  {
    async runOnBaseSource() {
      return {
        outcome: "failed",
        detail:
          "TypeError: mul is not a function\n    at TestContext.<anonymous> (math.test.cjs:4:30)",
        exitCode: 1,
        failedTests: ["multiplies"],
      };
    },
    async runOnSubmittedSource() {
      return { outcome: "passed", detail: "ok", exitCode: 0, failedTests: [] };
    },
  },
  { newTests: ["multiplies"] },
);
console.log(
  JSON.stringify({
    case: "cjs-typeerror-withheld",
    exempt: finding.exempt,
    newSpecifications: finding.newSpecifications,
    reason: finding.reason,
  }),
);

await rm(workspace, { recursive: true, force: true });
await rm(outside, { recursive: true, force: true });
