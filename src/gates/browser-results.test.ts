import { expect, it } from "vitest";
import { behaviorCheckSchema } from "../evidence/behavior-check.ts";
import { browserInstrumentDigest } from "../evidence/browser-execution.ts";
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
  suites: [
    {
      specs: [
        { id: "interaction", title: "increments", file: "instrument.spec.mjs", tests: [test] },
      ],
    },
  ],
};
const check = behaviorCheckSchema.parse({
  kind: "browser",
  cwd: ".",
  timeoutMs: 10000,
  maxOutputBytes: 256000,
  toolchain: "playwright",
  network: "inherit",
  expectedTests: 1,
  instrument: { source: "sealed authored instrument", titles: ["increments"] },
});
const independent = (value: unknown) =>
  behaviorStatus(check, {
    exitCode: 0,
    unavailable: null,
    stdout: JSON.stringify(value),
    browserExecution: {
      kind: "sealed-playwright-v1",
      runtime: "immutable-container",
      instrumentDigest: browserInstrumentDigest(check),
    },
  });
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

it("rejects otherwise passing results with the wrong sealed test identity", () => {
  const value = {
    ...report,
    suites: [{ specs: [{ ...report.suites[0]?.specs[0], title: "fabricated" }] }],
  };
  expect(browserResultsPass(value, 1, ["increments"])).toBe(false);
  expect(independent(value)).toBe("rejected");
});
