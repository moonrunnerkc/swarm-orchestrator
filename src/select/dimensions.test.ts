import { describe, expect, it } from "vitest";
import {
  calibrationDimensions,
  dimensionSpecs,
  distributionOf,
  statisticOf,
} from "./dimensions.ts";

describe("the calibration dimensions", () => {
  it("scores the six the design named, each on its own", () => {
    expect(calibrationDimensions).toEqual([
      "tool-call-validity",
      "patch-apply",
      "gate-pass",
      "tokens-per-second",
      "time-to-first-token",
      "peak-memory",
    ]);
  });

  it("says which way is better for each, because two of them are costs", () => {
    const better = new Map(dimensionSpecs.map((spec) => [spec.id, spec.better]));

    expect(better.get("gate-pass")).toBe("higher");
    expect(better.get("tokens-per-second")).toBe("higher");
    expect(better.get("time-to-first-token")).toBe("lower");
    expect(better.get("peak-memory")).toBe("lower");
  });

  it("summarizes a share by its mean and a cost by its median", () => {
    const statistic = new Map(dimensionSpecs.map((spec) => [spec.id, spec.summarizeWith]));

    // A share over repeats is a rate, so the mean is the rate. A latency is a distribution
    // with a tail, so the median is what survives one slow run.
    expect(statistic.get("gate-pass")).toBe("mean");
    expect(statistic.get("tool-call-validity")).toBe("mean");
    expect(statistic.get("patch-apply")).toBe("mean");
    expect(statistic.get("tokens-per-second")).toBe("median");
    expect(statistic.get("time-to-first-token")).toBe("median");
    expect(statistic.get("peak-memory")).toBe("median");
  });

  it("reads the ranking statistic off a distribution, and null when nothing measured it", () => {
    const spec = dimensionSpecs.find((candidate) => candidate.id === "gate-pass");
    if (spec === undefined) {
      throw new Error("gate-pass has no spec");
    }

    expect(statisticOf(distributionOf([1, 0, 1]), spec)).toBeCloseTo(2 / 3, 10);
    expect(statisticOf(distributionOf([null]), spec)).toBeNull();
  });

  it("has a spec for every dimension and no more", () => {
    expect(dimensionSpecs.map((spec) => spec.id)).toEqual([...calibrationDimensions]);
  });
});

describe("distributionOf", () => {
  it("reports the spread, not just the middle", () => {
    const distribution = distributionOf([2, 8, 4, 6]);

    expect(distribution).toMatchObject({ samples: 4, min: 2, max: 8, median: 5, mean: 5 });
    expect(distribution.deviation).toBeCloseTo(Math.sqrt(5), 10);
  });

  it("keeps the raw values, so a report can show the runs behind the summary", () => {
    expect(distributionOf([3, 1, 2]).values).toEqual([3, 1, 2]);
  });

  it("takes the median of an odd count as the middle value", () => {
    expect(distributionOf([9, 1, 5]).median).toBe(5);
  });

  it("counts a repeat that measured nothing instead of reading it as a zero", () => {
    const distribution = distributionOf([4, null, 6]);

    expect(distribution).toMatchObject({ samples: 2, unmeasured: 1, mean: 5 });
  });

  it("reports nothing at all when no repeat measured it", () => {
    expect(distributionOf([null, null])).toEqual({
      samples: 0,
      unmeasured: 2,
      min: null,
      median: null,
      max: null,
      mean: null,
      deviation: null,
      values: [],
    });
  });

  it("reports no spread when every repeat agreed, which is a finding of its own", () => {
    expect(distributionOf([0.5, 0.5, 0.5]).deviation).toBe(0);
  });
});
