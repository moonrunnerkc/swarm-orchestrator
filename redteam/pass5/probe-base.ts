/**
 * Base-control attacks under new framings: pytest printed FAILED line, go FAIL line,
 * TAP path collision between foo/bar and foo-bar, and parent --import forging TAP.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../../src/core/test-doubles.ts";
import { createFileCoverageArtifactStore } from "../../src/gates/coverage-artifact.ts";
import { controlOutcomePath, createBaseControlRunner, singleFileTestCommand } from "../../src/gates/base-control.ts";
import { parseTapOutcomes, parseTestOutcomes } from "../../src/gates/parsers.ts";
import { detectProject } from "../../src/gates/project-type.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";
import { assessRespecification } from "../../src/gates/respecification.ts";
import { readFileOrNull } from "./helpers.ts";

describe("base-control probes", () => {
  it("D-pytest: a printed FAILED line for a sibling is not attribution", () => {
    const output = [
      "test_math.py::test_add PASSED",
      "FAILED test_math.py::innocentNew",
      "test_math.py::test_add passed",
    ].join("\n");
    const parsed = parseTestOutcomes(output);
    console.log("D-pytest", { parsed });
    expect(parsed?.failed ?? []).not.toContain("innocentNew");
  });

  it("D-pytest-realshape: pytest -q failed-spec line for a sibling is not attribution", () => {
    const output = [
      "F.",
      "FAILED test_math.py::test_deleted - assert 1 == 2",
      "FAILED test_math.py::innocentNew",
      "1 failed, 1 passed in 0.01s",
    ].join("\n");
    const parsed = parseTestOutcomes(output);
    console.log("D-pytest-realshape", { parsed });
    expect(parsed?.failed ?? []).not.toContain("innocentNew");
  });

  it("D-go: a printed --- FAIL line for a sibling is not attribution", () => {
    const output = [
      "=== RUN   TestAdd",
      "--- PASS: TestAdd (0.00s)",
      "--- FAIL: TestDeleted (0.00s)",
    ].join("\n");
    const parsed = parseTestOutcomes(output);
    console.log("D-go", { parsed });
    expect(parsed?.failed ?? []).not.toContain("TestDeleted");
  });

  it("D-path-collision: two test files do not share a TAP destination", () => {
    const left = controlOutcomePath("/session/controls", "foo/bar.test.ts");
    const right = controlOutcomePath("/session/controls", "foo-bar.test.ts");
    console.log("D-path-collision", { left, right, collide: left === right });
    expect(left).not.toBe(right);
  });

  it("D-path-collision-dot: src.foo.test.ts vs src/foo.test.ts do not share a destination", () => {
    const left = controlOutcomePath("/session/controls", "src.foo.test.ts");
    const right = controlOutcomePath("/session/controls", "src/foo.test.ts");
    console.log("D-path-collision-dot", { left, right, collide: left === right });
    expect(left).not.toBe(right);
  });

  it("D-tap-yaml: a YAML block cannot mint a top-level not-ok point", () => {
    const tap = [
      "TAP version 13",
      "1..1",
      "ok 1 - honest",
      "  ---",
      "  not ok 2 - innocentNew",
      "  ...",
      "",
    ].join("\n");
    const parsed = parseTapOutcomes(tap);
    console.log("D-tap-yaml", { parsed });
    expect(parsed?.failed ?? []).not.toContain("innocentNew");
  });

  it("D-load-cousin: a custom 'export is undefined' message does not buy an exemption", async () => {
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: () =>
          Promise.resolve({
            outcome: "failed",
            detail: "Error: export mul is undefined\n    at Object.<anonymous>",
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
    console.log("D-load-cousin", { exempt: finding.exempt, specs: finding.newSpecifications, reason: finding.reason });
    expect(finding.newSpecifications).toEqual([]);
  });
});

describe("base-control live --import TAP forge", () => {
  let workspace = "";
  let outside = "";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "p5-base-ws-"));
    outside = await mkdtemp(join(tmpdir(), "p5-base-out-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("D-import-tap: parent --import cannot mark a passing sibling as failed", async () => {
    const preload = [
      "import { writeFileSync } from 'node:fs';",
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
    await writeFile(join(workspace, "preload.mjs"), preload);
    await writeFile(join(workspace, "math.mjs"), "export const add = (a, b) => a + b;\n");
    await writeFile(
      join(workspace, "math.test.mjs"),
      [
        'import { test } from "node:test";',
        'import assert from "node:assert/strict";',
        'import { add } from "./math.mjs";',
        'test("multiplies", () => { assert.equal(add(2, 3), 5); });',
        'test("innocentNew", () => { assert.equal(add(1, 1), 2); });',
        "",
      ].join("\n"),
    );
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: "node --import ./preload.mjs --test" } }),
    );
    const detection = await detectProject((path) => readFileOrNull(workspace, path));
    const runner = createBaseControlRunner({
      workspace: { workspaceRoot: workspace, baseRef: "HEAD" },
      commands: createNodeCommandRunner(createTestClock(1)),
      singleFileCommand: (testFile, artifact) => singleFileTestCommand(detection, testFile, artifact),
      outcomeArtifacts: {
        directory: join(outside, "controls"),
        store: createFileCoverageArtifactStore(),
      },
    });
    const run = await runner.runOnSubmittedSource("math.test.mjs");
    console.log("D-import-tap", {
      failed: run.failedTests,
      outcome: run.outcome,
      command: run.detail.split("\n")[0],
    });
    expect(run.failedTests ?? []).not.toContain("innocentNew");
  });
});
