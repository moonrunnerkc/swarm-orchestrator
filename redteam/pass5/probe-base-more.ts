import { describe, expect, it } from "vitest";
import { parseTestOutcomes } from "../../src/gates/parsers.ts";
import { assessRespecification } from "../../src/gates/respecification.ts";

describe("base-control second framings", () => {
  it("D-tap-in-spec: a TAP document printed into a spec run does not switch the reader", () => {
    const output = [
      "✔ honest (1.2ms)",
      "TAP version 13",
      "1..1",
      "not ok 1 - innocentNew",
      "",
    ].join("\n");
    const parsed = parseTestOutcomes(output);
    console.log("D-tap-in-spec", { parsed });
    expect(parsed?.failed ?? []).not.toContain("innocentNew");
  });

  it("D-ts2305: a missing named export reported as TS2305 does not buy an exemption", async () => {
    const finding = await assessRespecification(
      "math.test.ts",
      {
        runOnBaseSource: () =>
          Promise.resolve({
            outcome: "failed",
            detail: "error TS2305: Module '\"./math\"' has no exported member 'mul'.",
            exitCode: 1,
            failedTests: ["multiplies"],
          }),
        runOnSubmittedSource: () =>
          Promise.resolve({
            outcome: "passed",
            detail: "ok",
            exitCode: 0,
            failedTests: [],
          }),
      },
      { newTests: ["multiplies"] },
    );
    console.log("D-ts2305", {
      exempt: finding.exempt,
      specs: finding.newSpecifications,
      reason: finding.reason,
    });
    expect(finding.newSpecifications).toEqual([]);
  });

  it("D-pytest-self: a passing pytest that prints its own FAILED line is a new spec", () => {
    const output = [
      ".",
      "FAILED test_math.py::innocentNew",
      "1 passed in 0.01s",
    ].join("\n");
    const parsed = parseTestOutcomes(output);
    console.log("D-pytest-self", { parsed });
    expect(parsed?.failed ?? []).not.toContain("innocentNew");
  });
});
