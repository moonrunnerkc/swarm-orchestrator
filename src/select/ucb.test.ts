import { describe, expect, it } from "vitest";
import type { RandomSource } from "../core/random-source.ts";
import { buildRewardEntry } from "./reward.ts";
import type { RewardEntry } from "./routing-log.ts";
import { routingLogSchemaVersion } from "./routing-log.ts";
import type { TaskClass } from "./task-class.ts";
import { defaultRouterSettings, type RoutingInput, routeModel } from "./ucb.ts";

function reward(model: string, value: number, taskClass: TaskClass = "edit"): RewardEntry {
  return {
    schemaVersion: routingLogSchemaVersion,
    recordedAt: 0,
    sessionId: "s",
    taskClass,
    model,
    assignment: "ucb",
    ratchet: {
      settled: value > 0 ? "green" : "escalated",
      attempts: 0,
      rejected: 0,
      erosions: 0,
      testsCollected: null,
      testsDeclared: 0,
      assertions: 0,
      skipMarkers: 0,
      changedLineCoverage: null,
    },
    attempts: 0,
    changedFiles: 1,
    latencyMs: 0,
    costUsd: 0,
    costSource: "local",
    reward: value,
    rewardReason: "test fixture",
  };
}

function repeat(model: string, value: number, times: number, taskClass: TaskClass = "edit") {
  return Array.from({ length: times }, () => reward(model, value, taskClass));
}

const never: RandomSource = { next: () => 0.99 };

/** Deterministic, so an epsilon rate is a fact about the router and not about the day. */
function createSeededRandom(seed: number): RandomSource {
  let state = seed;
  return {
    next: () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    },
  };
}

function route(overrides: Partial<RoutingInput> = {}) {
  return routeModel({
    taskClass: "edit",
    candidates: ["fast", "slow"],
    calibrationPick: "fast",
    entries: [],
    random: never,
    ...overrides,
  });
}

describe("routeModel below the sample threshold", () => {
  it("leaves the calibration pick alone, because a bandit on five points is astrology", () => {
    const decision = route({ entries: repeat("fast", 0.5, defaultRouterSettings.minSamples - 1) });

    expect(decision).toMatchObject({ model: "fast", assignment: "calibration" });
    expect(decision.reason).toMatch(/19 of the 20/);
  });

  it("counts only the samples for the class it is routing", () => {
    const decision = route({
      taskClass: "test-fix",
      entries: repeat("slow", 0.9, 40, "edit"),
    });

    expect(decision.assignment).toBe("calibration");
    expect(decision.samples).toBe(0);
  });

  it("still reports the arms, so the table shows what it has so far", () => {
    const decision = route({ entries: [...repeat("fast", 0.4, 3), ...repeat("slow", 0.8, 2)] });

    expect(decision.arms).toEqual([
      { model: "fast", samples: 3, meanReward: expect.closeTo(0.4, 10), bonus: null, index: null },
      { model: "slow", samples: 2, meanReward: expect.closeTo(0.8, 10), bonus: null, index: null },
    ]);
  });
});

