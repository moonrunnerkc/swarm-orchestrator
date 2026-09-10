import { describe, expect, it } from "vitest";
import { tallyTaskSuccess } from "./task-difficulty.ts";

describe("how hard a task set is for the model that ran it", () => {
  /**
   * Success is what an oracle the run did not control says, not what the tool certified. A
   * certification is the tool's claim about its own evidence, and a set's difficulty has to be a
   * property of the tasks and the model rather than of how strict the verifier happens to be.
   */
  it("counts a task solved where both halves accept the patch", () => {
    const tally = tallyTaskSuccess([
      { sealedOracle: "accepted", heldBackOracle: "accepted" },
      { sealedOracle: "accepted", heldBackOracle: "rejected" },
      { sealedOracle: "rejected", heldBackOracle: "rejected" },
    ]);

    expect(tally.attempted).toBe(3);
    expect(tally.solved).toBe(1);
    expect(tally.point).toBeCloseTo(1 / 3, 5);
  });

  /**
   * A run that wrote nothing is a model failure and stays in the denominator: dropping it would
   * report the rate among tasks the model attempted, which is a different and flattering number.
   */
  it("keeps a run that produced no patch in the denominator", () => {
    const tally = tallyTaskSuccess([
      { sealedOracle: "accepted", heldBackOracle: "accepted" },
      { sealedOracle: "unjudged", heldBackOracle: "unjudged", producedNoChange: true },
    ]);

    expect(tally.attempted).toBe(2);
    expect(tally.solved).toBe(1);
    expect(tally.producedNoChange).toBe(1);
  });

  /**
   * A task the harness could not judge is out of the denominator entirely, because nothing about
   * it says whether the model solved it. Counting it as a failure charges the model for an
   * instrument that did not run.
   */
  it("drops a task nothing could judge rather than reading it as a failure", () => {
    const tally = tallyTaskSuccess([
      { sealedOracle: "accepted", heldBackOracle: "accepted" },
      { sealedOracle: "unjudged", heldBackOracle: "unjudged" },
    ]);

    expect(tally.attempted).toBe(1);
    expect(tally.unjudgeable).toBe(1);
  });

  /**
   * What gate 7 needs of a task set, and the reason the golden set cannot serve: a paired test
   * has nothing to work on where every arm succeeds on every task. A set is only useful to that
   * comparison where the model both succeeds and fails within it.
   */
  it("says whether the set leaves a comparison anything to measure", () => {
    expect(
      tallyTaskSuccess([
        { sealedOracle: "accepted", heldBackOracle: "accepted" },
        { sealedOracle: "accepted", heldBackOracle: "accepted" },
      ]).discriminates,
    ).toBe(false);

    expect(
      tallyTaskSuccess([
        { sealedOracle: "accepted", heldBackOracle: "accepted" },
        { sealedOracle: "rejected", heldBackOracle: "rejected" },
      ]).discriminates,
    ).toBe(true);
  });

  it("reports nothing measured over an empty set", () => {
    const tally = tallyTaskSuccess([]);

    expect(tally.attempted).toBe(0);
    expect(tally.point).toBeNull();
    expect(tally.discriminates).toBe(false);
  });
});
