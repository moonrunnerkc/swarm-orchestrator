import { describe, expect, it } from "vitest";
import { findExhaustedLimit, type LoopBudget } from "./termination.ts";

const budget: LoopBudget = { maxSteps: 3, maxTokens: 100, maxWallTimeMs: 1000 };
const fresh = { steps: 0, tokensUsed: 0, elapsedMs: 0, interrupted: false };

describe("findExhaustedLimit", () => {
  it("continues while every limit has room", () => {
    expect(findExhaustedLimit(fresh, budget)).toBeNull();
    expect(findExhaustedLimit({ ...fresh, steps: 2, tokensUsed: 99 }, budget)).toBeNull();
  });

  it("reports each limit by name once it is reached", () => {
    expect(findExhaustedLimit({ ...fresh, steps: 3 }, budget)).toBe("max-steps");
    expect(findExhaustedLimit({ ...fresh, tokensUsed: 100 }, budget)).toBe("max-tokens");
    expect(findExhaustedLimit({ ...fresh, elapsedMs: 1000 }, budget)).toBe("max-wall-time");
  });

  it("reports an interrupt ahead of any exhausted budget", () => {
    const spent = { steps: 9, tokensUsed: 900, elapsedMs: 9000, interrupted: true };
    expect(findExhaustedLimit(spent, budget)).toBe("interrupted");
  });
});