describe("routeModel above the sample threshold", () => {
  const enough = [...repeat("fast", 0.4, 12), ...repeat("slow", 0.8, 12)];

  it("takes over from the calibration pick", () => {
    const decision = route({ entries: enough });

    expect(decision.assignment).toBe("ucb");
    expect(decision.model).toBe("slow");
  });

  it("plays an arm nobody has tried before comparing any means", () => {
    const decision = route({
      candidates: ["fast", "slow", "untried"],
      entries: enough,
    });

    expect(decision.model).toBe("untried");
    expect(decision.reason).toMatch(/never been tried/);
  });

  it("gives a thinly sampled arm the benefit of the doubt", () => {
    // Worse mean, far fewer samples: the confidence bonus is what makes it worth another look.
    const decision = route({
      entries: [...repeat("fast", 0.62, 60), ...repeat("slow", 0.55, 3)],
    });

    expect(decision.model).toBe("slow");
  });

  it("settles on the better arm once both are well sampled", () => {
    const decision = route({
      entries: [...repeat("fast", 0.62, 200), ...repeat("slow", 0.55, 200)],
    });

    expect(decision.model).toBe("fast");
  });

  it("learns to avoid a model whose passes tripped the ratchet, because they scored zero", () => {
    const decision = route({
      entries: [...repeat("fast", 0, 40), ...repeat("slow", 0.5, 40)],
    });

    expect(decision.model).toBe("slow");
  });

  it("shows the index it compared each arm on", () => {
    const decision = route({ entries: enough });
    const arm = decision.arms.find((candidate) => candidate.model === "slow");

    expect(arm?.meanReward).toBeCloseTo(0.8, 10);
    expect(arm?.bonus ?? 0).toBeGreaterThan(0);
    expect(arm?.index ?? 0).toBeCloseTo(0.8 + (arm?.bonus ?? 0), 10);
  });
});

describe("routeModel and the epsilon of random assignment", () => {
  const enough = [...repeat("fast", 0.9, 30), ...repeat("slow", 0.1, 30)];

  it("marks a random assignment as one, so the log is not read as a choice", () => {
    const decision = route({ entries: enough, random: { next: () => 0.01 } });

    expect(decision.assignment).toBe("epsilon");
    expect(decision.reason).toMatch(/at random/);
  });

  it("assigns at random at about the configured rate", () => {
    const random = createSeededRandom(20_260_813);
    let epsilonAssignments = 0;

    for (let trial = 0; trial < 2_000; trial += 1) {
      if (route({ entries: enough, random }).assignment === "epsilon") {
        epsilonAssignments += 1;
      }
    }

    // 10% of 2000, well inside three standard deviations either way.
    expect(epsilonAssignments).toBeGreaterThan(160);
    expect(epsilonAssignments).toBeLessThan(240);
  });

  it("never assigns at random below the threshold, where there is nothing to unbias", () => {
    const decision = route({ entries: repeat("fast", 0.5, 4), random: { next: () => 0.01 } });

    expect(decision.assignment).toBe("calibration");
  });

  it("spreads its random assignments over every candidate", () => {
    const random = createSeededRandom(7);
    const chosen = new Set<string>();

    for (let trial = 0; trial < 500; trial += 1) {
      const decision = route({ candidates: ["a", "b", "c"], entries: enough, random });
      if (decision.assignment === "epsilon") {
        chosen.add(decision.model);
      }
    }

    expect([...chosen].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("the cost term in routing", () => {
  const greenRatchet = {
    settled: "green" as const,
    attempts: 0,
    rejected: 0,
    erosions: 0,
    testsCollected: 47,
    testsDeclared: 9,
    assertions: 21,
    skipMarkers: 0,
    changedLineCoverage: 0.9,
  };

  function priced(model: string, costUsd: number): RewardEntry {
    return buildRewardEntry({
      recordedAt: 0,
      sessionId: "s",
      taskClass: "edit",
      model,
      assignment: "ucb",
      ratchet: greenRatchet,
      changedFiles: 1,
      latencyMs: 30_000,
      costUsd,
      costSource: "priced",
    });
  }

  it("routes to the cheaper of two models that tie on every other dimension", () => {
    // Both models go green with the same ratchet numerics, the same attempts, and the same
    // latency; the rewards in the log differ only through the cost term. If this test
    // fails, cost has stopped influencing routing and costUsd is decoration again.
    const entries = [
      ...Array.from({ length: 12 }, () => priced("cheap", 0.01)),
      ...Array.from({ length: 12 }, () => priced("dear", 0.5)),
    ];

    const decision = route({
      candidates: ["cheap", "dear"],
      calibrationPick: "dear",
      entries,
    });

    expect(decision.assignment).toBe("ucb");
    expect(decision.model).toBe("cheap");
  });
});
