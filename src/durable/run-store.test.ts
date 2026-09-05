import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRunStore, type RunStore } from "./run-store.ts";

let root = "";
let store: RunStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-run-store-"));
  store = openRunStore(join(root, "runs.db"));
});

afterEach(async () => {
  store.close();
  await rm(root, { recursive: true, force: true });
});

const spec = { digest: `sha256:${"ab".repeat(32)}`, task: "fix the parser" };

describe("what a run leaves behind that survives the process", () => {
  it("records a run as started, and finds it again", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });

    expect(store.listRuns().map((run) => ({ runId: run.runId, state: run.state }))).toEqual([
      { runId: "r1", state: "running" },
    ]);
  });

  it("records an activity's intent before its effect, so a crash between the two is visible", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });
    store.beginStep({ runId: "r1", stepId: "s1", kind: "worker", idempotencyKey: "k1", at: 2 });

    const step = store.steps("r1")[0];
    expect(step).toMatchObject({ stepId: "s1", state: "in-flight", attempt: 1 });
    expect(step?.resultDigest).toBeNull();
  });

  it("does not run the same work twice under the same idempotency key", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });
    store.beginStep({ runId: "r1", stepId: "s1", kind: "worker", idempotencyKey: "k1", at: 2 });
    store.finishStep({ runId: "r1", stepId: "s1", resultDigest: "sha256:aa", at: 3 });

    expect(store.alreadyDone("r1", "k1")).toMatchObject({ resultDigest: "sha256:aa" });
    expect(store.alreadyDone("r1", "k2")).toBeNull();
  });

  it("counts a second attempt at a step rather than replacing the first", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });
    store.beginStep({ runId: "r1", stepId: "s1", kind: "worker", idempotencyKey: "k1", at: 2 });
    store.failStep({ runId: "r1", stepId: "s1", reason: "transient", at: 3 });
    store.beginStep({ runId: "r1", stepId: "s1", kind: "worker", idempotencyKey: "k1", at: 4 });

    expect(store.steps("r1")[0]).toMatchObject({ attempt: 2, state: "in-flight" });
  });

  it("holds a lease on a file, and refuses a second holder", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });

    expect(store.acquireLease({ runId: "r1", path: "src/a.ts", holder: "w1", at: 2 })).toBe(true);
    expect(store.acquireLease({ runId: "r1", path: "src/a.ts", holder: "w2", at: 3 })).toBe(false);

    store.releaseLease({ runId: "r1", path: "src/a.ts", holder: "w1" });
    expect(store.acquireLease({ runId: "r1", path: "src/a.ts", holder: "w2", at: 4 })).toBe(true);
  });

  it("reserves budget before dispatch and refuses what does not fit", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });
    store.setBudget({ runId: "r1", tokens: 1000 });

    expect(store.reserve({ runId: "r1", stepId: "s1", tokens: 600 })).toBe(true);
    expect(store.reserve({ runId: "r1", stepId: "s2", tokens: 600 })).toBe(false);
    expect(store.remainingTokens("r1")).toBe(400);
  });

  it("survives the process: a second open sees what the first wrote", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });
    store.beginStep({ runId: "r1", stepId: "s1", kind: "worker", idempotencyKey: "k1", at: 2 });
    store.close();

    const reopened = openRunStore(join(root, "runs.db"));
    try {
      expect(reopened.listRuns()).toHaveLength(1);
      expect(reopened.steps("r1")[0]?.state).toBe("in-flight");
    } finally {
      reopened.close();
      store = openRunStore(join(root, "runs.db"));
    }
  });

  it("names what a killed process left in flight, which is what resuming has to decide about", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });
    store.beginStep({ runId: "r1", stepId: "s1", kind: "worker", idempotencyKey: "k1", at: 2 });
    store.beginStep({ runId: "r1", stepId: "s2", kind: "worker", idempotencyKey: "k2", at: 2 });
    store.finishStep({ runId: "r1", stepId: "s2", resultDigest: "sha256:bb", at: 3 });
    store.acquireLease({ runId: "r1", path: "src/a.ts", holder: "s1", at: 2 });

    const interrupted = store.interrupted("r1");
    expect(interrupted.steps.map((step) => step.stepId)).toEqual(["s1"]);
    expect(interrupted.leases.map((lease) => lease.path)).toEqual(["src/a.ts"]);
  });

  it("repairs an interrupted run by releasing what it held and marking it interrupted", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });
    store.beginStep({ runId: "r1", stepId: "s1", kind: "worker", idempotencyKey: "k1", at: 2 });
    store.acquireLease({ runId: "r1", path: "src/a.ts", holder: "s1", at: 2 });

    const repaired = store.repair("r1", 9);

    expect(repaired.releasedLeases).toBe(1);
    expect(repaired.reopenedSteps).toBe(1);
    expect(store.steps("r1")[0]?.state).toBe("interrupted");
    expect(store.acquireLease({ runId: "r1", path: "src/a.ts", holder: "w2", at: 10 })).toBe(true);
  });

  it("marks a run aborted, and an aborted run accepts no new work", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });
    store.abortRun("r1", "the operator stopped it", 5);

    expect(store.listRuns()[0]?.state).toBe("aborted");
    expect(() =>
      store.beginStep({ runId: "r1", stepId: "s2", kind: "worker", idempotencyKey: "k2", at: 6 }),
    ).toThrow(/aborted/i);
  });

  it("records an approval, so a resumed run does not ask again", () => {
    store.startRun({ runId: "r1", specDigest: spec.digest, task: spec.task, startedAt: 1 });
    store.recordApproval({ runId: "r1", subject: "network", granted: true, at: 3 });

    expect(store.approvalFor("r1", "network")).toMatchObject({ granted: true });
    expect(store.approvalFor("r1", "landing")).toBeNull();
  });
});
