import { expect, it } from "vitest";
import { behaviorStatus } from "../evidence/verifier/behavior.mjs";
import { browserResultsPass } from "./browser-results.ts";

const test = {
  projectName: "chromium",
  expectedStatus: "passed",
  status: "expected",
  results: [{ status: "passed", errors: [] }],
};
const report = {
  stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  errors: [],
  suites: [{ specs: [{ id: "interaction", tests: [test] }] }],
};
const independent = (value: unknown) =>
  behaviorStatus(
    { kind: "browser", expectedTests: 1 },
    { exitCode: 0, unavailable: null, stdout: JSON.stringify(value) },
  );
it("requires individual completed results in both derivations", () => {
  expect(browserResultsPass(report, 1)).toBe(true);
  expect(independent(report)).toBe("accepted");
});
it.each([
  { ...report, suites: [{}] },
  { ...report, suites: [] },
  { ...report, suites: [report.suites[0], report.suites[0]] },
  { ...report, stats: { ...report.stats, expected: 2 } },
  { ...report, suites: [{ specs: [{ id: "interaction", tests: [{ ...test, results: [] }] }] }] },
])("refuses missing, duplicate or inconsistent individual results", (value) => {
  expect(() => browserResultsPass(value, 1)).toThrow();
  expect(independent(value)).toBe("unjudged");
});
it("rejects a retry that hides the original failing result", () => {
  const value = {
    ...report,
    suites: [
      {
        specs: [
          {
            id: "interaction",
            tests: [
              {
                ...test,
                results: [{ status: "failed", errors: ["wrong output"] }, ...test.results],
              },
            ],
          },
        ],
      },
    ],
  };
  expect(browserResultsPass(value, 1)).toBe(false);
  expect(independent(value)).toBe("rejected");
});
