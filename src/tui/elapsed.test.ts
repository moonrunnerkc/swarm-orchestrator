import { describe, expect, it } from "vitest";
import { formatElapsed } from "./elapsed.ts";

describe("formatElapsed", () => {
  it("counts seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(9_400)).toBe("9s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  it("counts minutes and seconds under an hour", () => {
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(92_000)).toBe("1m 32s");
    expect(formatElapsed(3_599_000)).toBe("59m 59s");
  });

  it("counts hours and minutes beyond that", () => {
    expect(formatElapsed(3_600_000)).toBe("1h 00m");
    expect(formatElapsed(7_320_000)).toBe("2h 02m");
  });

  it("reads a clock that went backwards as no time at all rather than as a negative", () => {
    expect(formatElapsed(-5_000)).toBe("0s");
  });
});
