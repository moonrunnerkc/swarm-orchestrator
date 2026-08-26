import { describe, expect, it } from "vitest";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { emptyMeasureSnapshot } from "../gates/measure-snapshot.ts";
import type { AttemptSelection } from "./attempt-selector.ts";
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
    sweptBranches: [],
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

describe("the report of a run that tried each task several ways", () => {
  function selection(overrides: Partial<AttemptSelection> = {}): AttemptSelection {
    return {
      taskId: "task-1",
      baseCommit: "b".repeat(40),
      attempts: [],
      order: ["worker-2", "worker-1"],
      winner: "worker-2",
      decidedBy: "assertions",
      abstentions: [],
      ...overrides,
    };
  }

  it("says nothing about selections when each task was tried once", () => {
    expect(report({ selections: [] })).not.toMatch(/chosen|ranked/i);
  });

  it("says which attempt each task chose and on what", () => {
    const rendered = report({ selections: [selection()] });

    expect(rendered).toContain("task-1");
    expect(rendered).toContain("worker-2");
    expect(rendered).toContain("assertions");
  });

  it("says a task chose nothing rather than leaving the line blank", () => {
    const rendered = report({
      selections: [selection({ winner: null, decidedBy: null, order: [] })],
    });

    expect(rendered).toMatch(/nothing/i);
  });

  it("names a dimension nothing measured, so an abstention is not silent", () => {
    const rendered = report({
      selections: [
        selection({
          abstentions: [{ dimension: "changedLinesCovered", reason: "no attempt measured it" }],
        }),
      ],
    });

    expect(rendered).toContain("changedLinesCovered");
    expect(rendered).toMatch(/not measured|no attempt measured/i);
  });
});

describe("what the report says about the branches a run leaves", () => {
  it("says which worker branches it removed", () => {
    const rendered = report({ sweptBranches: ["swarm/run1/worker-1", "swarm/run1/worker-2"] });

    expect(rendered).toMatch(/removed 2 worker branch/i);
  });

  it("says nothing about sweeping when there was nothing to sweep", () => {
    expect(report({ sweptBranches: [] })).not.toMatch(/removed .* branch/i);
  });

  it("still points at the integration branch, which is never swept", () => {
    const rendered = report({ sweptBranches: ["swarm/run1/worker-1"] });

    expect(rendered).toContain("git merge");
  });
});
