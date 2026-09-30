import { describe, expect, it } from "vitest";
import { claimsOf } from "./validate-goals.mjs";

const goal = (workType) => ({
  workType,
  conditions: [
    { id: "correct", truth: "correct", sourceCorrect: true },
    { id: "incorrect", truth: "incorrect", sourceCorrect: false },
    { id: "forged", truth: "correct-source-forged-evidence", sourceCorrect: true },
  ],
});
const rows = (overrides = {}) =>
  [
    { tree: "base", hidden: "fail", visible: "fail" },
    { tree: "reference", hidden: "pass", visible: "pass", projectTest: "pass" },
    { tree: "condition:correct", hidden: "pass" },
    { tree: "condition:incorrect", hidden: "fail" },
    { tree: "condition:forged", hidden: "pass" },
  ].map((row) => ({ ...row, ...(overrides[row.tree] ?? {}) }));

describe("the claims a goal's validation checks", () => {
  it("finds nothing wrong where every claim executed as stated", () => {
    expect(claimsOf(goal("bugfix"), rows())).toEqual([]);
  });

  it("names a base the oracle accepts, except for a refactor", () => {
    const passingBase = rows({ base: { hidden: "pass" } });
    expect(claimsOf(goal("bugfix"), passingBase)).toEqual([
      "the base does not fail the hidden oracle",
    ]);
    expect(claimsOf(goal("refactor"), passingBase)).toEqual([]);
  });

  it("names a condition whose source does not read as its label says", () => {
    const problems = claimsOf(goal("feature"), rows({ "condition:forged": { hidden: "fail" } }));
    expect(problems).toEqual([
      "condition forged claims correct-source-forged-evidence but the hidden oracle read fail",
    ]);
  });

  it("names a reference that fails either the oracle or the visible checks", () => {
    const problems = claimsOf(
      goal("feature"),
      rows({ reference: { hidden: "fail", visible: "fail" } }),
    );
    expect(problems).toHaveLength(2);
  });
});
