import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { recordKindOf } from "../evidence/record-kind.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { emptyMeasureSnapshot } from "../gates/measure-snapshot.ts";
import { type Attempt, selectAttempt } from "./attempt-selector.ts";
import { recordSelection } from "./selection-record.ts";

let root = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-selection-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "coordinator",
    clock: createTestClock(1_700_000_000_000),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function attempt(index: number, overrides: Partial<Attempt> = {}): Attempt {
  return {
    workerId: `task-1-attempt-${index}`,
    taskId: "task-1",
    attemptIndex: index,
    green: true,
    commit: "c".repeat(40),
    baseCommit: "b".repeat(40),
    measures: { ...emptyMeasureSnapshot, testsCollected: index + 1 },
    erosions: 0,
    changedFiles: 1,
    addedLines: 10,
    ...overrides,
  };
}

describe("recording a selection", () => {
  it("writes one attempt-selection naming the task it is about", async () => {
    const selection = selectAttempt("task-1", [attempt(0), attempt(1)]);

    const recorded = await recordSelection(evidence, selection);

    const written = evidence.records().at(-1);
    expect(written?.type).toBe("attempt-selection");
    expect(recordKindOf("attempt-selection", evidence.payloads().get(recorded.digest))).toBe(
      "attempt-selection:task-1",
    );
  });

  it("carries every attempt's numbers, so the ranking can be re-read rather than trusted", async () => {
    const selection = selectAttempt("task-1", [attempt(0), attempt(1)]);

    const recorded = await recordSelection(evidence, selection);
    const payload = evidence.payloads().get(recorded.digest);

    expect(payload).toMatchObject({
      taskId: "task-1",
      baseCommit: "b".repeat(40),
      winner: "task-1-attempt-1",
      decidedBy: "testsCollected",
      ranked: 2,
      eligible: 2,
      order: ["task-1-attempt-1", "task-1-attempt-0"],
    });
    expect((payload as { attempts: unknown[] }).attempts).toHaveLength(2);
  });

  it("says what the numbers are a statement about", async () => {
    const selection = selectAttempt("task-1", [attempt(0)]);

    const recorded = await recordSelection(evidence, selection);

    expect(evidence.payloads().get(recorded.digest)).toMatchObject({
      basis: `pre-merge measures at ${"b".repeat(40)}`,
    });
  });

  it("counts an attempt that was left out, rather than dropping it", async () => {
    const selection = selectAttempt("task-1", [
      attempt(0, { green: false, commit: null }),
      attempt(1),
    ]);

    const recorded = await recordSelection(evidence, selection);
    const payload = evidence.payloads().get(recorded.digest) as {
      ranked: number;
      eligible: number;
      attempts: { eligible: boolean; reason: string | null }[];
    };

    expect(payload.ranked).toBe(2);
    expect(payload.eligible).toBe(1);
    expect(payload.attempts.filter((one) => !one.eligible)).toEqual([
      expect.objectContaining({ reason: "gates were not green" }),
    ]);
  });
});
