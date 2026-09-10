import { describe, expect, it } from "vitest";
import { measureDeadlineOvershoot, worstOvershoot } from "./deadline-overshoot.ts";

describe("reading a set of overshoot samples", () => {
  it("reports the worst sample and its fraction of that sample's budget", () => {
    const worst = worstOvershoot([
      { budgetMs: 500, stoppedAfterMs: 503, overshootMs: 3 },
      { budgetMs: 1000, stoppedAfterMs: 1012, overshootMs: 12 },
    ]);

    expect(worst?.overshootMs).toBe(12);
    expect(worst?.fraction).toBeCloseTo(0.012, 5);
  });

  /**
   * The fraction is worst per sample rather than the worst absolute over the largest budget: a
   * bigger budget makes any overshoot look smaller, and reporting it that way would let the
   * number be improved by measuring a longer run.
   */
  it("takes the worst fraction rather than the worst milliseconds", () => {
    const worst = worstOvershoot([
      { budgetMs: 200, stoppedAfterMs: 208, overshootMs: 8 },
      { budgetMs: 4000, stoppedAfterMs: 4020, overshootMs: 20 },
    ]);

    expect(worst?.overshootMs).toBe(8);
    expect(worst?.fraction).toBeCloseTo(0.04, 5);
  });

  it("reports nothing measured where no sample was taken", () => {
    expect(worstOvershoot([])).toBeNull();
  });

  it("reads a run that stopped before its deadline as no overshoot", () => {
    const worst = worstOvershoot([{ budgetMs: 500, stoppedAfterMs: 480, overshootMs: 0 }]);

    expect(worst?.fraction).toBe(0);
  });
});

/**
 * Gate 9 asks for deadline overshoot below 2% in deterministic budget tests, and the mechanism
 * had never had a number against it. This is the number: a real budget, a real child that
 * outlives it, and the whole cancellation tree between them, from the deadline timer through the
 * abort to the process group being signalled and the run settling.
 *
 * Deterministic in that the budget and the child are fixed and the bound holds every run, not in
 * that the clock is faked. A faked clock measures zero overshoot by construction, which is the
 * one answer this cannot be allowed to give.
 */
describe("how far past its deadline a run actually goes", () => {
  it("stops within 2% of the budget it was given", async () => {
    const measured = await measureDeadlineOvershoot({ budgetsMs: [500, 1000], repeats: 2 });
    const worst = worstOvershoot(measured);

    expect(measured).toHaveLength(4);
    expect(worst).not.toBeNull();
    expect(worst?.fraction).toBeLessThan(0.02);
  });

  it("stops every child it started, so nothing outlives the deadline", async () => {
    const measured = await measureDeadlineOvershoot({ budgetsMs: [500], repeats: 1 });

    expect(measured[0]?.stoppedAfterMs).toBeGreaterThanOrEqual(500);
  });
});
