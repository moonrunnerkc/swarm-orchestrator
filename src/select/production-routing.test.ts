import { expect, it } from "vitest";
import { productionRouting } from "./production-routing.ts";
import type { RewardEntry } from "./routing-log.ts";
import type { RoutingInput } from "./ucb.ts";

function input(): RoutingInput {
  const entry: RewardEntry = {
    schemaVersion: 2,
    recordedAt: 0,
    sessionId: "fixture",
    taskClass: "edit",
    model: "measured",
    assignment: "calibration",
    ratchet: {
      settled: "green",
      attempts: 0,
      rejected: 0,
      erosions: 0,
      testsCollected: 1,
      testsDeclared: 1,
      assertions: 1,
      skipMarkers: 0,
      changedLineCoverage: 1,
    },
    attempts: 0,
    changedFiles: 1,
    latencyMs: 1,
    costUsd: 0,
    costSource: "local",
    reward: 1,
    rewardReason: "fixture",
  };
  return {
    taskClass: "edit",
    candidates: ["measured", "untried"],
    calibrationPick: "measured",
    entries: Array.from({ length: 20 }, () => entry),
    random: { next: () => 0 },
  };
}
it("does not give twenty rewards authority to explore an untried production model", () => {
  const decision = productionRouting(input(), { toolVersion: "fixture", goldenSetVersion: "one" });
  expect(decision.model).toBe("measured");
  expect(decision.assignment).toBe("calibration");
  expect(decision.reason).toContain("not authorized");
});
it("refuses stale or malformed held-out policy evidence", () => {
  expect(
    productionRouting(
      input(),
      { toolVersion: "new", goldenSetVersion: "one" },
      { version: 1, toolVersion: "old" },
    ).assignment,
  ).toBe("calibration");
});
