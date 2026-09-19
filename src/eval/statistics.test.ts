import { describe, expect, it } from "vitest";
import {
  bootstrapInterval,
  clusteredDifferenceInterval,
  holmAdjusted,
  intentionToTreat,
  mcNemar,
  mcNemarExact,
  pairedComparison,
  pairedDifferenceInterval,
  wilsonInterval,
} from "./statistics.ts";

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

it("keeps the paired non-inferiority interval open at all-success boundaries", async () => {
  const { pairedNonInferiority } = await import("./statistics.ts");
  expect(pairedNonInferiority([], 0.05)).toMatchObject({ lower: -1, upper: 1, nonInferior: false });
  const pairs = Array.from({ length: 79 }, () => ({ baseline: true, candidate: true }));
  const interval = pairedNonInferiority(pairs, 0.05);
  expect(interval.point).toBe(0);
  expect(interval.lower).toBeCloseTo(-Math.sqrt((2 * Math.log(40)) / 79));
  expect(interval.nonInferior).toBe(false);
  expect(
    pairedNonInferiority(
      Array.from({ length: 3000 }, () => ({ baseline: true, candidate: true })),
      0.05,
    ).nonInferior,
  ).toBe(true);
});

describe("the exact paired test, for counts the chi-square abstains on", () => {
  it("matches the binomial tail worked by hand", async () => {
    const { mcNemarExact } = await import("./statistics.ts");
    // Five pairs all one way: 2 * (1/2)^5. One against four: 2 * (1 + 5) / 32.
    expect(mcNemarExact({ onlyFirst: 5, onlySecond: 0 }).pValue).toBeCloseTo(0.0625, 12);
    expect(mcNemarExact({ onlyFirst: 1, onlySecond: 4 }).pValue).toBeCloseTo(0.375, 12);
    expect(mcNemarExact({ onlyFirst: 12, onlySecond: 2 }).pValue).toBeCloseTo(0.012939453125, 12);
  });

  it("does not care which arm is named first", async () => {
    const { mcNemarExact } = await import("./statistics.ts");
    expect(mcNemarExact({ onlyFirst: 2, onlySecond: 7 }).pValue).toBe(
      mcNemarExact({ onlyFirst: 7, onlySecond: 2 }).pValue,
    );
  });

  it("reads no disagreement and an even split as no evidence, never past 1", async () => {
    const { mcNemarExact } = await import("./statistics.ts");
    expect(mcNemarExact({ onlyFirst: 0, onlySecond: 0 })).toMatchObject({
      discordant: 0,
      pValue: 1,
    });
    expect(mcNemarExact({ onlyFirst: 3, onlySecond: 3 }).pValue).toBe(1);
  });

  it("refuses a count that is not a count", async () => {
    const { mcNemarExact } = await import("./statistics.ts");
    expect(() => mcNemarExact({ onlyFirst: -1, onlySecond: 2 })).toThrow(/non-negative integer/);
    expect(() => mcNemarExact({ onlyFirst: 1.5, onlySecond: 2 })).toThrow(/non-negative integer/);
  });
});

describe("the difference between two pass rates on the same tasks", () => {
  // Known answers from an independent implementation of Newcombe's method 10 in another language.
  it("reproduces the known answers", async () => {
    const { pairedDifferenceInterval } = await import("./statistics.ts");
    const harm = pairedDifferenceInterval({
      bothPass: 36,
      onlyFirst: 12,
      onlySecond: 2,
      bothFail: 0,
    });
    expect(harm.point).toBeCloseTo(-0.2, 10);
    expect(harm.lower).toBeCloseTo(-0.340427603, 8);
    expect(harm.upper).toBeCloseTo(-0.056929584, 8);

    const help = pairedDifferenceInterval({
      bothPass: 5,
      onlyFirst: 0,
      onlySecond: 4,
      bothFail: 70,
    });
    expect(help.point).toBeCloseTo(4 / 79, 10);
    expect(help.lower).toBeCloseTo(-0.0080293799, 8);
    expect(help.upper).toBeCloseTo(0.1216846349, 8);
  });

  it("keeps an interval where nothing disagreed, which a Wald interval collapses to a point", async () => {
    const { pairedDifferenceInterval } = await import("./statistics.ts");
    const same = pairedDifferenceInterval({
      bothPass: 20,
      onlyFirst: 0,
      onlySecond: 0,
      bothFail: 59,
    });
    expect(same.point).toBe(0);
    expect(same.lower).toBeCloseTo(-0.0333320625, 8);
    expect(same.upper).toBeCloseTo(0.0333320625, 8);
  });

  it("mirrors when the arms swap", async () => {
    const { pairedDifferenceInterval } = await import("./statistics.ts");
    const one = pairedDifferenceInterval({
      bothPass: 10,
      onlyFirst: 3,
      onlySecond: 1,
      bothFail: 65,
    });
    const other = pairedDifferenceInterval({
      bothPass: 10,
      onlyFirst: 1,
      onlySecond: 3,
      bothFail: 65,
    });
    expect(other.point).toBeCloseTo(-one.point, 12);
    expect(other.lower).toBeCloseTo(-one.upper, 12);
    expect(other.upper).toBeCloseTo(-one.lower, 12);
  });

  it("says nothing from no pairs and stays inside [-1, 1]", async () => {
    const { pairedDifferenceInterval } = await import("./statistics.ts");
    expect(
      pairedDifferenceInterval({ bothPass: 0, onlyFirst: 0, onlySecond: 0, bothFail: 0 }),
    ).toMatchObject({ point: 0, lower: -1, upper: 1, pairs: 0 });
    const extreme = pairedDifferenceInterval({
      bothPass: 0,
      onlyFirst: 3,
      onlySecond: 0,
      bothFail: 0,
    });
    expect(extreme.point).toBe(-1);
    expect(extreme.lower).toBeGreaterThanOrEqual(-1);
    expect(extreme.upper).toBeLessThanOrEqual(1);
  });
});

