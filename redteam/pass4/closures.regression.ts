/**
 * Pass-4 red-team closures. Not wired into the engine or the default vitest include.
 *
 * Each test asserts the behaviour the harness should have after the hole is closed.
 * Running this file against the current tree is expected to fail on the successes:
 * that is the finding.
 *
 *   npx vitest run --config redteam/pass4/vitest.config.ts
 *
 * Do not "fix" these by widening a check until a documented residual turns green.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../../src/core/test-doubles.ts";
import type { JsonValue } from "../../src/evidence/canonical-json.ts";
import { evaluateClaim } from "../../src/evidence/claim.ts";
import { buildEvidenceDag } from "../../src/evidence/dag.ts";
import { indexCitedRecords } from "../../src/evidence/record-index.ts";
import { findBlockingSecrets, findKnownSecrets, scrubJson } from "../../src/evidence/scrub.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../../src/evidence/session.ts";
import * as embedded from "../../src/evidence/verifier/verify.mjs";
import {
  coverageReportingCommand,
  createFileCoverageArtifactStore,
} from "../../src/gates/coverage-artifact.ts";
import { assembleGates } from "../../src/gates/default-gates.ts";
import { runGateCycle } from "../../src/gates/gate-runner.ts";
import { takeMeasureSnapshot } from "../../src/gates/measure-snapshot.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";
import { parseUncoveredLines } from "../../src/gates/parsers.ts";
import { detectProject } from "../../src/gates/project-type.ts";
import { createBaseControlRunner, singleFileTestCommand } from "../../src/gates/base-control.ts";
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

async function readFileOrNull(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return null;
  }
}

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

describe("A the isolation rewrite actually takes, or the arm abstains", () => {
  let workspace = "";
  let outside = "";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "pass4-a-ws-"));
    outside = await mkdtemp(join(tmpdir(), "pass4-a-out-"));
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
          sessionId: "pass4-a",
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
    return { cycle, measured };
  }

  it("does not let a quoted trailing --test-isolation='none' un-force process isolation", async () => {
    // The rewrite inserts --test-isolation=process after --test but leaves a quoted
    // --test-isolation='none' in place. Node takes the last setting, the shell strips the
    // quotes, and the test shares the reporter process and authors the artifact.
    const { measured, cycle } = await measureThroughTheGate("node --test --test-isolation='none'");
    expect(measured.changedLineCoverage).not.toBe(1);
    expect(cycle.coverageReports[0] ?? "").toMatch(/DA:\d+,0/);
  });

  it("does not trust an lcov a --require hook writes from the reporter process", async () => {
    const setup = [
      'const { writeFileSync } = require("node:fs");',
      `const forged = ${JSON.stringify(forgedFull)};`,
      "function destination() {",
      "  for (const token of [...process.execArgv, ...process.argv]) {",
      "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
      "    if (found) return found[1];",
      "  }",
      "  return null;",
      "}",
      "process.on('exit', () => {",
      "  const path = destination();",
      "  if (path) writeFileSync(path, forged);",
      "});",
      "",
    ].join("\n");
    const honest = [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { clamp } from "./clamp.mjs";',
      'test("inside", () => { assert.equal(clamp(5, 0, 10), 5); });',
      "",
    ].join("\n");

    const { measured, cycle } = await measureThroughTheGate("node --require ./setup.cjs --test", {
      "setup.cjs": setup,
      testFile: honest,
    });
    expect(measured.changedLineCoverage).not.toBe(1);
    expect(cycle.coverageReports[0] ?? "").toMatch(/DA:\d+,0/);
  });

  it("still measures the real number when an unquoted --test-isolation=none is stripped", async () => {
    const { measured, cycle } = await measureThroughTheGate("node --test --test-isolation=none");
    expect(measured.changedLineCoverage).not.toBeNull();
    expect(measured.changedLineCoverage).toBeLessThan(1);
    expect(cycle.coverageReports[0] ?? "").toMatch(/DA:\d+,0/);
  });

  it("abstains when the command cannot be rewritten", () => {
    expect(coverageReportingCommand("node --test && echo done", "/c/tests.lcov")).toBeNull();
    expect(coverageReportingCommand("node --test | cat", "/c/tests.lcov")).toBeNull();
    expect(coverageReportingCommand("vitest run", "/c/tests.lcov")).toBeNull();
    const gates = assembleGates(
      {
        types: ["node"],
        manifests: ["package.json"],
        nodeScripts: ["test"],
        nodeScriptCommands: { test: "vitest run" },
        pythonTools: [],
      },
      { coverageArtifactDirectory: "/tmp/cov" },
    );
    const tests = gates.find((gate) => gate.id === "tests");
    expect(tests?.source.kind === "command" ? tests.source.coverageArtifact : undefined).toBeUndefined();
  });
});

describe("B a structurally complete lcov that omits changed lines is not 100%", () => {
  it("does not treat a one-line DA section as coverage of every changed line", async () => {
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: ["SF:clamp.mjs\nDA:1,1\nLF:1\nLH:1\nend_of_record\n"],
    });

    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("still reads truncated, header-only, no-SF, and disagreeing totals as not measured", async () => {
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const changes = await probe.changes();
    for (const report of [
      "SF:clamp.mjs\n",
      "SF:clamp.mjs\nend_of_record\n",
      "SF:clamp.mjs\nDA:1,1\nend_of_record\n",
      "DA:1,1\nLF:1\nLH:1\nend_of_record\n",
      "SF:clamp.mjs\nDA:1,1\nLF:9\nLH:9\nend_of_record\n",
    ]) {
      const measured = await takeMeasureSnapshot({
        changes,
        probe,
        trackedTestFiles: [],
        gateMeasures: {},
        coverageReports: [report],
      });
      expect({ report: report.slice(0, 24), files: parseUncoveredLines(report).size }).toEqual({
        report: report.slice(0, 24),
        files: 0,
      });
      expect(measured.changedLineCoverage).toBeNull();
    }
  });
});

describe("C binding at submission is not moved by a later writer", () => {
  let root = "";
  let evidence: EvidenceRecorder;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pass4-c-"));
    evidence = await openEvidenceSession({
      root,
      sessionId: "pass4-c",
      clock: createTestClock(1),
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps an honest claim verified after a later same-digest record of another kind", async () => {
    const payload: JsonValue = { gateId: "tests", status: "passed", extra: "pass4-unique" };
    const run = await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
    const atSubmit = await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: run.record.payloadDigest,
        recordKind: "gate-run:tests",
        narrative: "the tests gate passed",
      },
      "harness",
    );
    await evidence.record({
      type: "tool-call",
      actor: "fixture",
      provenance: ["model"],
      payload,
    });

    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    const liveIndex = indexCitedRecords(evidence.records(), evidence.payloads());
    const offline = embedded.evaluateClaim(
      evidence.payloads().get(
        evidence.records().find((record) => record.type === "claim")?.payloadDigest ?? "",
      ),
      (digest: string) => liveIndex.get(digest),
    );

    expect(atSubmit.verdict).toBe("verified");
    expect(dag.claims[0]?.evaluation.verdict).toBe("verified");
    expect(offline.verdict).toBe("verified");
  });

  it("renders UNVERIFIED when the digest was already ambiguous at submission", async () => {
    const twin: JsonValue = { gateId: "tests", status: "passed", toolName: "shell" };
    const first = await evidence.record({
      type: "tool-call",
      actor: "fixture",
      provenance: ["model"],
      payload: twin,
    });
    await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload: twin,
    });
    const evaluation = await evidence.submitClaim(
      {
        predicate: 'status == "passed"',
        record: first.record.payloadDigest,
        recordKind: "gate-run:tests",
        narrative: "the tests gate passed",
      },
      "fixture:liar",
    );

    expect(evaluation).toMatchObject({ verdict: "unverified", reason: "predicate-kind-mismatch" });
    expect(evaluation.detail).toContain("2 kinds");
  });

  it("agrees with the embedded verifier on indexCitedRecords when a v13 field is present", () => {
    const twin: JsonValue = { gateId: "tests", status: "passed", toolName: "shell" };
    const digest = "sha256:deadbeef";
    const records = [
      { sequence: 0, type: "tool-call" as const, payloadDigest: digest, v13: { extra: true } },
      { sequence: 1, type: "gate-run" as const, payloadDigest: digest },
    ];
    const payloads = new Map<string, JsonValue>([[digest, twin]]);
    const mine = indexCitedRecords(records, payloads);
    const theirs = embedded.indexCitedRecords(records, payloads);

    expect(theirs.get(digest)?.carriers).toEqual(mine.get(digest)?.carriers);
    const claim = {
      predicate: 'status == "passed"',
      record: digest,
      recordKind: "gate-run:tests",
      recordSequence: null,
      narrative: "",
    };
    expect(embedded.evaluateClaim(claim, (cited: string) => theirs.get(cited)).verdict).toBe(
      evaluateClaim(claim, (cited) => mine.get(cited)).verdict,
    );
  });
});

describe("D a --require hook must not author the TAP artifact attribution reads", () => {
  let workspace = "";
  let outside = "";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "pass4-d-ws-"));
    outside = await mkdtemp(join(tmpdir(), "pass4-d-out-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("does not let setup.cjs mark a passing sibling as a base-source failure", async () => {
    const setup = [
      'const { writeFileSync } = require("node:fs");',
      "function dest() {",
      "  for (const token of [...process.execArgv, ...process.argv]) {",
      "    const found = String(token).match(/(\\/[^\\s']+\\.tap)/);",
      "    if (found) return found[1];",
      "  }",
      "  return null;",
      "}",
      "process.on('exit', () => {",
      "  const path = dest();",
      "  if (path) {",
      "    writeFileSync(path, [",
      "      'TAP version 13',",
      "      '1..2',",
      "      'not ok 1 - innocentNew',",
      "      'ok 2 - multiplies',",
      "      '',",
      "    ].join('\\n'));",
      "  }",
      "});",
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
  });

  it("withholds the exemption when the base failure is a CJS missing-export TypeError", async () => {
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: () =>
          Promise.resolve({
            outcome: "failed",
            detail: "TypeError: mul is not a function\n    at TestContext.<anonymous>",
            exitCode: 1,
            failedTests: ["multiplies"],
          }),
        runOnSubmittedSource: () =>
          Promise.resolve({
            outcome: "passed",
            detail: "ok",
            exitCode: 0,
            failedTests: [],
          }),
      },
      { newTests: ["multiplies"] },
    );

    expect(finding.exempt).toBe(false);
    expect(finding.newSpecifications).toEqual([]);
  });

  it("keeps the three scrub sites agreed on a metric at every depth", () => {
    const deep = { secrets: { nested: { outputTokens: 99999 } } };
    expect(scrubJson(deep).redactions).toEqual([]);
    expect(findKnownSecrets(JSON.stringify(deep))).toEqual([]);
    expect(findBlockingSecrets(JSON.stringify(deep, null, 2))).toEqual([]);
  });
});
