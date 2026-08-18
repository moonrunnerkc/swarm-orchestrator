import { describe, expect, it } from "vitest";
import { buildRewardEntry, defaultRewardWeights, type RewardInput, scoreReward } from "./reward.ts";
import { rewardEntrySchema } from "./routing-log.ts";

function run(overrides: Partial<RewardInput> = {}): RewardInput {
  return {
    settled: "green",
    erosions: 0,
    attempts: 0,
    changedFiles: 1,
    latencyMs: 0,
    costUsd: 0,
    ...overrides,
  };
}

describe("scoreReward", () => {
  it("gives the top of the range to a green run that took nothing to get there", () => {
    expect(scoreReward(run()).reward).toBe(1);
  });

  it("scores an escalated run zero", () => {
    const score = scoreReward(run({ settled: "escalated" }));

    expect(score.reward).toBe(0);
    expect(score.reason).toMatch(/escalated/);
  });

  it("scores a green run that tripped the ratchet exactly like a failure", () => {
    // The whole point of section 3.8's first correction: unratcheted pass rate rewards
    // whichever model is best at weakening tests.
    const eroded = scoreReward(run({ settled: "green", erosions: 1, attempts: 2 }));

    expect(eroded.reward).toBe(0);
    expect(eroded.reason).toMatch(/ratchet/);
    expect(eroded.reward).toBe(scoreReward(run({ settled: "escalated" })).reward);
  });

  /**
   * Found live, not reasoned about: a local model declared a file set, wrote nothing, and
   * stopped. Every gate passed over the unchanged tree, the run took 22s and cost nothing,
   * and it scored 0.846. Fast and free is what doing nothing looks like to every other term
   * here, so without this the router learns to prefer whichever model does the least.
   */
  it("scores a run that changed no file zero, however cheap and fast it was", () => {
    const score = scoreReward(run({ changedFiles: 0, latencyMs: 0, costUsd: 0 }));

    expect(score.reward).toBe(0);
    expect(score.reason).toContain("never changed");
  });

  it("does not punish a run for a change count nobody measured", () => {
    // Null is not zero. Scoring an unmeasured run as a no-op is the same mistake pointed
    // the other way, and invariant 7 abstains on a measure nothing took rather than
    // assuming one.
    expect(scoreReward(run({ changedFiles: null })).reward).toBe(1);
  });

  it("still pays a run whose retry crashed rather than eroded anything", () => {
    const score = scoreReward(run({ attempts: 1, erosions: 0 }));

    expect(score.reward).toBeGreaterThan(0);
  });

  it("takes something off for every retry it needed", () => {
    const first = scoreReward(run({ attempts: 0 })).reward;
    const second = scoreReward(run({ attempts: 1 })).reward;
    const third = scoreReward(run({ attempts: 2 })).reward;

    expect(second).toBeLessThan(first);
    expect(third).toBeLessThan(second);
  });

  it("scores a slower run below an identical faster one", () => {
    const quick = scoreReward(run({ latencyMs: 10_000 })).reward;
    const slow = scoreReward(run({ latencyMs: 600_000 })).reward;

    expect(slow).toBeLessThan(quick);
  });

  it("scores a dearer run below an identical cheaper one", () => {
    const cheap = scoreReward(run({ costUsd: 0.001 })).reward;
    const dear = scoreReward(run({ costUsd: 2 })).reward;

    expect(dear).toBeLessThan(cheap);
  });

  it("treats an unknown cost as a run at the reference cost: neutral, never free", () => {
    // Free would hand an unpriced model the same advantage as a local one. Neutral means
    // it is scored as if it cost the reference amount, and priced models compete around it.
    const unknown = scoreReward(run({ costUsd: null })).reward;
    const free = scoreReward(run({ costUsd: 0 })).reward;
    const reference = scoreReward(run({ costUsd: defaultRewardWeights.referenceCostUsd })).reward;

    expect(unknown).toBeLessThan(free);
    expect(unknown).toBe(reference);
    expect(scoreReward(run({ costUsd: null })).reason).toMatch(/unknown cost/);
  });

  it("stays inside zero and one whatever it is handed", () => {
    for (const input of [
      run({ attempts: 99, latencyMs: 9_000_000, costUsd: 500 }),
      run({ settled: "escalated", attempts: 3 }),
      run(),
    ]) {
      const { reward } = scoreReward(input);
      expect(reward).toBeGreaterThanOrEqual(0);
      expect(reward).toBeLessThanOrEqual(1);
    }
  });

  it("takes tuned weights, because the reference points are guesses until measured", () => {
    const strict = scoreReward(run({ attempts: 1 }), {
      ...defaultRewardWeights,
      attemptPenalty: 4,
    });

    expect(strict.reward).toBeLessThan(scoreReward(run({ attempts: 1 })).reward);
  });

  it("says what it weighed, so a routing table can be read without the formula", () => {
    expect(scoreReward(run({ attempts: 1, latencyMs: 60_000 })).reason).toMatch(/green.*1 retry/);
  });
});

describe("buildRewardEntry", () => {
  const ratchet = {
    settled: "green" as const,
    attempts: 1,
    rejected: 0,
    erosions: 0,
    testsCollected: 47,
    testsDeclared: 9,
    assertions: 21,
    skipMarkers: 0,
    changedLineCoverage: 0.9,
  };

  function entry(overrides: Partial<Parameters<typeof buildRewardEntry>[0]> = {}) {
    return buildRewardEntry({
      recordedAt: 1_700_000_000_000,
      sessionId: "20260813T190000-abc123",
      taskClass: "edit",
      model: "local:qwen2.5-coder:7b",
      assignment: "ucb",
      ratchet,
      changedFiles: 1,
      latencyMs: 42_000,
      costUsd: 0,
      costSource: "local",
      ...overrides,
    });
  }

  it("carries the change count the score turned on, so the log shows why it was zero", () => {
    const written = entry({ changedFiles: 0 });

    expect({ changedFiles: written.changedFiles, reward: written.reward }).toEqual({
      changedFiles: 0,
      reward: 0,
    });
    expect(rewardEntrySchema.parse(written).rewardReason).toContain("never changed");
  });

  it("carries what happened and what it scored, in one line the log accepts", () => {
    expect(rewardEntrySchema.safeParse(entry()).success).toBe(true);
  });

  it("takes the attempts from the ratchet summary rather than being told twice", () => {
    expect(entry().attempts).toBe(1);
  });

  it("scores a run whose retry eroded a measure as a failure", () => {
    const eroded = entry({ ratchet: { ...ratchet, erosions: 1, rejected: 1 } });

    expect(eroded.reward).toBe(0);
    expect(eroded.rewardReason).toMatch(/ratchet/);
  });

  it("keeps the ratchet numerics in the entry, so the log shows why it scored that way", () => {
    expect(entry().ratchet).toEqual(ratchet);
  });

  it("carries an unknown cost as unknown, and the log still accepts the line", () => {
    const unpriced = entry({ costUsd: null, costSource: "unknown" });

    expect(unpriced.costUsd).toBeNull();
    expect(unpriced.costSource).toBe("unknown");
    expect(rewardEntrySchema.safeParse(unpriced).success).toBe(true);
  });
});