describe("one paired comparison, counted in one place", () => {
  it("counts the four cells and names the discordant pairs", () => {
    const compared = pairedComparison([
      { id: "a", first: true, second: true },
      { id: "b", first: false, second: true },
      { id: "c", first: false, second: true },
      { id: "d", first: true, second: false },
      { id: "e", first: false, second: false },
    ]);
    expect(compared.cells).toEqual({ bothPass: 1, onlyFirst: 1, onlySecond: 2, bothFail: 1 });
    expect(compared.onlyFirstIds).toEqual(["d"]);
    expect(compared.onlySecondIds).toEqual(["b", "c"]);
    expect(compared.firstPassRate).toBeCloseTo(0.4, 12);
    expect(compared.secondPassRate).toBeCloseTo(0.6, 12);
    expect(compared.mcnemar).toEqual(mcNemarExact({ onlyFirst: 1, onlySecond: 2 }));
    expect(compared.difference).toEqual(
      pairedDifferenceInterval({ bothPass: 1, onlyFirst: 1, onlySecond: 2, bothFail: 1 }),
    );
  });

  it("reads no pairs as no rate, not as a zero rate", () => {
    const compared = pairedComparison([]);
    expect(compared.firstPassRate).toBeNull();
    expect(compared.mcnemar.pValue).toBe(1);
  });
});

describe("Holm's adjustment of a family of tests", () => {
  it("reproduces the step-down worked by hand, in the order given", () => {
    const adjusted = holmAdjusted([0.01, 0.04, 0.03, 0.005]);
    expect(adjusted.map((value) => Number(value.toFixed(10)))).toEqual([0.03, 0.06, 0.06, 0.02]);
  });

  it("never passes 1 and never lowers a p-value", () => {
    const raw = [0.5, 0.9, 1, 0.2];
    const adjusted = holmAdjusted(raw);
    adjusted.forEach((value, at) => {
      expect(value).toBeLessThanOrEqual(1);
      expect(value).toBeGreaterThanOrEqual(raw[at] ?? 0);
    });
  });

  it("refuses something that is not a p-value", () => {
    expect(() => holmAdjusted([0.2, 1.5])).toThrow(/lies in \[0, 1\]/);
  });
});

describe("a pooled difference over several models on the same tasks", () => {
  const tasks = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"];
  const outcome = (at: number) => ({ first: at % 3 === 0, second: at % 2 === 0 });

  it("is the mean paired difference, and the same interval every time for one seed", () => {
    const rows = tasks.map((cluster, at) => ({ cluster, ...outcome(at) }));
    const once = clusteredDifferenceInterval(rows, { resamples: 2000, seed: 7 });
    expect(clusteredDifferenceInterval(rows, { resamples: 2000, seed: 7 })).toEqual(once);
    const mean =
      rows.reduce((total, row) => total + Number(row.second) - Number(row.first), 0) / rows.length;
    expect(once.point).toBeCloseTo(mean, 12);
    expect(once.lower).toBeLessThanOrEqual(once.point);
    expect(once.upper).toBeGreaterThanOrEqual(once.point);
    expect(once).toMatchObject({ rows: 10, clusters: 10 });
  });

  it("does not narrow because two models agreed on every task", () => {
    const single = tasks.map((cluster, at) => ({ cluster, ...outcome(at) }));
    const twice = tasks.flatMap((cluster, at) => [
      { cluster, ...outcome(at) },
      { cluster, ...outcome(at) },
    ]);
    const one = clusteredDifferenceInterval(single, { resamples: 2000, seed: 11 });
    const two = clusteredDifferenceInterval(twice, { resamples: 2000, seed: 11 });
    expect([two.lower, two.point, two.upper]).toEqual([one.lower, one.point, one.upper]);
    expect(two).toMatchObject({ rows: 20, clusters: 10 });
  });

  it("says nothing from no rows", () => {
    expect(clusteredDifferenceInterval([], { resamples: 100, seed: 1 })).toMatchObject({
      point: 0,
      lower: -1,
      upper: 1,
      clusters: 0,
    });
  });
});
