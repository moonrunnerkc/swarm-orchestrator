import { describe, expect, it } from "vitest";
import { bondRefusesCertification, certifies, reasonsToRefuse } from "./certification.ts";

const clean = {
  regression: "pass",
  task: "accepted",
  oracleReach: "reached",
  oracleBond: "held",
} as const;

describe("what refuses to certify a patch", () => {
  it("certifies where nothing in the record refuses", () => {
    expect(reasonsToRefuse(clean)).toEqual([]);
    expect(certifies(clean)).toBe(true);
  });

  it("refuses where the repository's own suite did not pass", () => {
    expect(reasonsToRefuse({ ...clean, regression: "fail" })).toEqual(["regression-not-pass"]);
    expect(reasonsToRefuse({ ...clean, regression: "unmeasured" })).toEqual([
      "regression-not-pass",
    ]);
  });

  it("refuses where the oracle did not accept", () => {
    for (const task of ["rejected", "unjudged", "vacuous"] as const) {
      expect(reasonsToRefuse({ ...clean, task })).toEqual(["task-not-accepted"]);
    }
  });

  /**
   * `unreached` refuses and `unmeasured` does not. An oracle shown to have skipped part of the
   * change did not judge it; one whose reach nobody could measure is unproven either way, and
   * refusing on that would make the verdict a function of which runners this build can instrument.
   */
  it("refuses where the oracle never ran part of the change", () => {
    expect(reasonsToRefuse({ ...clean, oracleReach: "unreached" })).toEqual([
      "oracle-did-not-reach-the-change",
    ]);
    expect(reasonsToRefuse({ ...clean, oracleReach: "unmeasured" })).toEqual([]);
  });

  /**
   * Turned on after the audit the pre-registered rule asked for: sixteen certified patches, one
   * vacuous verdict among them, and reading its mutant by hand confirmed it changes behaviour the
   * oracle executed. The two mutants that were equivalent were found the same way and their
   * operators narrowed, which is what the audit is for.
   *
   * Reverting the commit that flipped this restores report-only, which is why it is one boolean.
   */
  it("refuses to certify on an oracle that accepted a mutant of the change", () => {
    const vacuous = { ...clean, oracleBond: "vacuous" } as const;

    expect(bondRefusesCertification).toBe(true);
    expect(reasonsToRefuse(vacuous)).toEqual(["oracle-bond-vacuous"]);
    expect(certifies(vacuous)).toBe(false);
  });

  /**
   * Neither is evidence against the oracle. Blocking on them would make the certify rate a
   * function of how many mutation operators this build happens to carry.
   */
  it("never refuses on a bond that was not shown or not built", () => {
    expect(reasonsToRefuse({ ...clean, oracleBond: "unshown" })).toEqual([]);
    expect(reasonsToRefuse({ ...clean, oracleBond: "not-bonded" })).toEqual([]);
  });

  it("names every reason it found, not the first", () => {
    expect(
      reasonsToRefuse({
        regression: "fail",
        task: "rejected",
        oracleReach: "unreached",
        oracleBond: "not-bonded",
      }),
    ).toEqual(["regression-not-pass", "task-not-accepted", "oracle-did-not-reach-the-change"]);
  });
});
