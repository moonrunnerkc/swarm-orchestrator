import { describe, expect, it } from "vitest";
import { groupByHarness, heldBackAgreementRate, tallyFalseGreens } from "./false-green-rate.ts";

describe("tallyFalseGreens", () => {
  /**
   * An opportunity is a claim the tool made, not a task somebody ran. Only a patch the tool
   * certified can be a false green, so the denominator is the certified ones and nothing else:
   * counting scored tasks instead reports a rate over runs the tool refused, which is a different
   * number wearing the same name.
   */
  it("counts only the judgements the tool certified", () => {
    const tally = tallyFalseGreens([
      { corner: "true-green" },
      { corner: "false-green" },
      { corner: "true-red" },
      { corner: "refused-on-sealed" },
      { corner: "refused-on-reach" },
      { corner: "unjudgeable" },
    ]);

    expect(tally.opportunities).toBe(2);
    expect(tally.falseGreens).toBe(1);
  });

  // Both corners of a refusal are reported, because a refusal is what the certified set is
  // missing and a rate over a shrinking denominator has to say what left it.
  it("reports the refusals beside the rate rather than only the rate", () => {
    const tally = tallyFalseGreens([
      { corner: "true-green" },
      { corner: "refused-on-reach" },
      { corner: "refused-on-reach" },
      { corner: "refused-on-sealed" },
      { corner: "false-red" },
      { corner: "unjudgeable" },
    ]);

    expect(tally.refusedOnReach).toBe(2);
    expect(tally.refusedOnSealed).toBe(1);
    expect(tally.falseReds).toBe(1);
    expect(tally.unjudgeable).toBe(1);
  });

  it("gives the interval for the rate it reports", () => {
    const tally = tallyFalseGreens([
      { corner: "false-green" },
      ...Array.from({ length: 18 }, () => ({ corner: "true-green" })),
    ]);

    expect(tally.opportunities).toBe(19);
    expect(Number(tally.point?.toFixed(3))).toBe(0.053);
    expect(tally.lower).toBeGreaterThan(0);
    expect(tally.upper).toBeLessThan(0.3);
  });

  // Zero of nothing is not zero: a corpus with no certified patch has no rate, and printing 0%
  // for it would be the collapse of unmeasured into green that the whole pass exists to refuse.
  it("has no rate where the tool certified nothing", () => {
    const tally = tallyFalseGreens([{ corner: "true-red" }, { corner: "unjudgeable" }]);

    expect(tally.opportunities).toBe(0);
    expect(tally.point).toBeNull();
  });
});

describe("heldBackAgreementRate", () => {
  /**
   * The weakness the mined corpus has and the hand-authored one does not: both halves come from
   * one author in one sitting and can share a blind spot. That is measurable rather than
   * arguable, and this is the measurement. A split whose halves never disagree on any patch is
   * buying less than it appears to.
   */
  it("counts only the patches both halves actually judged", () => {
    const agreement = heldBackAgreementRate([
      { sealedOracle: "accepted", heldBackOracle: "accepted" },
      { sealedOracle: "accepted", heldBackOracle: "rejected" },
      { sealedOracle: "rejected", heldBackOracle: "rejected" },
      { sealedOracle: "vacuous", heldBackOracle: "accepted" },
      { sealedOracle: "accepted", heldBackOracle: "unjudged" },
    ]);

    expect(agreement.compared).toBe(3);
    expect(agreement.agreed).toBe(2);
    expect(Number(agreement.rate?.toFixed(3))).toBe(0.667);
  });

  it("has no rate where no patch was judged by both", () => {
    expect(
      heldBackAgreementRate([{ sealedOracle: "vacuous", heldBackOracle: "unjudged" }]).rate,
    ).toBeNull();
  });
});

describe("groupByHarness", () => {
  /**
   * A corpus can end up spanning two tool versions: a re-judge under one commit, eight more tasks
   * scored after another. Picking one group and dropping the rest reported "no rate" over the
   * eight rows that happened to be newest while three certified patches sat in the other group.
   *
   * Every group is reported, and the loud case is the one where more than one of them holds a
   * certified patch, because that is the rate spanning tool versions rather than the corpus
   * merely being recorded across them.
   */
  it("keeps every harness apart and says which ones hold an opportunity", () => {
    const groups = groupByHarness([
      { corner: "true-green", harness: "aaa" },
      { corner: "false-green", harness: "aaa" },
      { corner: "true-red", harness: "bbb" },
      { corner: "true-red", harness: "bbb" },
    ]);

    expect(groups.map((one) => one.harness)).toEqual(["aaa", "bbb"]);
    expect(groups[0]?.tally.opportunities).toBe(2);
    expect(groups[1]?.tally.opportunities).toBe(0);
    expect(groups.filter((one) => one.tally.opportunities > 0)).toHaveLength(1);
  });

  it("names a row that recorded no harness rather than dropping it", () => {
    const groups = groupByHarness([{ corner: "true-green" }]);

    expect(groups[0]?.harness).toBe("unrecorded");
  });
});
