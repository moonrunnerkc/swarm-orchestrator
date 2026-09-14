import { expect, it } from "vitest";
import {
  measureBatch,
  profileProgress,
  profileSchedule,
  requireRuntimeCleanup,
} from "./profile-live.mjs";

it("keeps the fixed contention schedule within the authorized model and subprocess ceilings", () => {
  const schedule = profileSchedule();
  expect(new Set(schedule.map((batch) => batch.id)).size).toBe(schedule.length);
  expect(
    schedule.reduce(
      (sum, batch) =>
        sum + (batch.kind === "model" ? batch.operations : batch.kind === "mixed" ? 2 : 0),
      0,
    ),
  ).toBe(24);
  expect(
    schedule.reduce(
      (sum, batch) =>
        sum + (batch.kind === "tests" ? batch.operations : batch.kind === "mixed" ? 1 : 0),
      0,
    ),
  ).toBe(12);
  expect(schedule.every((batch) => batch.concurrency <= 2)).toBe(true);
});

it("retains completed batches but refuses an ambiguous interruption or a duplicate outcome", () => {
  const intent = { phase: "batch-intent", batch: { id: "model-0" } };
  const completed = {
    phase: "batch-completed",
    result: { id: "model-0", rows: [{ status: "failed" }] },
  };
  expect(() => profileProgress([intent])).toThrow(/reconciliation/);
  expect(profileProgress([intent, completed]).get("model-0").rows).toEqual([{ status: "failed" }]);
  expect(() => profileProgress([intent, completed, completed])).toThrow(/duplicate/);
});

it("refuses further profiling after unconfirmed container cleanup", () => {
  const payloads = new Map([
    ["created", { kind: "runtime-resource", phase: "created", identity: "owned-container" }],
    ["failed", { kind: "runtime-resource", phase: "cleanup-failed", identity: "owned-container" }],
    ["removed", { kind: "runtime-resource", phase: "removed", identity: "owned-container" }],
  ]);
  const evidence = (ids) => ({
    payloads: () => payloads,
    records: () => ids.map((payloadDigest) => ({ type: "campaign-observation", payloadDigest })),
  });
  expect(() => requireRuntimeCleanup(evidence(["created", "failed"]))).toThrow(/reconciliation/);
  expect(() => requireRuntimeCleanup(evidence(["created", "failed", "removed"]))).not.toThrow();
});

it("allows a real test operation past an occupied model permit only in the separate-pool measurement", async () => {
  for (const concurrency of [1, 2]) {
    const modelStarted = Promise.withResolvers();
    const releaseModel = Promise.withResolvers();
    const testStarted = Promise.withResolvers();
    let testRan = false;
    const pending = measureBatch({
      batch: { id: `mixed-${concurrency}`, kind: "mixed", concurrency },
      record: async () => {},
      tasks: [
        {
          kind: "model",
          run: async () => {
            modelStarted.resolve();
            await releaseModel.promise;
            return "model";
          },
        },
        {
          kind: "tests",
          run: async () => {
            testRan = true;
            testStarted.resolve();
            return "test";
          },
        },
      ],
    });
    await modelStarted.promise;
    if (concurrency === 1) expect(testRan).toBe(false);
    else await testStarted.promise;
    releaseModel.resolve();
    const result = await pending;
    expect(result.rows.map((row) => row.value)).toEqual(["model", "test"]);
    expect(result.rows.every((row) => row.queueMs >= 0 && row.elapsedMs >= 0)).toBe(true);
  }
});

it("records a failed activity alongside its successful peer instead of dropping the batch", async () => {
  const records = [];
  const result = await measureBatch({
    batch: { id: "tests-1", kind: "tests", concurrency: 2 },
    record: async (row) => records.push(row),
    tasks: [
      {
        kind: "tests",
        run: async () => {
          throw new Error("runner failed");
        },
      },
      { kind: "tests", run: async () => ({ exitCode: 0 }) },
    ],
  });
  expect(result.rows[0]).toMatchObject({ status: "failed", detail: "runner failed" });
  expect(result.rows[1]).toMatchObject({ status: "completed", value: { exitCode: 0 } });
  expect(records.filter((row) => row.phase === "operation-completed")).toHaveLength(2);
});
