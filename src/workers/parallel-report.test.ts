import { describe, expect, it } from "vitest";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { emptyMeasureSnapshot } from "../gates/measure-snapshot.ts";
import type { QueueLanding } from "./merge-queue.ts";
import { renderParallelReport } from "./parallel-report.ts";
import type { ParallelRunResult, WorkerResult } from "./parallel-run.ts";

const evidence = { sessionId: "s" } as EvidenceRecorder;

function worker(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    workerId: "worker-1",
    taskId: "task-1",
    attemptIndex: 0,
    task: "add a shout to alpha",
    branch: "swarm/run1/worker-1",
    evidence,
    green: true,
    commit: "a".repeat(40),
    declaredFiles: ["src/alpha.js"],
    detail: "gates green after 3 step(s)",
    measures: emptyMeasureSnapshot,
    erosions: 0,
    changedFiles: 1,
    addedLines: 4,
    ...overrides,
  };
}

function landing(overrides: Partial<QueueLanding> = {}): QueueLanding {
  return {
    workerId: "worker-1",
    branch: "swarm/run1/worker-1",
    landed: true,
    reason: null,
    feedback: "",
    commit: "b".repeat(40),
    cycle: null,
    decision: null,
    record: "sha256:aa",
    ...overrides,
  };
}

function report(overrides: Partial<ParallelRunResult> = {}): string {
  const result: ParallelRunResult = {
    workers: [worker()],
    selections: [],
    queue: {
      baseCommit: "c".repeat(40),
      headCommit: "b".repeat(40),
      landings: [landing()],
      baseCycle: null as never,
    },
    integrationBranch: "swarm/run1/integration",
    baseCommit: "c".repeat(40),
    headCommit: "b".repeat(40),
    ...overrides,
  };
  return renderParallelReport(result, {
    repositoryRoot: "/work/repo",
    baseRef: "HEAD",
  }).join("\n");
}

describe("renderParallelReport", () => {
  it("shows where the run started and where its result sits", () => {
    const text = report();

    expect(text).toContain("  repository        /work/repo");
    expect(text).toContain("  base              cccccccc (HEAD)");
    expect(text).toContain("  integration       swarm/run1/integration");
  });

  it("shows each worker with what it did and what it said it would touch", () => {
    const text = report();

    expect(text).toMatch(/worker-1\s+green\s+add a shout to alpha/);
    expect(text).toContain("src/alpha.js");
  });

  it("shows a worker whose own gates went red, and why", () => {
    const text = report({
      workers: [worker({ green: false, commit: null, detail: "blocking gate(s) failed: tests" })],
      queue: null,
    });

    expect(text).toMatch(/worker-1\s+red\s+/);
    expect(text).toContain("blocking gate(s) failed: tests");
  });

  it("shows the queue in the order it tried them", () => {
    const text = report({
      workers: [worker(), worker({ workerId: "worker-2" })],
      queue: {
        baseCommit: "c".repeat(40),
        headCommit: "b".repeat(40),
        baseCycle: null as never,
        landings: [
          landing(),
          landing({ workerId: "worker-2", landed: false, reason: "merge-conflict", commit: null }),
        ],
      },
    });

    expect(text).toMatch(/1\s+landed\s+worker-1/);
    expect(text).toMatch(/2\s+rejected\s+worker-2\s+merge-conflict/);
  });

  it("prints what a rejected worker was handed, under that worker's name", () => {
    const text = report({
      queue: {
        baseCommit: "c".repeat(40),
        headCommit: "c".repeat(40),
        baseCycle: null as never,
        landings: [
          landing({
            landed: false,
            reason: "merge-conflict",
            commit: null,
            feedback:
              "Conflicting file(s): src/alpha.js\nRedo the work against the integration branch.",
          }),
        ],
      },
    });

    expect(text).toContain("returned to worker-1");
    expect(text).toContain("Conflicting file(s): src/alpha.js");
  });

  it("says the branch the user is on was not touched, and how to take the result", () => {
    const text = report();

    expect(text).toMatch(/nothing was merged into the branch you are on/);
    expect(text).toContain("git merge swarm/run1/integration");
  });

  it("says plainly when nothing reached the queue at all", () => {
    const text = report({
      workers: [worker({ green: false, commit: null })],
      queue: null,
      headCommit: "c".repeat(40),
    });

    expect(text).toMatch(/no worker produced anything for the queue/);
    expect(text).not.toContain("git merge");
  });
});
