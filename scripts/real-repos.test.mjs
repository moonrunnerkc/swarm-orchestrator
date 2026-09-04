import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { arms, pinnedCommit, renderReport, repositories, scoreFromRecords, taskText, tokensFromRecords } from "./real-repos.mjs";

const repositoryRoot = join(import.meta.dirname, "..");
const evidenceRoot = join(repositoryRoot, "docs", "evidence", "2026-09-04", "real-repos");

describe("the task text", () => {
  it("is the verbatim section of task.md, folded onto one line", () => {
    const text = taskText("# Task\n\n## The task text both arms are given, verbatim\n\nDo the\nthing.\n\n## What the hidden test checks\n\nnot this\n");
    expect(text).toBe("Do the thing.");
  });

  it("refuses a task.md without the section rather than handing the model nothing", () => {
    expect(() => taskText("# Task\n\nno section\n")).toThrow(/verbatim/);
  });

  it("is present for every repository the driver names, with a hidden test beside it", () => {
    for (const [name, repository] of Object.entries(repositories)) {
      expect(taskText(readFileSync(join(evidenceRoot, name, "task.md"), "utf8")).length).toBeGreaterThan(100);
      expect(() => readFileSync(join(evidenceRoot, repository.hidden.file))).not.toThrow();
    }
  });
});

describe("the pinned commit", () => {
  it("comes from the campaign's sealed selection and agrees with what task.md says", () => {
    const selection = JSON.parse(readFileSync(join(repositoryRoot, "campaign/selection/repos.json"), "utf8"));
    for (const [name, repository] of Object.entries(repositories)) {
      const commit = pinnedCommit(repository.fullName, selection);
      expect(readFileSync(join(evidenceRoot, name, "task.md"), "utf8")).toContain(commit.slice(0, 10));
    }
    expect(() => pinnedCommit("nobody/nothing", selection)).toThrow(/not in the campaign selection/);
  });
});

function gateRun(gateId, status, attempt, command = "npm test") {
  return { type: "gate-run", payload: { gateId, status, attempt, blocking: true, command } };
}

describe("scoring from a gates bundle", () => {
  it("reads the last cycle's statuses, the base measures, and green as no blocking failure over a ran command", () => {
    const score = scoreFromRecords([
      gateRun("tests", "failed", 0),
      gateRun("tests", "passed", 1),
      gateRun("lint", "passed", 1),
      gateRun("placeholder", "passed", 1, null),
      { type: "ratchet-decision", payload: { scope: "retry", attempt: 1, measures: { after: { assertions: 1 } } } },
      { type: "ratchet-decision", payload: { scope: "base", attempt: 0, measures: { after: { testsDeclared: 4, assertions: 9, skipMarkers: 0, testsCollected: 12, changedLineCoverage: 0.8 } } } },
    ]);

    expect(score.gates).toEqual({ tests: "passed", lint: "passed", placeholder: "passed" });
    expect(score.measures).toEqual({ testsDeclared: 4, assertions: 9, skipMarkers: 0, testsCollected: 12, changedLineCoverage: 0.8 });
    expect(score.green).toBe(true);
  });

  it("is not green where every command gate stood down, whatever the inspections said", () => {
    const score = scoreFromRecords([gateRun("tests", "not-applicable", 0), gateRun("placeholder", "passed", 0, null)]);
    expect(score.green).toBe(false);
    expect(score.measures).toBeNull();
  });

  it("names the blocking failures", () => {
    expect(scoreFromRecords([gateRun("tests", "failed", 0), gateRun("lint", "passed", 0)]).blockingFailures).toEqual(["tests"]);
  });
});

describe("tokens from a run bundle", () => {
  it("sums the model calls", () => {
    expect(
      tokensFromRecords([
        { type: "model-call", payload: { inputTokens: 100, outputTokens: 10 } },
        { type: "tool-call", payload: {} },
        { type: "model-call", payload: { inputTokens: 200, outputTokens: 20 } },
      ]),
    ).toEqual({ calls: 2, input: 300, output: 30 });
  });
});

describe("the report", () => {
  const record = (name, arm, run, overrides = {}) => ({
    name,
    arm,
    run,
    wallMs: 60_000 * run,
    tokens: { calls: 5, input: 1000, output: 100 * run },
    score: { green: true, measures: { testsDeclared: 10 + run, assertions: 20, skipMarkers: 0, testsCollected: 30, changedLineCoverage: null } },
    hiddenTest: { passed: run !== 2 },
    ...overrides,
  });

  it("gives every arm a row per repository, distributions over the runs, and NOT-DONE where an arm did not run", () => {
    const report = renderReport([record("purify", "swarm", 1), record("purify", "swarm", 2), record("purify", "swarm", 3)], "2026-09-04");

    expect(report).toContain("single arm");
    expect(report).toContain("## purify");
    expect(report).toContain("| swarm | 3 | 3 of 3 | 2 of 3 | 11 / 12 / 13 | 20 / 20 / 20 | 0 / 0 / 0 | 30 / 30 / 30 | not measured | 60 / 120 / 180 | 100 / 200 / 300 |");
    expect(report).toContain("| baseline | 0 | NOT-DONE |");
  });

  it("says two arms once the baseline ran", () => {
    expect(renderReport([record("purify", "swarm", 1), record("purify", "baseline", 1)], "2026-09-04")).toContain("two arms");
  });

  it("names the arms in the order the table lists them", () => {
    expect(arms).toEqual(["swarm", "baseline"]);
  });
});
