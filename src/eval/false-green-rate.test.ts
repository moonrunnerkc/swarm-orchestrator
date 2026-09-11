import { describe, expect, it } from "vitest";
import {
  groupByHarness,
  heldBackAgreementRate,
  separateAdversarialRows,
  tallyFalseGreens,
  tallyInadequateOracles,
} from "./false-green-rate.ts";

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

/**
 * `verified` is not one word. A patch certified on an oracle that refused every mutant of the
 * change is a stronger claim than one certified on an oracle nothing was asked of, and a rate
 * that flattens the two describes neither. Gate 3c reports the split for that reason.
 */
describe("the certified patches, split by what bonding their oracle showed", () => {
  it("counts each bond state among the certified and among the false greens", () => {
    const tally = tallyFalseGreens([
      { corner: "true-green", oracleBond: "held" },
      { corner: "true-green", oracleBond: "not-bonded" },
      { corner: "false-green", oracleBond: "unshown" },
      { corner: "true-red", oracleBond: "held" },
      { corner: "refused-on-bond", oracleBond: "vacuous" },
    ]);

    expect(tally.certifiedByBond).toEqual({ held: 1, "not-bonded": 1, unshown: 1 });
    expect(tally.falseGreensByBond).toEqual({ unshown: 1 });
    expect(tally.refusedOnBond).toBe(1);
  });

  it("names a row written before bonding existed rather than reading it as not bonded", () => {
    const tally = tallyFalseGreens([{ corner: "true-green" }]);

    expect(tally.certifiedByBond).toEqual({ "not-recorded": 1 });
  });
});

/**
 * Gate 3b's denominator is oracles rather than tasks, which is what makes it a question about the
 * tool: a better model certifies more patches and proves no more oracles inadequate.
 */
describe("the oracles a held-back oracle proved inadequate", () => {
  it("counts only where the sealed oracle accepted a patch the held-back one refuses", () => {
    const tally = tallyInadequateOracles([
      { sealedOracle: "accepted", heldBackOracle: "rejected", regression: "pass", verified: false },
      { sealedOracle: "accepted", heldBackOracle: "rejected", regression: "pass", verified: true },
      { sealedOracle: "accepted", heldBackOracle: "accepted", regression: "pass", verified: true },
      { sealedOracle: "rejected", heldBackOracle: "rejected", regression: "pass", verified: false },
      // Nothing established that the patch broke nothing, so nothing established the oracle either.
      { sealedOracle: "accepted", heldBackOracle: "rejected", regression: "fail", verified: false },
    ]);

    expect(tally.proved).toBe(2);
    expect(tally.refused).toBe(1);
    expect(tally.point).toBe(0.5);
  });

  it("reads the hand-authored pass's spelling of the same field", () => {
    const tally = tallyInadequateOracles([
      { firstOracle: "accepted", heldBackOracle: "rejected", regression: "pass", verified: false },
    ]);

    expect(tally.proved).toBe(1);
    expect(tally.refused).toBe(1);
  });

  it("has no rate where nothing was proved inadequate", () => {
    expect(tallyInadequateOracles([]).point).toBeNull();
  });
});

/**
 * A row produced by showing the model the oracle it will be judged by is a different sampling
 * process from one produced by handing it the task alone. Pooling the two reports a rate over a
 * population nobody sampled: the adversarial arm is an upper bound on the tool's blindness
 * against a reader of its acceptance test, and the ordinary arm is what a contributor produces.
 *
 * The rows live in different files today, which is a convention rather than a check. This is the
 * check, so a row that ends up in the wrong file is still not pooled.
 */
describe("keeping the adversarial arm out of an ordinary rate", () => {
  const rows = [
    { corner: "true-green" as const },
    { corner: "false-green" as const, prompt: "sealed-oracle-shown" },
    { corner: "true-red" as const },
  ];

  it("splits rows by whether the model was shown its oracle", () => {
    const split = separateAdversarialRows(rows);

    expect(split.ordinary).toHaveLength(2);
    expect(split.adversarial).toHaveLength(1);
  });

  it("reads a row with no prompt recorded as ordinary, which is what it was", () => {
    const unprompted = [{ corner: "true-green" as const }];
    const split = separateAdversarialRows(unprompted);

    expect(split.adversarial).toEqual([]);
  });

  it("tallies each side on its own denominator", () => {
    const split = separateAdversarialRows(rows);

    expect(tallyFalseGreens(split.ordinary).falseGreens).toBe(0);
    expect(tallyFalseGreens(split.adversarial).falseGreens).toBe(1);
  });
});

it("counts an oracle once and refuses conflicting primary judgements", () => {
  const row = {
    oracleId: "oracle-one",
    sealedOracle: "accepted",
    heldBackOracle: "rejected",
    regression: "pass",
    verified: false,
  };
  expect(tallyInadequateOracles([row, row]).proved).toBe(1);
  expect(() => tallyInadequateOracles([row, { ...row, verified: true }])).toThrow(/conflicting/);
});
