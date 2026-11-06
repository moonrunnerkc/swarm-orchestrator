import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Chokepoint, ShellOutcome } from "../tools/chokepoint.ts";
import { runAtBase } from "./authored-validation.ts";

const task = "Add a --reviewers option to parseArgs, and have main give the list to orchestrate.";
const failing = (title: string, error: string) =>
  ` FAIL  test/cli.swarm-r1.test.ts > reviewers > ${title}\n${error}\n`;

/** A chokepoint whose every check prints the same vitest run, failing. */
function printing(output: string): Chokepoint {
  const outcome: ShellOutcome = { decision: "allowed", output, exitCode: 1, record: "sha256:0" };
  return { run: async () => outcome, edit: async () => outcome, check: async () => outcome };
}

const test = {
  requirement: "R1",
  path: "test/cli.swarm-r1.test.ts",
  command: "npx vitest run test/cli.swarm-r1.test.ts",
  content: "// laid in\n",
};

describe("an authored control case", () => {
  // pubprep (2026-11-05, rc.12): main() was driven from /tmp and refused before the work.
  it("refuses the check where it fails at the base, naming its error", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "control-"));
    const output = [
      failing("passes the list to orchestrate", "Error: Unknown flag: --reviewers."),
      failing(
        "control: main without the flag runs all three reviewers",
        'AssertionError: expected "spy" to be called at least once',
      ),
    ].join("");
    const ran = await runAtBase(printing(output), workspace, test, task, "feature");
    expect(ran.reasons).toEqual([
      'its control case "control: main without the flag runs all three reviewers" fails at the base with AssertionError: expected "spy" to be called at least once: existing behavior through the same setup must pass now, so the setup does not reach the code; set it up as the repository\'s own tests do',
    ]);
    expect(await readdir(join(workspace, "test"))).toEqual([]);
  });

  it("lets the check stand where only the task's cases fail at the base", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "control-"));
    const output = failing("passes the list to orchestrate", "Error: Unknown flag: --reviewers.");
    const ran = await runAtBase(printing(output), workspace, test, task, "feature");
    expect(ran.reasons).toEqual([]);
  });

  // pubprep (2026-11-05 trial 10): main() ran in an empty directory and printed that it is not a
  // git repository, and the control's assertion held with orchestrate never called.
  it("refuses the check where the control, run alone, makes the code print an error", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "control-"));
    const base = failing(
      "passes the list to orchestrate",
      "AssertionError: expected spy to be called",
    );
    const alone =
      "error: not in a git repository (run pubprep from inside one)\n ✓ control: runs\n";
    const ran: string[] = [];
    const outcome = (output: string): ShellOutcome => ({
      decision: "allowed",
      output,
      exitCode: 1,
      record: "",
    });
    const chokepoint: Chokepoint = {
      run: async () => outcome(""),
      edit: async () => outcome(""),
      check: async (command) => {
        ran.push(command);
        return outcome(command.includes(" -t ") ? alone : base);
      },
    };
    const content = 'it("control: main without the flag reaches orchestrate", async () => {});\n';
    const result = await runAtBase(chokepoint, workspace, { ...test, content }, task, "feature");
    expect(ran[1]).toContain("-t 'control: main without the flag reaches orchestrate$'");
    expect(result.reasons[0]).toMatch(
      /^its control case "control: main without the flag reaches orchestrate" makes the code print "error: not in a git repository/,
    );
    expect(await readdir(join(workspace, "test"))).toEqual([]);
  });
});

describe("an authored case that passes when run alone", () => {
  // pubprep (2026-11-05, rc.13 and rc.17): it read orchestrate's first mocked call, made by an
  // earlier case, and failed on every tree.
  it("is left out by name, since what fails it is another case's leftovers", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "alone-"));
    const base = [
      failing("parses the list", "Error: Unknown flag: --reviewers."),
      failing(
        "passes --reviewers to orchestrate",
        "AssertionError: expected undefined to equal [ 'docs' ]",
      ),
    ].join("");
    const outcome = (output: string, exitCode: number): ShellOutcome => ({
      decision: "allowed",
      output,
      exitCode,
      record: "",
    });
    const chokepoint: Chokepoint = {
      run: async () => outcome("", 0),
      edit: async () => outcome("", 0),
      check: async (command) => {
        if (command.includes("'passes --reviewers to orchestrate$'"))
          return outcome(" ✓ passes\n", 0);
        if (command.includes("(?!"))
          return outcome(failing("parses the list", "Error: Unknown flag"), 1);
        return outcome(
          command.includes(" -t ") ? failing("parses the list", "Error: Unknown flag") : base,
          1,
        );
      },
    };
    const ran = await runAtBase(chokepoint, workspace, test, task, "feature");
    expect(ran.reasons).toEqual([]);
    expect(ran.excluded).toEqual(["passes --reviewers to orchestrate"]);
  });
});

describe("a control case under a coverage threshold", () => {
  // ironroot (2026-11-05, rc.19): run alone, it passed and pytest-cov printed the threshold's error.
  it("is not taken for the code refusing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coverage-"));
    const base = failing("test_scan_finds_the_pattern", "AssertionError: assert [] == ['x']");
    const alone = "1 passed\nERROR: Coverage failure: total of 2 is less than fail-under=30\n";
    const outcome = (output: string): ShellOutcome => ({
      decision: "allowed",
      output,
      exitCode: 1,
      record: "",
    });
    const chokepoint: Chokepoint = {
      run: async () => outcome(""),
      edit: async () => outcome(""),
      check: async (command) => outcome(command.includes(" -k ") ? alone : base),
    };
    const content = "def test_control_scan_basic():\n    assert True\n";
    const pytest = {
      ...test,
      path: "tests/test_scan_swarm_r1.py",
      command: "python3 -m pytest -q tests/test_scan_swarm_r1.py",
      content,
    };
    const ran = await runAtBase(chokepoint, workspace, pytest, task, "fix");
    expect(ran.reasons.join(" ")).not.toMatch(/control case/);
  });
});
