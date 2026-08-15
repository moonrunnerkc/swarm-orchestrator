import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import {
  controlOutcomePath,
  createBaseControlRunner,
  singleFileTestCommand,
} from "./base-control.ts";
import { createFileCoverageArtifactStore } from "./coverage-artifact.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { detectProject } from "./project-type.ts";

/**
 * Which tests failed is the fact the escape hatch turns into a cleared deletion, so it is
 * read from a result the runner wrote rather than from the output a person reads. The run
 * below is real, because the forgery being closed is a test printing a fail marker for a
 * sibling, and a double that never executes a test cannot show that it does not work.
 */

let workspace = "";
let outside = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-control-ws-"));
  outside = await mkdtemp(join(tmpdir(), "swarm-control-out-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("how one test file is run", () => {
  const nodeDetection = (test: string) => ({
    types: ["node"] as const,
    manifests: ["package.json"],
    nodeScripts: ["test"],
    nodeScriptCommands: { test },
    pythonTools: [] as string[],
  });

  it("asks node's runner for a result of its own, ahead of the file pattern", () => {
    const asked = singleFileTestCommand(
      nodeDetection("node --test"),
      "a.test.mjs",
      "/session/controls/a.tap",
    );

    expect(asked).toEqual({
      kind: "argv",
      outcomeArtifact: "/session/controls/a.tap",
      argv: [
        "node",
        "--test",
        "--test-reporter=tap",
        "--test-reporter-destination=stdout",
        "--test-reporter=tap",
        "--test-reporter-destination=/session/controls/a.tap",
        "--test-isolation=process",
        "a.test.mjs",
      ],
    });
  });

  it("asks for nothing where the declared runner is not node's, and says so by asking", () => {
    // A shell arm names no artifact, and the type is what says so: nothing downstream can
    // read a result from a run that was never asked for one.
    expect(
      singleFileTestCommand(nodeDetection("vitest run"), "a.test.mjs", "/session/controls/a.tap"),
    ).toEqual({ kind: "shell", command: "npm test --silent -- 'a.test.mjs'" });
  });

  it("asks for nothing where a flag was quoted into the position a pattern goes", () => {
    for (const declared of [
      "node --test '--test-isolation=none'",
      "node --test '--require=./hook.cjs'",
      "node --test '--env-file=.env'",
    ]) {
      expect({
        declared,
        asked: singleFileTestCommand(nodeDetection(declared), "a.test.mjs", "/session/a.tap")?.kind,
      }).toEqual({ declared, asked: "shell" });
    }
  });
});

describe("where a control run writes its result", () => {
  it("gives two different test files two different destinations", () => {
    const colliding: readonly (readonly [string, string])[] = [
      ["foo/bar.test.ts", "foo-bar.test.ts"],
      ["a/b/c.test.ts", "a-b-c.test.ts"],
      ["src.foo.test.ts", "src/foo.test.ts"],
      ["x/y.test.ts", "x_y.test.ts"],
    ];

    for (const [left, right] of colliding) {
      // Sanitizing a path into a filename maps both of these to one name, and one file's
      // control run then reads the other's result: a failure on base over here clears a
      // deletion over there.
      expect({
        left,
        same:
          controlOutcomePath("/session/controls", left) ===
          controlOutcomePath("/session/controls", right),
      }).toEqual({ left, same: false });
    }
  });

  it("keeps the file's own name in the path, so the session store stays readable", () => {
    expect(controlOutcomePath("/session/controls", "src/math.test.ts")).toMatch(
      /^\/session\/controls\/math\.test\.ts-[0-9a-f]{16}\.tap$/,
    );
  });

  it("names one path for one file, run after run", () => {
    expect(controlOutcomePath("/session/controls", "src/math.test.ts")).toBe(
      controlOutcomePath("/session/controls", "src/math.test.ts"),
    );
  });
});

