import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { createBaseControlRunner, singleFileTestCommand } from "./base-control.ts";
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

describe("the command one test file is run with", () => {
  it("asks node's runner for a result of its own, ahead of the file pattern", () => {
    const detection = {
      types: ["node"] as const,
      manifests: ["package.json"],
      nodeScripts: ["test"],
      nodeScriptCommands: { test: "node --test" },
      pythonTools: [] as string[],
    };
    const asked = singleFileTestCommand(detection, "a.test.mjs", "/session/controls/a.tap");

    expect(asked).toContain("--test-reporter-destination='/session/controls/a.tap'");
    expect(asked).toContain("--test-isolation=process");
    // Node ignores reporter flags that arrive after a file pattern, so they go before it.
    expect(asked?.indexOf("--test-reporter=tap")).toBeLessThan(asked?.indexOf("a.test.mjs") ?? -1);
  });

  it("asks for nothing where the declared runner is not node's, and says so by asking", () => {
    const detection = {
      types: ["node"] as const,
      manifests: ["package.json"],
      nodeScripts: ["test"],
      nodeScriptCommands: { test: "vitest run" },
      pythonTools: [] as string[],
    };

    expect(singleFileTestCommand(detection, "a.test.mjs", "/session/controls/a.tap")).toBe(
      "npm test --silent -- 'a.test.mjs'",
    );
  });
});

describe("which tests a control run failed", () => {
  /** Runs one real test file through the control runner, reading its result the way it does. */
  async function runControl(sibling: string) {
    await writeFile(join(workspace, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
    await writeFile(
      join(workspace, "math.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const { add } = require("./math.cjs");',
        // The forgery: a failing test names its sibling in the reporter's own syntax, in both
        // of the spellings a node reporter uses.
        'test("multiplies", () => {',
        '  console.log("\\u2716 sibling (0.1ms)");',
        '  console.log("not ok 1 - sibling");',
        "  assert.equal(add(2, 3), 6);",
        "});",
        sibling,
        "",
      ].join("\n"),
    );
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: "node --test" } }),
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
    expect(run.failedTests).toEqual(["multiplies"]);
  });

  it("holds when the sibling never ran, so nothing in the printed output contradicts it", async () => {
    // A skipped sibling reports itself under a marker the printed reading does not read as a
    // result, so the forged line stands unopposed there. The runner's own result still says
    // what happened, which is the whole reason attribution comes from the artifact.
    const run = await runControl('test.skip("sibling", () => {});');

    expect(run.failedTests).toEqual(["multiplies"]);
  });
});
