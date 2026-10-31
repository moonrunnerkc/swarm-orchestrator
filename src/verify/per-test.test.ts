import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckRun } from "./checks.ts";
import { compareReports, judgeCheck, killedBy, type MeasuredRun } from "./per-test.ts";
import type { CheckResult } from "./predicate.ts";
import { parseReport, type Runner, type TestEvidence, type TestReport } from "./test-report.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", "reports", name), "utf8");

// Recorded from one tiny project per runner (pytest 9.0.3, jest 29.7.0, vitest 4.1.11,
// mocha 11.8.0, go 1.26.3) with the project root rewritten to /work/calc. Between the two runs
// the change fixes `fixed`, breaks `broken`, leaves `red` failing, deletes `gone` and adds `added`.
const recorded: readonly (readonly [Runner, string, string])[] = [
  ["pytest", "pytest-base.xml", "pytest-head.xml"],
  ["jest", "jest-base.json", "jest-head.json"],
  ["vitest", "vitest-base.json", "vitest-head.json"],
  ["mocha", "mocha-base.json", "mocha-head.json"],
  ["go", "go-base.jsonl", "go-head.jsonl"],
];
const read = (runner: Runner, name: string) =>
  parseReport(runner, fixture(name), "/work/calc", "example.com/calc") as TestReport;
const named = (ids: readonly string[]) => ids.map((id) => id.replace(/^.*(?:::|\s|_)/, ""));

describe.each(recorded)("judging %s reports test by test", (runner, baseFile, headFile) => {
  const base = read(runner, baseFile);
  const head = read(runner, headFile);

  it("tells fixed, regressed, pre-existing, deleted and added tests apart", () => {
    const compared = compareReports(base, head, () => false);
    expect(named(compared.fixed)).toEqual([expect.stringMatching(/fixed$/i)]);
    expect(named(compared.regressed)).toEqual([expect.stringMatching(/broken$/i)]);
    expect(named(compared.preExisting)).toEqual([expect.stringMatching(/red$/i)]);
    expect(named(compared.deleted)).toEqual([expect.stringMatching(/gone$/i)]);
    expect(compared.counts).toMatchObject({ passing: 1, added: 1, newlyFailing: 0 });
  });

  it("allows a deletion only where the change may edit the test's file", () => {
    const compared = compareReports(base, head, () => true);
    expect(compared.deleted).toEqual([]);
    expect(named(compared.allowedDeletions)).toEqual([expect.stringMatching(/gone$/i)]);
  });
});

const checkRun = (exitCode: number | null, notRun: string | null = null): CheckRun => ({
  result: {
    name: "test",
    command: "python3 -m pytest -q",
    kind: "test",
    result: notRun !== null ? "error" : exitCode === 0 ? "pass" : "fail",
    exitCode,
    durationMs: 1,
    outputSha256: "0".repeat(64),
  },
  outputTail: "1 failed, 3 passed",
  notRun,
});
const evidence = (report: TestReport | null, extra: Partial<TestEvidence> = {}): TestEvidence => ({
  runner: "pytest",
  report,
  unreadable: null,
  judge: null,
  ...extra,
});
const measured = (exitCode: number | null, value: TestEvidence, notRun: string | null = null) => ({
  run: checkRun(exitCode, notRun),
  evidence: value,
});
const atBase = (exitCode: number, value: TestEvidence) => ({
  result: checkRun(exitCode).result as CheckResult,
  evidence: value,
});
const never = () => false;

const pass = (file = "tests/test_a") => ({ status: "pass" as const, file });
const fail = (file = "tests/test_a") => ({ status: "fail" as const, file });

