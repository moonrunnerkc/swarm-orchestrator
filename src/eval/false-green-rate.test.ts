import { describe, expect, it } from "vitest";
import { tallyFalseGreens } from "./false-green-rate.ts";

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
    expect(Number(tally.point.toFixed(3))).toBe(0.053);
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
