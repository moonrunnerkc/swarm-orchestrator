import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultRoutingLogPath,
  openRoutingLog,
  type RewardEntry,
  routingLogSchemaVersion,
} from "./routing-log.ts";

let directory = "";
let path = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "swarm-routing-"));
  path = join(directory, "rewards.jsonl");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function entry(overrides: Partial<RewardEntry> = {}): RewardEntry {
  return {
    schemaVersion: routingLogSchemaVersion,
    recordedAt: 1_700_000_000_000,
    sessionId: "20260813T190000-abc123",
    taskClass: "edit",
    model: "local:qwen2.5-coder:7b",
    assignment: "calibration",
    ratchet: {
      settled: "green",
      attempts: 0,
      rejected: 0,
      erosions: 0,
      testsCollected: 47,
      testsDeclared: 9,
      assertions: 21,
      skipMarkers: 0,
      changedLineCoverage: 0.9,
    },
    attempts: 0,
    latencyMs: 42_000,
    costUsd: 0,
    reward: 0.74,
    rewardReason: "green with 0 retries, 42s, and $0.0000",
    ...overrides,
  };
}

describe("the routing log", () => {
  it("reads an absent log as empty, because the first run has no history", async () => {
    const log = await openRoutingLog({ path });

    expect(await log.read()).toEqual({ entries: [], unreadable: 0 });
  });

  it("appends an entry and reads it back", async () => {
    const log = await openRoutingLog({ path });

    await log.append(entry());

    expect((await log.read()).entries).toEqual([entry()]);
  });

  it("keeps entries in the order they arrived", async () => {
    const log = await openRoutingLog({ path });

    await log.append(entry({ model: "first" }));
    await log.append(entry({ model: "second" }));

    expect((await log.read()).entries.map((row) => row.model)).toEqual(["first", "second"]);
  });

  it("only ever adds, so an earlier run's line is still there byte for byte", async () => {
    const log = await openRoutingLog({ path });
    await log.append(entry({ model: "first" }));
    const afterFirst = await readFile(path, "utf8");

    await log.append(entry({ model: "second" }));

    const afterSecond = await readFile(path, "utf8");
    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
  });

  it("counts a line it cannot read rather than dropping it in silence", async () => {
    const log = await openRoutingLog({ path });
    await log.append(entry());
    await appendFile(path, "{not json}\n");
    await appendFile(path, `${JSON.stringify({ schemaVersion: 99 })}\n`);

    const contents = await log.read();

    expect(contents.entries).toHaveLength(1);
    expect(contents.unreadable).toBe(2);
  });

  it("refuses an entry that does not match the schema, naming the field", async () => {
    const log = await openRoutingLog({ path });

    await expect(log.append({ ...entry(), reward: 4 })).rejects.toThrow(/reward/);
  });

  it("lives beside the session store, outside any workspace", () => {
    expect(defaultRoutingLogPath("/home/dev")).toBe("/home/dev/.swarm/routing/rewards.jsonl");
  });
});
