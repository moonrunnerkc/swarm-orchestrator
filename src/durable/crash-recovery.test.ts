import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRunStore } from "./run-store.ts";

let root = "";
let dbPath = "";
let sideEffects = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-crash-"));
  dbPath = join(root, "runs.db");
  sideEffects = join(root, "effects.log");
  await writeFile(sideEffects, "");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * One unit of work with a committed external effect: appending a line to a file. The point is
 * that resuming must not append it twice, which is the whole of what idempotency buys.
 */
async function doWork(runId: string, stepId: string, key: string, crashAfterIntent: boolean) {
  const store = openRunStore(dbPath);
  try {
    const done = store.alreadyDone(runId, key);
    if (done !== null) {
      return "skipped";
    }
    store.beginStep({ runId, stepId, kind: "work", idempotencyKey: key, at: Date.now() });
    if (crashAfterIntent) {
      // The process dies here: intent is recorded, the effect never happened.
      return "crashed";
    }
    await writeFile(sideEffects, `${await readFile(sideEffects, "utf8")}${stepId}\n`);
    store.finishStep({ runId, stepId, resultDigest: `sha256:${stepId}`, at: Date.now() });
    return "done";
  } finally {
    store.close();
  }
}

async function effectLines() {
  return (await readFile(sideEffects, "utf8")).split("\n").filter((line) => line.length > 0);
}

describe("a process killed part way through", () => {
  it("leaves the intent visible and the effect absent, which is what makes recovery possible", async () => {
    const store = openRunStore(dbPath);
    store.startRun({ runId: "r1", specDigest: "sha256:aa", task: "t", startedAt: 1 });
    store.close();

    expect(await doWork("r1", "s1", "k1", true)).toBe("crashed");

    const reopened = openRunStore(dbPath);
    try {
      expect(reopened.interrupted("r1").steps.map((step) => step.stepId)).toEqual(["s1"]);
      expect(await effectLines()).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it("redoes work whose effect never landed, and only that work", async () => {
    const store = openRunStore(dbPath);
    store.startRun({ runId: "r1", specDigest: "sha256:aa", task: "t", startedAt: 1 });
    store.close();

    await doWork("r1", "s1", "k1", false);
    await doWork("r1", "s2", "k2", true);

    // Resume: the first is already committed, the second never happened.
    expect(await doWork("r1", "s1", "k1", false)).toBe("skipped");
    expect(await doWork("r1", "s2", "k2", false)).toBe("done");

    expect(await effectLines()).toEqual(["s1", "s2"]);
  });

  it("commits no effect twice across a hundred injected kills", async () => {
    // The mission's bar is recovery without repeating a committed effect. A hundred runs, each
    // killed at a random point, each resumed, and the effect log is the whole check.
    let recovered = 0;
    for (let index = 0; index < 100; index += 1) {
      const runId = `run-${index}`;
      const store = openRunStore(dbPath);
      store.startRun({ runId, specDigest: "sha256:aa", task: "t", startedAt: index });
      store.close();

      const killAt = index % 3;
      for (let step = 0; step < 3; step += 1) {
        await doWork(runId, `${runId}-s${step}`, `${runId}-k${step}`, step === killAt);
      }
      // Resume every step; the ones that committed are skipped.
      for (let step = 0; step < 3; step += 1) {
        await doWork(runId, `${runId}-s${step}`, `${runId}-k${step}`, false);
      }
      recovered += 1;
    }

    const lines = await effectLines();
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines).toHaveLength(300);
    expect(recovered).toBe(100);
  }, 120_000);

  it("releases what an interrupted run held, so the next run is not blocked by a dead one", async () => {
    const store = openRunStore(dbPath);
    store.startRun({ runId: "r1", specDigest: "sha256:aa", task: "t", startedAt: 1 });
    store.beginStep({ runId: "r1", stepId: "s1", kind: "work", idempotencyKey: "k1", at: 2 });
    store.acquireLease({ runId: "r1", path: "src/a.ts", holder: "s1", at: 2 });
    store.close();

    const reopened = openRunStore(dbPath);
    try {
      expect(reopened.repair("r1", 9).releasedLeases).toBe(1);
      expect(reopened.leases("r1")).toHaveLength(0);
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      reopened.close();
    }
  });
});
