import { expect, it } from "vitest";
import { capturedRegression } from "../evidence/verifier/status.mjs";
import { attributeFailure, testPoints } from "./failure-attribution.ts";

/**
 * Vitest's text reporters, as a project script with flags the structured runner does not take
 * prints them (cronproof's `vitest run --coverage --reporter=verbose`): the coverage table
 * differs between the base and the patch whenever the patch changes code, so the outputs never
 * match, and the FAIL lines are what name the failures.
 */
const vitestText = (failing: readonly string[], coverage: string) => ({
  exitCode: 1,
  stdout: [
    " RUN  v4.1.10 /workspace",
    "",
    ...failing.map((name) => ` × ${name} 3ms`),
    "",
    ` Failed Tests ${failing.length}`,
    "",
    ...failing.map((name) => ` FAIL  test/cron.test.ts > ${name}`),
    "AssertionError: expected 1 to be 2",
    "",
    ` Test Files  1 failed | 4 passed (5)`,
    `      Tests  ${failing.length} failed | 40 passed (${40 + failing.length})`,
    "   Duration  1.52s",
    "",
    " % Coverage report from v8",
    `All files |   ${coverage} |`,
  ].join("\n"),
  stderr: "",
  durationMs: 1,
  unavailable: null,
});

it("names Vitest's text-reporter failures, and never a pass, beside its summary", () => {
  expect(testPoints(vitestText(["zone > spring forward"], "91.2"))).toEqual({
    failed: ["test/cron.test.ts > zone > spring forward"],
    passed: [],
  });
  expect(testPoints({ ...vitestText([], "91.2"), stdout: "no summary here" })).toBeNull();
});

it("proves an inheritance across a coverage table that moved, and names a new failure", () => {
  const base = vitestText(["zone > spring forward"], "91.2");
  expect(
    attributeFailure({
      withPatch: vitestText(["zone > spring forward"], "92.8"),
      baseStatus: "failed",
      atBase: base,
    }).attribution,
  ).toBe("inherited");
  expect(
    attributeFailure({
      withPatch: vitestText(["zone > spring forward", "parse > step"], "92.8"),
      baseStatus: "failed",
      atBase: base,
    }),
  ).toEqual({ attribution: "new", newFailures: ["test/cron.test.ts > parse > step"] });
});

it("reads the same attribution in the offline re-deriver", () => {
  const check = (withPatch: ReturnType<typeof vitestText>, attribution: string) => ({
    id: "tests",
    parser: "test-output",
    severity: "blocking",
    status: "failed",
    observation: withPatch,
    baseObservation: vitestText(["zone > spring forward"], "91.2"),
    attribution,
    inheritedFromBase: attribution === "inherited",
  });
  const lint = {
    id: "lint",
    parser: "exit-code",
    severity: "blocking",
    status: "passed",
    observation: { exitCode: 0, stdout: "", stderr: "", unavailable: null },
  };
  expect(
    capturedRegression([lint, check(vitestText(["zone > spring forward"], "92.8"), "inherited")]),
  ).toBe("pass");
  expect(
    capturedRegression([
      lint,
      check(vitestText(["zone > spring forward", "parse > step"], "92.8"), "inherited"),
    ]),
  ).toBeNull();
});
