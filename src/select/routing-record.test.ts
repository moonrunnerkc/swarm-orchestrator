import { describe, expect, it } from "vitest";
import { ledgerRecordSchema } from "../evidence/ledger-record.ts";
import type { RewardEntry } from "./routing-log.ts";
import { routingLogSchemaVersion } from "./routing-log.ts";
import { routingDecisionRecord } from "./routing-record.ts";
import { defaultRouterSettings, type RoutingInput, routeModel } from "./ucb.ts";

function reward(model: string, value: number): RewardEntry {
  return {
    schemaVersion: routingLogSchemaVersion,
    recordedAt: 0,
    sessionId: "s",
    taskClass: "edit",
    model,
    assignment: "ucb",
    ratchet: {
      settled: "green",
      attempts: 0,
      rejected: 0,
      erosions: 0,
      testsCollected: 1,
      testsDeclared: 1,
      assertions: 1,
      skipMarkers: 0,
      changedLineCoverage: null,
    },
    attempts: 0,
    changedFiles: 1,
    latencyMs: 1_000,
    costUsd: 0,
    costSource: "local",
    reward: value,
    rewardReason: "green",
  };
}

function decisionOver(entries: readonly RewardEntry[]) {
  const input: RoutingInput = {
    taskClass: "edit",
    candidates: ["local:a", "local:b"],
    calibrationPick: "local:a",
    entries,
    random: { next: () => 0.99 },
    settings: defaultRouterSettings,
  };
  return routeModel(input);
}

describe("the routing decision as a ledger record", () => {
  /**
   * The type was declared and nothing wrote it, which is the shape an auditor flags: an
   * evidence type a bundle can never contain says the system records something it does
   * not. This is that recorder, so what it carries is checked against a real decision
   * rather than a literal somebody typed.
   */
  it("carries the model, the grounds, and every arm the router weighed", () => {
    const entries = [
      ...Array.from({ length: 20 }, () => reward("local:a", 0.4)),
      ...Array.from({ length: 20 }, () => reward("local:b", 0.9)),
    ];
    const decision = decisionOver(entries);
    const record = routingDecisionRecord(decision);

    expect(record.type).toBe("routing-decision");
    expect(record.actor).toBe("harness");
    expect(record.payload.model).toBe(decision.model);
    expect(record.payload.assignment).toBe(decision.assignment);
    expect(record.payload.samples).toBe(40);
    expect(record.payload.arms.map((arm) => arm.model)).toEqual(["local:a", "local:b"]);
  });

  /**
   * The point of keeping the losers. Without the arms, an exploration that lost and a
   * best-index pick that lost are the same line in the log.
   */
  it("keeps the arms it did not pick, with their samples and mean reward", () => {
    const entries = [
      ...Array.from({ length: 20 }, () => reward("local:a", 0.4)),
      ...Array.from({ length: 20 }, () => reward("local:b", 0.9)),
    ];
    const record = routingDecisionRecord(decisionOver(entries));
    const rejected = record.payload.arms.filter((arm) => arm.model !== record.payload.model);

    expect(rejected.length).toBe(1);
    expect(rejected[0]?.samples).toBe(20);
    expect(typeof rejected[0]?.meanReward).toBe("number");
  });

  it("records a decision taken below the sample threshold, where nothing is compared yet", () => {
    const record = routingDecisionRecord(decisionOver([reward("local:a", 0.5)]));

    expect(record.payload.samples).toBeLessThan(record.payload.threshold);
    // Null rather than a number, because an index computed off one sample is not a
    // comparison and writing a figure there would read as one.
    expect(record.payload.arms.every((arm) => arm.index === null)).toBe(true);
  });

  it("is a shape the ledger accepts, so writing it cannot abort a run", () => {
    const record = routingDecisionRecord(decisionOver([reward("local:a", 0.5)]));
    const parsed = ledgerRecordSchema.safeParse({
      schemaVersion: 1,
      sequence: 3,
      previousHash: `sha256:${"a".repeat(64)}`,
      timestamp: 1_700_000_000_000,
      type: record.type,
      actor: record.actor,
      payloadDigest: `sha256:${"b".repeat(64)}`,
      provenance: record.provenance,
    });

    expect(parsed.success).toBe(true);
  });

  it("tags provenance as tool-output, since the reward log is harness measurement", () => {
    expect(routingDecisionRecord(decisionOver([reward("local:a", 0.5)])).provenance).toEqual([
      "tool-output",
    ]);
  });
});

describe("the competency table in the routing record", () => {
  it("carries the lookup, counts included, and null where no table was consulted", () => {
    const lookup = {
      taskClass: "edit" as const,
      floor: 6,
      pick: "local:b",
      abstained: false,
      reason: "local:b passed the gate on 5 of 6 executed edit run(s) across 1 sweep(s)",
      considered: [
        {
          model: "local:a",
          taskClass: "edit" as const,
          executed: 6,
          gatePassed: 3,
          gateShare: 0.5,
          sweeps: 1,
        },
        {
          model: "local:b",
          taskClass: "edit" as const,
          executed: 6,
          gatePassed: 5,
          gateShare: 5 / 6,
          sweeps: 1,
        },
      ],
    };
    const withTable = routeModel({
      taskClass: "edit",
      candidates: ["local:a", "local:b"],
      calibrationPick: "local:a",
      entries: [],
      random: { next: () => 0.99 },
      competency: lookup,
    });

    const record = routingDecisionRecord(withTable);

    expect(record.payload.model).toBe("local:b");
    expect(record.payload.assignment).toBe("competency");
    expect(record.payload.competency).toEqual({
      taskClass: "edit",
      floor: 6,
      pick: "local:b",
      abstained: false,
      reason: lookup.reason,
      considered: [
        { model: "local:a", executed: 6, gatePassed: 3, gateShare: 0.5, sweeps: 1 },
        { model: "local:b", executed: 6, gatePassed: 5, gateShare: 5 / 6, sweeps: 1 },
      ],
    });
    expect(routingDecisionRecord(decisionOver([])).payload.competency).toBeNull();
  });
});
