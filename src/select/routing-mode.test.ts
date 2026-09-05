import { describe, expect, it } from "vitest";
import { explorationRateFor, learnedRoutingJustified } from "./routing-mode.ts";

/**
 * A tenth of ordinary production runs were routed to a random model so the estimate would not
 * be fed purely by its own routing. That is the right thing to do while measuring and the wrong
 * thing to do to somebody's actual work, and nothing told them it had happened.
 */
describe("when a run is allowed to explore", () => {
  it("never explores in an ordinary run", () => {
    expect(explorationRateFor("production")).toBe(0);
  });

  it("explores where a caller asked to calibrate, which is what calibration is", () => {
    expect(explorationRateFor("calibration")).toBeGreaterThan(0);
  });

  it("explores in a canary, which is the deliberate slice", () => {
    expect(explorationRateFor("canary")).toBeGreaterThan(0);
  });
});

/**
 * Learned routing is on by default only where held-out evidence says it earns its place. The
 * bar is non-inferior success at lower cost or lower latency, on held-out tasks, with enough
 * samples for the comparison to mean anything.
 */
describe("whether learned routing has earned being the default", () => {
  /**
   * A thousand tasks per arm, not a hundred. At n=100 the interval on a two-point difference is
   * about eleven points wide either way, so nothing at that size can be shown non-inferior at a
   * five-point margin. That is the check working: the bar is demanding on purpose, and a
   * comparison that cannot clear it has not earned turning learned routing on by default.
   */
  const strong = {
    baseline: { successes: 800, trials: 1_000, costPerAccepted: 1.0, p95LatencyMs: 10_000 },
    learned: { successes: 820, trials: 1_000, costPerAccepted: 0.6, p95LatencyMs: 9_000 },
  };

  it("is justified where success held and cost fell, on enough held-out tasks", () => {
    const judged = learnedRoutingJustified(strong);

    expect(judged.justified).toBe(true);
    expect(judged.reason).toMatch(/cheaper/i);
    expect(judged.reason).toContain("per accepted patch");
  });

  it("is not justified where success fell, however much cheaper it got", () => {
    const judged = learnedRoutingJustified({
      ...strong,
      learned: { successes: 600, trials: 1_000, costPerAccepted: 0.1, p95LatencyMs: 1_000 },
    });

    expect(judged.justified).toBe(false);
    expect(judged.reason).toMatch(/success/i);
  });

  it("is not justified where it cost more and was no faster, however well it scored", () => {
    const judged = learnedRoutingJustified({
      ...strong,
      learned: { successes: 850, trials: 1_000, costPerAccepted: 2.0, p95LatencyMs: 20_000 },
    });

    expect(judged.justified).toBe(false);
    expect(judged.reason).toMatch(/neither cheaper nor faster/i);
  });

  it("abstains where there are too few held-out tasks to compare", () => {
    const judged = learnedRoutingJustified({
      baseline: { successes: 4, trials: 5, costPerAccepted: 1, p95LatencyMs: 10 },
      learned: { successes: 5, trials: 5, costPerAccepted: 0.5, p95LatencyMs: 5 },
    });

    expect(judged.justified).toBe(false);
    expect(judged.reason).toMatch(/too few|not enough/i);
  });

  it("refuses a comparison too small to clear the margin, however good it looks", () => {
    // The same rates at a hundred tasks per arm. The point estimate is better and the interval
    // is far too wide to say so, which is the case a point estimate would have got wrong.
    const judged = learnedRoutingJustified({
      baseline: { successes: 80, trials: 100, costPerAccepted: 1.0, p95LatencyMs: 10_000 },
      learned: { successes: 82, trials: 100, costPerAccepted: 0.6, p95LatencyMs: 9_000 },
    });

    expect(judged.justified).toBe(false);
    expect(judged.reason).toMatch(/non-inferior/i);
  });

  it("reports the interval it judged non-inferiority by, rather than a bare verdict", () => {
    const judged = learnedRoutingJustified(strong);

    expect(judged.successDifferenceInterval).toHaveLength(2);
    expect(judged.successDifferenceInterval[0]).toBeLessThan(judged.successDifferenceInterval[1]);
  });
});
