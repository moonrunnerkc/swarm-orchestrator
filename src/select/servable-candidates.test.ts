import { describe, expect, it } from "vitest";
import { servableCandidates } from "./servable-candidates.ts";

const candidates = ["local:qwen3.5:27b", "local:qwen3.8:27b", "anthropic:claude-opus-5"];

describe("the arms a run can actually reach", () => {
  it("drops a local model the endpoint does not serve", () => {
    // What this cost: the router named qwen3.5:27b on every run of a machine that has not
    // served it for months, then swapped it out again, because an arm with no samples is the
    // one UCB reaches for first and this one could never earn a sample to stop that.
    expect(servableCandidates(candidates, new Set(["qwen3.8:27b"]))).toEqual([
      "local:qwen3.8:27b",
      "anthropic:claude-opus-5",
    ]);
  });

  it("leaves every arm alone when the endpoint would not say what it serves", () => {
    expect(servableCandidates(candidates, null)).toEqual(candidates);
    expect(servableCandidates(candidates, new Set())).toEqual(candidates);
  });

  it("keeps them all rather than leaving nothing to route between", () => {
    expect(servableCandidates(["local:a", "local:b"], new Set(["c"]))).toEqual([
      "local:a",
      "local:b",
    ]);
  });
});