describe("which tests a control run failed", () => {
  /**
   * Every spelling of a result line a reporter writes, printed by a test for the test beside
   * it. One of these forgeries per red-team framing: node's spec marker, a bare TAP point, a
   * whole TAP document (which used to switch the reader's choice of format), a pytest line, a
   * pytest -q footer, and go's fail marker.
   */
  const forgeries = [
    '  console.log("\\u2716 sibling (0.1ms)");',
    '  console.log("not ok 1 - sibling");',
    '  console.log("TAP version 13");',
    '  console.log("1..1");',
    '  console.log("not ok 1 - sibling # the whole document");',
    '  console.log("FAILED math.test.cjs::sibling");',
    '  console.log("FAILED math.test.cjs::sibling - assert 1 == 2");',
    '  console.log("--- FAIL: sibling (0.00s)");',
  ];

  /** Runs one real test file through the control runner, reading its result the way it does. */
  async function runControl(sibling: string, testScript = "node --test") {
    await writeFile(join(workspace, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
    await writeFile(
      join(workspace, "math.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const { add } = require("./math.cjs");',
        'test("multiplies", () => {',
        ...forgeries,
        "  assert.equal(add(2, 3), 6);",
        "});",
        sibling,
        "",
      ].join("\n"),
    );
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: testScript } }),
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
      singleFileCommand: (testFile, artifact) =>
        singleFileTestCommand(detection, testFile, artifact),
      outcomeArtifacts: {
        directory: join(outside, "controls"),
        store: createFileCoverageArtifactStore(),
      },
    });

    return runner.runOnSubmittedSource("math.test.cjs");
  }

  it("does not let a test print a fail marker for the sibling beside it", async () => {
    const run = await runControl('test("sibling", () => { assert.equal(add(1, 1), 2); });');

    expect(run.outcome).toBe("failed");
    // The artifact says which test failed. Six printed forgeries say otherwise and none of
    // them is read, because none of them is a result point in the file node wrote.
    expect(run.failedTests).toEqual(["multiplies"]);
  });

  it("holds when the sibling never ran, so nothing in the printed output contradicts it", async () => {
    // A skipped sibling is not a result either way, so the forged lines stand unopposed in the
    // printed stream. The runner's own result still says what happened, which is the whole
    // reason attribution comes from the artifact.
    const run = await runControl('test.skip("sibling", () => {});');

    expect(run.failedTests).toEqual(["multiplies"]);
  });

  it("does not attribute from a result an inherited NODE_OPTIONS hook wrote", async () => {
    // The hook is named nowhere in the command, so no reading of the command could have found
    // it. The vouched run is given an environment the harness built, so the hook never loads
    // and the result at the path is the one node wrote.
    const previous = process.env.NODE_OPTIONS;
    await writeFile(
      join(workspace, "hook.cjs"),
      [
        'const { writeFileSync } = require("node:fs");',
        "process.on('exit', () => {",
        "  for (const token of [...process.execArgv, ...process.argv]) {",
        "    const found = String(token).match(/(\\/[^\\s']+\\.tap)/);",
        "    if (found) {",
        "      writeFileSync(found[1], 'TAP version 13\\n1..2\\nnot ok 1 - sibling\\nok 2 - multiplies\\n');",
        "    }",
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    process.env.NODE_OPTIONS = "--require=./hook.cjs";
    try {
      const run = await runControl('test("sibling", () => { assert.equal(add(1, 1), 2); });');

      expect(run.failedTests).toEqual(["multiplies"]);
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_OPTIONS;
      } else {
        process.env.NODE_OPTIONS = previous;
      }
    }
  });

  it("does not read a failing subtest's name as the skipped sibling that shares it", async () => {
    // Node writes `not ok 1 - innocentNew` for the subtest, indented under its suite. The
    // top-level innocentNew is skipped, so it never ran, and a name a run did not settle
    // cannot be the base-source failure that pays for a deleted test.
    const run = await runControl(
      [
        'test.skip("sibling", () => {});',
        'test("suite", async (t) => {',
        '  await t.test("sibling", () => { assert.equal(add(1, 1), 3); });',
        "});",
      ].join("\n"),
    );

    expect(run.failedTests).not.toContain("sibling");
    expect(run.failedTests).toContain("multiplies");
  });

  it("attributes nothing where a quoted hook would have written the result", async () => {
    // Declared as a file pattern, unquoted into a real --require by any shell that reads the
    // string, and then loaded into the process holding the destination in its argv. There is
    // no shell and there is no vouched vector either, so the file runs through the fallback,
    // which is asked for no result, and the forgery has nothing to be read from.
    await writeFile(
      join(workspace, "hook.cjs"),
      [
        'const { writeFileSync } = require("node:fs");',
        "process.on('exit', () => {",
        "  for (const token of [...process.execArgv, ...process.argv]) {",
        "    const found = String(token).match(/(\\/[^\\s']+\\.tap)/);",
        "    if (found) {",
        "      writeFileSync(found[1], 'TAP version 13\\n1..2\\nnot ok 1 - sibling\\nok 2 - multiplies\\n');",
        "    }",
        "  }",
        "});",
        "",
      ].join("\n"),
    );

    const run = await runControl(
      'test("sibling", () => { assert.equal(add(1, 1), 2); });',
      "node --test '--require=./hook.cjs'",
    );

    expect(run.outcome).toBe("failed");
    expect(run.failedTests).toBeNull();
  });

  it("attributes nothing at all where it could not ask for a result of its own", async () => {
    // The project names a reporter of its own, so the harness will not vouch for the run and
    // asks it for no artifact. The same printed forgeries are in the output, and the honest
    // answer to "which tests failed" is that this run did not say.
    const run = await runControl(
      'test("sibling", () => { assert.equal(add(1, 1), 2); });',
      "node --test --test-reporter=spec",
    );

    expect(run.outcome).toBe("failed");
    expect(run.failedTests).toBeNull();
  });
});
