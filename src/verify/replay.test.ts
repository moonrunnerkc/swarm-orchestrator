import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { CheckRun } from "./checks.ts";
import { judgeCheck } from "./per-test.ts";
import { parseJunit, type TestEvidence, type TestReport } from "./test-report.ts";

// The swarm trial on astropy__astropy-12907 in the evaluation run 2026-10-29T16-12-15-988Z got
// `unmeasured`: its check, `python3 -m pytest -q`, could not import astropy in the clean
// checkout at either commit. Replayed in that task's image with the trial's change (from its
// ledger), the task's conda environment active and the workspace's build products copied into
// the checkout by a `[verify] setup` command, the verifier at 84ef15ebf wrote these two junit
// reports. Failure, error and skip bodies are trimmed; every testcase and its status is kept.
const report = (name: string) =>
  parseJunit(
    gunzipSync(readFileSync(join(import.meta.dirname, "fixtures", "reports", name))).toString(),
  ) as TestReport;

const run = (exitCode: number): CheckRun => ({
  result: {
    name: "test",
    command: "python3 -m pytest -q",
    kind: "test",
    result: exitCode === 0 ? "pass" : "fail",
    exitCode,
    durationMs: 1,
    outputSha256: "0".repeat(64),
  },
  outputTail: "",
  notRun: null,
});
const evidence = (value: TestReport, runner: TestEvidence["runner"]): TestEvidence => ({
  runner,
  report: runner === null ? null : value,
  unreadable: null,
  judge: null,
});

describe("replaying an evaluation trial the exit code left unmeasured", () => {
  const base = report("replay-astropy-12907-base.xml.gz");
  const head = report("replay-astropy-12907-head.xml.gz");

  it("gets a measured verdict test by test, with the suite failing at both commits", () => {
    const judged = judgeCheck(
      { run: run(1), evidence: evidence(head, "pytest") },
      { result: run(1).result, evidence: evidence(base, "pytest") },
      () => false,
    );
    expect(judged.run.result.result).toBe("pass");
    expect(judged.unmeasured).toBeNull();
    expect(judged.run.result.tests?.counts).toEqual({
      passing: 17218,
      fixed: 0,
      regressed: 0,
      preExisting: 2483,
      deleted: 0,
      allowedDeletions: 0,
      newlyFailing: 0,
      added: 0,
      skipped: 2350,
    });
  });

  it("would still be unmeasured judged by exit code", () => {
    const judged = judgeCheck(
      { run: run(1), evidence: evidence(head, null) },
      { result: run(1).result, evidence: evidence(base, null) },
      () => false,
    );
    expect(judged.run.result.result).toBe("pre-existing-failure");
  });
});