describe("a check's verdict from its reports", () => {
  it("is measured and passes where a test was fixed though the command fails at both commits", () => {
    const base = { "a::fixed": fail(), "a::red": fail(), "a::stays": pass() };
    const head = { "a::fixed": pass(), "a::red": fail(), "a::stays": pass() };
    const judged = judgeCheck(measured(1, evidence(head)), atBase(1, evidence(base)), never);
    expect(judged.run.result.result).toBe("pass");
    expect(judged.run.result.tests).toMatchObject({ fixed: ["a::fixed"], preExisting: ["a::red"] });
    expect(judged.failure).toBeNull();
    expect(judged.reasons).toEqual([
      "check test: 1 test(s) fail at the base commit and still fail, which does not block: a::red",
    ]);
  });

  it("fails on a regression, a deletion and a new failing test", () => {
    const base = { "a::one": pass(), "a::two": pass() };
    for (const head of [
      { "a::one": pass(), "a::two": fail() },
      { "a::one": pass() },
      { "a::one": pass(), "a::two": pass(), "a::new": fail() },
    ]) {
      const judged = judgeCheck(measured(1, evidence(head)), atBase(0, evidence(base)), never);
      expect(judged.run.result.result).toBe("fail");
      expect(judged.failure).toContain("$ python3 -m pytest -q");
    }
  });

  it("fails a command that exits worse though every test in its report passes", () => {
    const report = { "a::one": pass() };
    const judged = judgeCheck(measured(2, evidence(report)), atBase(0, evidence(report)), never);
    expect(judged.run.result.result).toBe("fail");
    expect(judged.reasons).toEqual([
      "check test exits 2 with the change and 0 at the base commit, though no test in its report fails",
    ]);
  });

  it("is unmeasured only where the command could not run or its report did not parse", () => {
    const report = { "a::one": pass() };
    const unparsed = evidence(null, { unreadable: "the pytest report could not be parsed" });
    const timedOut = evidence(null, { unreadable: "the command could not run: it timed out" });
    expect(judgeCheck(measured(1, unparsed), atBase(0, evidence(report)), never)).toMatchObject({
      run: { result: { result: "unmeasured" } },
      unmeasured: "check test: with the change, the pytest report could not be parsed",
    });
    expect(
      judgeCheck(measured(null, evidence(report), "it timed out"), atBase(0, timedOut), never),
    ).toMatchObject({
      run: { result: { result: "unmeasured" } },
      unmeasured: "check test: at the base commit, the command could not run: it timed out",
    });
  });

  it("falls back to the exit code where no runner is recognized, and says so", () => {
    const unrecognized = evidence(null, { runner: null });
    const judged = judgeCheck(measured(1, unrecognized), atBase(1, unrecognized), never);
    expect(judged.run.result.result).toBe("pre-existing-failure");
    expect(judged.reasons[0]).toBe(
      "check test: no test runner is recognized in its command, so its exit code judged it",
    );
  });

  it("fails a check whose assertions the change patched, but not one the base run shared", () => {
    const report = { "a::one": pass() };
    const patched = evidence(report, { judge: "the code under test changed node:assert.equal" });
    const clean = evidence(report);
    expect(judgeCheck(measured(0, patched), atBase(0, clean), never).run.result.result).toBe(
      "fail",
    );
    const exited = evidence(report, {
      judge: "2 process(es) exited before the judge could check them",
    });
    const exitedAgain = evidence(report, {
      judge: "3 process(es) exited before the judge could check them",
    });
    expect(judgeCheck(measured(0, exitedAgain), atBase(0, exited), never).run.result.result).toBe(
      "pass",
    );
  });
});

describe("a mutant against its reports", () => {
  const run = (exitCode: number, report: TestReport | null): MeasuredRun =>
    measured(exitCode, evidence(report));

  it("is killed when a test passing with the change stops passing, whatever the exit codes", () => {
    const head = run(1, { "a::one": pass(), "a::red": fail() });
    expect(killedBy(head, run(1, { "a::one": fail(), "a::red": fail() }))).toBe(true);
    expect(killedBy(head, run(1, { "a::one": pass(), "a::red": fail() }))).toBe(false);
    expect(killedBy(head, run(1, null))).toBe(true);
  });
});
