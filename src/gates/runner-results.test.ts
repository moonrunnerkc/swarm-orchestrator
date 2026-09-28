import { expect, it } from "vitest";
import { readStatus } from "../evidence/verifier/rederive.mjs";
import { readRunnerResult } from "./runner-results.ts";

const observed = (value: unknown, exitCode = 0, outputTruncated = false) => ({
  stdout: JSON.stringify(value),
  stderr: "",
  exitCode,
  outputTruncated,
  unavailable: null,
  durationMs: 1,
});
const point = { id: "test.py:test_value", status: "passed" };
it("counts genuine structured outcomes without granting numeric ratchet authority", () => {
  const observation = observed({ schema: "swarm.pytest.v1", tests: [point] });
  expect(readRunnerResult(observation)).toMatchObject({ status: "passed", measures: {} });
  expect(readStatus("test-output", observation)).toBe("passed");
});
it.each([
  { schema: "swarm.pytest.v1", tests: [] },
  { schema: "swarm.pytest.v1", tests: [{ ...point, status: "skipped" }] },
  { schema: "swarm.pytest.v1", tests: [point, point] },
  { passed: true },
  { numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0, testResults: [] },
])("refuses vacuous, duplicate, forged or inconsistent output %j", (value) => {
  const observation = observed(value);
  expect(readRunnerResult(observation).status).toBe("not-applicable");
  expect(readStatus("test-output", observation)).toBe("not-applicable");
});
it("does not promote a truncated report or ignore process failure", () => {
  const value = { schema: "swarm.pytest.v1", tests: [point] };
  for (const observation of [
    observed(value, 0, true),
    observed(value, 128),
    { ...observed(value), stdout: '{"schema":' },
  ]) {
    expect(readRunnerResult(observation).status).not.toBe("passed");
    expect(readStatus("test-output", observation)).toBe(readRunnerResult(observation).status);
  }
});

it("does not let malformed structured reports fall back to textual success", () => {
  const observation = { ...observed({}), stdout: "Tests 1 passed\n{malformed" };
  expect(readRunnerResult(observation).status).toBe("not-applicable");
  expect(readStatus("structured-test-output", observation)).toBe("not-applicable");
});

/**
 * depose, in the rollout: two `it` blocks in one file share a title, vitest accepts them, and
 * the whole suite of 383 tests read as "malformed" for it. The second is named by occurrence.
 */
it("keeps a suite whose file repeats a test title, naming the repeat by occurrence", () => {
  const report = {
    numTotalTests: 3,
    numPassedTests: 2,
    numFailedTests: 1,
    numPendingTests: 0,
    testResults: [
      {
        name: "/workspace/a.test.ts",
        assertionResults: [
          { fullName: "derives the identifier", status: "passed" },
          { fullName: "derives the identifier", status: "failed" },
          { fullName: "rejects a short key", status: "passed" },
        ],
      },
    ],
  };
  const reading = readRunnerResult({
    exitCode: 1,
    stdout: JSON.stringify(report),
    stderr: "",
    outputTruncated: false,
    unavailable: null,
    durationMs: 1,
  });
  expect(reading.status).toBe("failed");
  expect(reading.detail).toContain("3 runner-reported tests, 3 executed");
});

/**
 * The Python runner script says so itself when pytest is not in the environment or no report
 * was written; in the pull request study that read as "malformed" and then as an inherited
 * failure on a clean checkout. It measured nothing, and the reason is the detail.
 */
it("reads the runner script's own unavailable word as a check that measured nothing", () => {
  const reading = readRunnerResult({
    exitCode: 127,
    stdout:
      '{"unavailable": "pytest is not installed in the project\'s environment, so no test ran"}\n',
    stderr: "",
    outputTruncated: false,
    unavailable: null,
    durationMs: 1,
  });
  expect(reading.status).toBe("not-applicable");
  expect(reading.detail).toContain("pytest is not installed");
});
