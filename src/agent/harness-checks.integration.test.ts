import { describe, expect, it } from "vitest";
import { failureLine, testsTouched } from "./harness-turn.ts";
import { asksForTests } from "./requirement-record.ts";
import { bash, fixture, scripted, write } from "./test-doubles.ts";

const wrong = write("half.mjs", "export const half = (n) => n * 3;");
const fix = write("half.mjs", "export const half = (n) => n / 2;");

describe("the harness runs the checks, not the model", () => {
  // t6 and h2 (2026-11-03): one edit to the source, no test run, then the same reads until the
  // read-loop stop, 25 and 18 turns in. Here the checks run after the edit, and the third turn
  // that changes nothing ends the run naming the requirement still failing.
  it("ends a run that edits once and then only reads, naming the failing requirement", async () => {
    const model = scripted([
      wrong,
      bash("cat half.mjs"),
      bash("cat test/half.test.mjs"),
      bash("grep -n half half.mjs"),
      bash("ls"),
    ]);
    const ran = await (await fixture()).run(model, { maxSteps: 20 });
    expect(ran.stop).toBe("no-progress");
    expect(ran.report.reason).toMatch(
      /^3 turns changed neither the tree nor any check's result; R1 still fails: its authored test fails:/,
    );
    expect(ran.report.resources.steps).toBe(4);
    // The second quiet turn is told so once, before the third ends it.
    expect(model.seen[3]?.at(-1)?.content).toContain(
      "Your last 2 turns changed neither the tree nor any check's result.",
    );
    expect(ran.report.resources.harnessChecks).toBeGreaterThan(0);
    expect(ran.report.resources.modelTestCommands).toBe(0);
  });

  it("completes on the checks alone when the model never runs a test or marks the task done", async () => {
    const model = scripted([bash("cat half.mjs"), fix, bash("echo never sent")]);
    const ran = await (await fixture()).run(model, { maxSteps: 20 });
    expect(ran).toMatchObject({ stop: "complete", report: { state: "complete" } });
    expect(ran.report.resources).toMatchObject({ steps: 2, modelTestCommands: 0 });
    expect(ran.report.resources.turnsByRequirement).toEqual({ R1: 2 });
  });

  it("keeps a task that asks for tests open until the change adds one", async () => {
    const task = "Make half(n) return n / 2, with a test.";
    const own = write(
      "test/half-exact.test.mjs",
      'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half(6) is 3", () => assert.equal(half(6), 3));',
    );
    const model = scripted([fix, own]);
    const ran = await (await fixture({}, task)).run(model, { maxSteps: 20 });
    expect(ran.report.state).toBe("complete");
    expect(ran.report.resources.steps).toBe(2);
    expect(model.seen[1]?.at(-1)?.content).toContain(
      "the task asks for tests, and the change adds none yet",
    );
  });
});

describe("reading the wording and the diff", () => {
  it("reads a request for tests, and not a test suite that must stay green", () => {
    expect(asksForTests("Fix it, with a test.")).toBe(true);
    expect(asksForTests("Document the flag in the --help text. Add tests.")).toBe(true);
    expect(asksForTests("Typecheck, build and the test suite must stay green.")).toBe(false);
    expect(asksForTests("the tests stay as they are")).toBe(false);
  });

  it("finds the test files a diff adds or changes, the harness's own left out", () => {
    const diff = [
      "+++ b/src/cli.ts",
      "+++ b/test/cli.test.ts",
      "+++ b/tests/unit/test_promote.py",
      "+++ b/.swarm/scratch/x.test.ts",
    ].join("\n");
    expect(testsTouched(diff)).toEqual(["test/cli.test.ts", "tests/unit/test_promote.py"]);
  });
});

describe("a failing check in one line", () => {
  it("joins its summary to the first output line that names what failed", () => {
    expect(
      failureLine("its authored test fails:\n\n   x\nFAILED tests/a.py::t - assert 4 == 2\nmore"),
    ).toBe("its authored test fails: FAILED tests/a.py::t - assert 4 == 2");
    expect(failureLine("src/a.py lacks x: the file still contains it")).toBe(
      "src/a.py lacks x: the file still contains it",
    );
  });
});
