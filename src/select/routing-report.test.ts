import { describe, expect, it } from "vitest";
import type { AssignmentKind } from "./routing-log.ts";
import { type RewardEntry, routingLogSchemaVersion } from "./routing-log.ts";
import { renderRoutingReport } from "./routing-report.ts";
import type { TaskClass } from "./task-class.ts";

interface RewardOverrides {
  readonly model?: string;
  readonly taskClass?: TaskClass;
  readonly reward?: number;
  readonly assignment?: AssignmentKind;
  readonly erosions?: number;
  readonly settled?: "green" | "escalated";
  readonly latencyMs?: number;
}

function reward(overrides: RewardOverrides = {}): RewardEntry {
  const settled = overrides.settled ?? "green";
  return {
    schemaVersion: routingLogSchemaVersion,
    recordedAt: 0,
    sessionId: "s",
    taskClass: overrides.taskClass ?? "edit",
    model: overrides.model ?? "local:qwen2.5-coder:7b",
    assignment: overrides.assignment ?? "ucb",
    ratchet: {
      settled,
      attempts: 0,
      rejected: 0,
      erosions: overrides.erosions ?? 0,
      testsCollected: null,
      testsDeclared: 0,
      assertions: 0,
      skipMarkers: 0,
      changedLineCoverage: null,
    },
    attempts: 0,
    latencyMs: overrides.latencyMs ?? 40_000,
    costUsd: 0,
    reward: overrides.reward ?? 0.6,
    rewardReason: "test fixture",
  };
}

function repeat(times: number, overrides: RewardOverrides = {}): readonly RewardEntry[] {
  return Array.from({ length: times }, () => reward(overrides));
}

function report(entries: readonly RewardEntry[], unreadable = 0): string {
  return renderRoutingReport({
    path: "/home/dev/.swarm/routing/rewards.jsonl",
    contents: { entries, unreadable },
  }).join("\n");
}

describe("renderRoutingReport", () => {
  it("says the log is empty on a first run, and that this is the expected state", () => {
    const text = report([]);

    expect(text).toContain("  runs              0");
    expect(text).toMatch(/no rewards have been logged yet/);
  });

  it("shows the sample count per class and whether the bandit is awake", () => {
    const text = report([...repeat(24), ...repeat(6, { taskClass: "test-fix" })]);

    expect(text).toContain("edit: 24 runs, the bandit is routing");
    expect(text).toContain("test-fix: 6 runs, the calibration pick stands (14 more needed)");
  });

  it("shows each model's runs, mean reward, and how many passes eroded a measure", () => {
    const text = report([
      ...repeat(3, { model: "fast", reward: 0.8 }),
      ...repeat(2, { model: "slow", reward: 0, settled: "green", erosions: 1 }),
    ]);

    expect(text).toMatch(/fast\s+3\s+0\.800\s+3\s+0/);
    // Two greens, both eroded: the columns sit side by side so the pass cannot be read alone.
    expect(text).toMatch(/slow\s+2\s+0\.000\s+2\s+2/);
  });

  it("shows the confidence bonus only once a class has enough to compare on", () => {
    expect(report(repeat(24, { model: "fast" }))).toMatch(
      /fast\s+24\s+0\.600\s+24\s+0\s+40s\s+\+0\./,
    );
    expect(report(repeat(4, { model: "fast" }))).toMatch(/fast\s+4\s+0\.600\s+4\s+0\s+40s\s+-/);
  });

  it("counts how the assignments were made, so the random share is visible", () => {
    const text = report([
      ...repeat(8, { assignment: "ucb" }),
      ...repeat(1, { assignment: "epsilon" }),
      ...repeat(3, { assignment: "calibration" }),
    ]);

    expect(text).toContain("  assignments       calibration 3, ucb 8, epsilon 1");
  });

  it("reports lines it could not read rather than pretending the log is clean", () => {
    expect(report(repeat(2), 3)).toMatch(/3 line\(s\) in the log could not be read/);
  });

  it("leaves out a class nothing has been logged for", () => {
    expect(report(repeat(2, { taskClass: "edit" }))).not.toContain("tool-heavy");
  });
});
