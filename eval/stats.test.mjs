import { describe, expect, it } from "vitest";
import { mcnemar, wilson } from "./stats.mjs";

describe("interval and test", () => {
  it("gives the published Wilson interval for 8 of 10", () => {
    const [low, high] = wilson(8, 10);
    expect(low).toBeCloseTo(0.4902, 3);
    expect(high).toBeCloseTo(0.9433, 3);
    expect(wilson(0, 0)).toBeNull();
  });

  it("gives the exact McNemar p-value from the discordant pairs", () => {
    expect(mcnemar(0, 0)).toBe(1);
    expect(mcnemar(0, 5)).toBeCloseTo(0.0625, 6);
    expect(mcnemar(2, 8)).toBeCloseTo(0.109375, 6);
  });
});
