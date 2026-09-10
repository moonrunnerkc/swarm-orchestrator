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
   * The one switch. Reach cost three artifacts before it was safe to block on, and bonding is
   * audited the same way before this turns on, so the report-only regime has to be expressible
   * and has to be the one thing that changes.
   */
  it("treats a vacuous bond as a reason to refuse only where bonding blocks", () => {
    const vacuous = { ...clean, oracleBond: "vacuous" } as const;

    expect(reasonsToRefuse(vacuous)).toEqual(
      bondRefusesCertification ? ["oracle-bond-vacuous"] : [],
    );
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
