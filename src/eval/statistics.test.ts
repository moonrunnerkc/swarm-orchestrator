import { describe, expect, it } from "vitest";
import { bootstrapInterval, intentionToTreat, mcNemar, wilsonInterval } from "./statistics.ts";

/**
 * The arithmetic an evaluation is read through. Written here rather than in a notebook because
 * a number nobody can re-derive is a claim, and the whole point of this project is the
 * difference between those.
 */
describe("a proportion and how sure of it anybody can be", () => {
  it("brackets the point estimate", () => {
    const interval = wilsonInterval(80, 100);

    expect(interval.point).toBeCloseTo(0.8, 6);
    expect(interval.lower).toBeLessThan(0.8);
    expect(interval.upper).toBeGreaterThan(0.8);
  });

  it("never leaves the unit interval, which is what Wilson is for", () => {
    expect(wilsonInterval(0, 10).lower).toBeGreaterThanOrEqual(0);
    expect(wilsonInterval(10, 10).upper).toBeLessThanOrEqual(1);
  });

  it("gets narrower as the evidence grows", () => {
    const small = wilsonInterval(8, 10);
    const large = wilsonInterval(800, 1_000);

    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it("says nothing at all from nothing at all", () => {
    expect(wilsonInterval(0, 0)).toMatchObject({ point: 0, lower: 0, upper: 1 });
  });
});

describe("comparing two arms on the same tasks", () => {
  it("counts only the tasks the arms disagreed about, which is what pairing is for", () => {
    // Ten tasks: both passed six, both failed two, A passed and B failed one, and the reverse.
    const result = mcNemar({ onlyFirst: 1, onlySecond: 1 });

    expect(result.discordant).toBe(2);
    expect(result.significant).toBe(false);
  });

  it("finds a lopsided disagreement significant", () => {
    expect(mcNemar({ onlyFirst: 20, onlySecond: 2 }).significant).toBe(true);
  });

  it("abstains where too few tasks disagreed to say anything", () => {
    const result = mcNemar({ onlyFirst: 2, onlySecond: 0 });

    expect(result.significant).toBe(false);
    expect(result.reason).toMatch(/too few/i);
  });
});

describe("an interval around a cost or a latency", () => {
  it("brackets the mean of the sample", () => {
    const interval = bootstrapInterval([1, 2, 3, 4, 5], { resamples: 500, seed: 7 });

    expect(interval.point).toBeCloseTo(3, 6);
    expect(interval.lower).toBeLessThan(3);
    expect(interval.upper).toBeGreaterThan(3);
  });

  it("is the same interval every time, because a seed is what makes it re-derivable", () => {
    const first = bootstrapInterval([1, 5, 2, 8, 3], { resamples: 200, seed: 11 });
    const second = bootstrapInterval([1, 5, 2, 8, 3], { resamples: 200, seed: 11 });

    expect(first).toEqual(second);
  });
});

describe("counting every run that was launched", () => {
  /**
   * Intention to treat: a run that crashed is a run that did not produce an accepted patch, and
   * dropping it because it "did not really run" is how an arm's number becomes the number of the
   * runs that happened to work.
   */
  it("counts a crashed run against the arm that launched it", () => {
    const counted = intentionToTreat([
      { launched: true, completed: true, accepted: true },
      { launched: true, completed: false, accepted: false },
      { launched: true, completed: true, accepted: false },
    ]);

    expect(counted.launched).toBe(3);
    expect(counted.accepted).toBe(1);
    expect(counted.rate.point).toBeCloseTo(1 / 3, 6);
  });

  it("reports the completions apart, so a crash rate is visible rather than folded in", () => {
    const counted = intentionToTreat([
      { launched: true, completed: false, accepted: false },
      { launched: true, completed: true, accepted: true },
    ]);

    expect(counted.completed).toBe(1);
    expect(counted.crashed).toBe(1);
  });
});
