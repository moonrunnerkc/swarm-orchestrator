import { describe, expect, it } from "vitest";
import { ceilingBytes, requiredHeadroomBytes, weightVerdict } from "./check-repo-weight.mjs";

describe("the tracked tree's weight", () => {
  it("passes with the required room left over", () => {
    expect(weightVerdict(ceilingBytes - requiredHeadroomBytes)).toEqual({
      status: "ok",
      headroom: requiredHeadroomBytes,
    });
  });

  it("fails before the ceiling, while there is still something to be done about it", () => {
    // The tree the reach-pressure experiment was committed into: 99.8 MB of 100.
    const verdict = weightVerdict(Math.round(99.8 * 1024 * 1024));
    expect(verdict.status).toBe("inadequate-headroom");
    expect(verdict.headroom).toBeLessThan(requiredHeadroomBytes);
  });

  it("one byte short of the required room is already short", () => {
    expect(weightVerdict(ceilingBytes - requiredHeadroomBytes + 1).status).toBe(
      "inadequate-headroom",
    );
  });

  it("names a tree past the ceiling as that, and not as a headroom problem", () => {
    expect(weightVerdict(ceilingBytes + 1).status).toBe("over-ceiling");
  });
});
