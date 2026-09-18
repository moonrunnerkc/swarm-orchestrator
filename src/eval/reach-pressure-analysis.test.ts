import { describe, expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { patchMetrics } from "./patch-metrics.ts";
import type { HalfVerdict } from "./pr-task-judge.ts";
import { emptyPatchDigest, runTrajectory, type Trajectory } from "./reach-pressure.ts";
import {
  type ExperimentIdentity,
  type HiddenScore,
  hiddenOutcome,
  type Manifest,
  MixedProtocolGenerations,
  manifestSchema,
  patchesToScore,
  populationReading,
  type ResultRow,
  scoreOfAnEmptyPatch,
  summarize,
} from "./reach-pressure-analysis.ts";
import { renderReport } from "./reach-pressure-report.ts";

const digest = digestOfBytes;
const identity: ExperimentIdentity = {
  generation: 1,
  protocolDigest: digest("protocol"),
  manifestDigest: digest("manifest"),
  driverDigest: digest("driver"),
  policyDigest: digest("policy"),
  harness: "a".repeat(40),
};

const ids = ["lib/a#1", "lib/a#2", "lib/b#3", "lib/b#4", "lib/c#5"];
const manifest: Manifest = manifestSchema.parse({
  schema: "swarm.reach-pressure.manifest.v1",
  cohort: "test-cohort",
  source: { path: "viable.json", digest: digest("source") },
  tasks: ids.map((id, at) => ({
    id,
    repository: id.split("#")[0],
    pull: at + 1,
    baseCommit: "b".repeat(40),
    mergeCommit: "c".repeat(40),
    testFile: "test/x.test.js",
    runner: "node --test test/x.test.js",
    taskTextDigest: digest(`text ${id}`),
    visibleCases: ["does the thing"],
    heldBackCases: ["does the other thing", "and a third"],
    oracleFileDigest: digest(`oracle ${id}`),
    sourceRecordDigest: digest(`record ${id}`),
  })),
});

const accepted: HalfVerdict = {
  regression: "pass",
  task: "accepted",
  oracleReach: "reached",
  oracleBond: "held",
};
const rejected: HalfVerdict = { regression: "pass", task: "rejected" };
const unreached: HalfVerdict = {
  ...accepted,
  oracleReach: "unreached",
  unreachedByOracle: [{ path: "lib/x.js", lines: [4] }],
  oracleBond: "vacuous",
};

const wide =
  "diff --git a/lib/x.js b/lib/x.js\n--- a/lib/x.js\n+++ b/lib/x.js\n@@ -1,1 +1,4 @@\n-return value;\n+if (value < low) return low;\n+if (value > high) return high;\n+return value;\n";
const narrow =
  "diff --git a/lib/x.js b/lib/x.js\n--- a/lib/x.js\n+++ b/lib/x.js\n@@ -1,1 +1,3 @@\n-return value;\n+if (value < low) return low;\n+return value;\n";

async function trajectoryOf(
  script: readonly { patch: string; verdict?: HalfVerdict }[],
  alive = true,
): Promise<Trajectory> {
  let at = -1;
  return runTrajectory({
    task: { id: "any", taskText: "do the thing" },
    limits: { prefixInvocations: 2, reachRepairInvocations: 2 },
    effects: {
      invokeAgent: async () => {
        at += 1;
        return {
          exitCode: 0,
          wallMs: 60_000,
          timedOut: false,
          runId: `run-${at}`,
          ledgerDigest: digest(`ledger ${at}`),
          ledgerRecords: 9,
          usage:
            at === 0
              ? {
                  modelCalls: 4,
                  failedCalls: 0,
                  inputTokens: 1_000,
                  outputTokens: 100,
                  status: "reported",
                }
              : {
                  modelCalls: 2,
                  failedCalls: 0,
                  inputTokens: null,
                  outputTokens: null,
                  status: "unknown",
                },
        };
      },
      snapshot: async () => {
        const patch = script[at]?.patch ?? "";
        return { digest: digest(patch), metrics: patchMetrics(patch) };
      },
      judgeVisible: async () => script[at]?.verdict ?? rejected,
      endpointAnswers: async () => ({ answered: alive, detail: alive ? "" : "connection refused" }),
      now: () => 0,
    },
  });
}

const row = (taskId: string, trajectory: Trajectory, attempt = 1): ResultRow => ({
  ...identity,
  schema: "swarm.reach-pressure.result.v1",
  taskId,
  attempt,
  startedAt: "2026-09-17T00:00:00.000Z",
  wallMs: 1,
  trajectory,
});
const score = (taskId: string, patch: string, hidden: HiddenScore["hidden"]): HiddenScore => ({
  ...identity,
  schema: "swarm.reach-pressure.hidden-score.v1",
  taskId,
  patchDigest: digest(patch),
  hidden,
  basis: hidden === "unjudgeable" ? "swarm ci was killed at its deadline" : "the held-back verdict",
  heldBackVerdict: hidden === "pass" ? "accepted" : hidden === "fail" ? "rejected" : "unjudged",
  orderDependent: false,
  heldBackBond: null,
});

describe("visible acceptance, a reach refusal, a repair, and both patches scored on their own", () => {
  it("lands the pair in the harm cell when the repair narrows away what the held-back half tests", async () => {
    const repaired = await trajectoryOf([
      { patch: wide, verdict: unreached },
      { patch: narrow, verdict: accepted },
    ]);
    expect(patchesToScore(repaired)).toEqual([digest(wide), digest(narrow)]);

    const summary = summarize({
      manifest,
      identity,
      results: [row("lib/a#1", repaired)],
      hiddenScores: [score("lib/a#1", wide, "pass"), score("lib/a#1", narrow, "fail")],
    });

    expect(summary.primary.cells).toEqual({ passPass: 0, failPass: 0, passFail: 1, failFail: 0 });
    expect(summary.primary.harm).toEqual(["lib/a#1"]);
    expect(summary.primary.help).toEqual([]);
    expect(summary.triggered).toHaveLength(1);
    expect(summary.triggered[0]).toMatchObject({
      taskId: "lib/a#1",
      patchChanged: true,
      delta: { executableAddedLines: -1 },
      hidden: { control: "pass", reach: "fail" },
      // The bond is carried for both patches and decided nothing on the way.
      bond: { control: "vacuous", reach: "held" },
    });
  });
});

describe("the whole cohort, every task accounted for", () => {
  it("counts each cell, keeps every task on the books, and names what it left out", async () => {
    const harm = await trajectoryOf([
      { patch: wide, verdict: unreached },
      { patch: narrow, verdict: accepted },
    ]);
    const same = await trajectoryOf([{ patch: "p2", verdict: accepted }]);
    const never = await trajectoryOf([{ patch: "" }, { patch: "p3", verdict: rejected }]);
    const dead = await trajectoryOf([{ patch: "" }], false);
    const wrote = await trajectoryOf([{ patch: "p4", verdict: accepted }]);

    const summary = summarize({
      manifest,
      identity,
      results: [
        row("lib/a#1", harm),
        row("lib/a#2", same),
        row("lib/b#3", never),
        // An interrupted attempt stays recorded, and the attempt after it is the outcome.
        row("lib/b#4", dead, 1),
        row("lib/b#4", wrote, 2),
      ],
      hiddenScores: [
        score("lib/a#1", wide, "pass"),
        score("lib/a#1", narrow, "fail"),
        score("lib/a#2", "p2", "pass"),
        score("lib/b#3", "p3", "fail"),
        score("lib/b#4", "p4", "unjudgeable"),
      ],
    });

    expect(summary.accounting).toMatchObject({
      frozenTasks: 5,
      settledTasks: 4,
      interruptedAttempts: 1,
      judgeablePairs: 3,
      visibleAccepted: 3,
      reachTriggered: 1,
      reachRepaired: 1,
      byStatus: {
        "never-visible-accepted": 1,
        "not-run": 1,
        "reach-not-triggered": 2,
        "reach-repaired": 1,
      },
    });
    expect(summary.primary.cells).toEqual({ passPass: 1, failPass: 0, passFail: 1, failFail: 1 });
    expect(summary.primary.mcnemar).toMatchObject({ onlyFirst: 1, onlySecond: 0, pValue: 1 });
    expect(summary.primary.difference.point).toBeCloseTo(-1 / 3, 10);
    expect(summary.populationReading).toBe("insufficient");
    expect(summary.subsets.reachTriggered.pairs).toBe(1);
    expect(summary.excluded).toEqual([
      {
        taskId: "lib/b#4",
        reason:
          "control patch unjudgeable by the held-back oracle: swarm ci was killed at its deadline; " +
          "reach patch unjudgeable by the held-back oracle: swarm ci was killed at its deadline",
      },
      { taskId: "lib/c#5", reason: "not-run: no row was recorded for this task" },
    ]);
    // Usage that one invocation did not report is unknown for the phase, never a smaller number.
    expect(summary.secondary.overhead).toMatchObject({
      triggeredTasks: 1,
      prefix: { invocations: 1, inputTokens: 1_000, modelCalls: 4 },
      reachRepair: { invocations: 1, inputTokens: null, outputTokens: null, modelCalls: 2 },
    });
  });

  it("leaves an infrastructure failure out of the denominator by name, as neither pass nor fail", async () => {
    const dead = await trajectoryOf([{ patch: "" }], false);

    const summary = summarize({
      manifest,
      identity,
      results: [row("lib/a#1", dead)],
      hiddenScores: [],
    });

    expect(summary.primary.pairs).toBe(0);
    expect(summary.excluded[0]).toEqual({
      taskId: "lib/a#1",
      reason: "infrastructure-failure: the model endpoint stopped answering: connection refused",
    });
  });

  it("scores a live model's empty patch as that model's failure, without a judge", async () => {
    const nothing = await trajectoryOf([{ patch: "" }, { patch: "" }]);
    expect(nothing.status).toBe("never-visible-accepted");
    expect(patchesToScore(nothing)).toEqual([emptyPatchDigest]);

    const summary = summarize({
      manifest,
      identity,
      results: [row("lib/a#1", nothing)],
      hiddenScores: [
        {
          ...identity,
          schema: "swarm.reach-pressure.hidden-score.v1",
          taskId: "lib/a#1",
          ...scoreOfAnEmptyPatch(),
        },
      ],
    });

    expect(summary.primary.cells.failFail).toBe(1);
  });

  it("refuses rows written under another protocol identity", async () => {
    const same = await trajectoryOf([{ patch: "p2", verdict: accepted }]);
    const foreign = { ...row("lib/a#2", same), generation: 2, protocolDigest: digest("other") };

    expect(() =>
      summarize({
        manifest,
        identity,
        results: [row("lib/a#1", same), foreign],
        hiddenScores: [],
      }),
    ).toThrow(MixedProtocolGenerations);
  });

  it("refuses a row for a task the cohort never froze", async () => {
    const same = await trajectoryOf([{ patch: "p2", verdict: accepted }]);
    expect(() =>
      summarize({ manifest, identity, results: [row("lib/z#9", same)], hiddenScores: [] }),
    ).toThrow(/not in the frozen cohort/);
  });
});

describe("reading the table by a rule fixed beforehand", () => {
  const table = (harm: number, help: number) =>
    summarizeCells({ passPass: 10, failPass: help, passFail: harm, failFail: 10 });

  it("reads the same in both directions", () => {
    expect(populationReading(table(7, 0))).toBe("supports-harm");
    expect(populationReading(table(0, 7))).toBe("supports-help");
    expect(populationReading(table(3, 0))).toBe("insufficient");
    expect(populationReading(table(5, 4))).toBe("insufficient");
  });

  it("counts only a verdict about the patch as an outcome", () => {
    expect(hiddenOutcome("accepted")).toBe("pass");
    expect(hiddenOutcome("rejected")).toBe("fail");
    expect(hiddenOutcome("vacuous")).toBe("unjudgeable");
    expect(hiddenOutcome("unjudged")).toBe("unjudgeable");
  });
});

/** A primary table with the given cells, built through `summarize` so the rule reads real output. */
function summarizeCells(cells: {
  passPass: number;
  failPass: number;
  passFail: number;
  failFail: number;
}) {
  const tasks: { id: string; control: boolean; reach: boolean }[] = [];
  const add = (count: number, control: boolean, reach: boolean) => {
    for (let at = 0; at < count; at += 1) {
      tasks.push({ id: `lib/t#${String(tasks.length + 1).padStart(3, "0")}`, control, reach });
    }
  };
  add(cells.passPass, true, true);
  add(cells.failPass, false, true);
  add(cells.passFail, true, false);
  add(cells.failFail, false, false);
  const template = manifest.tasks[0];
  if (template === undefined) throw new Error("the fixture manifest is empty");
  const big: Manifest = {
    ...manifest,
    tasks: tasks.map((one, at) => ({ ...template, id: one.id, pull: at + 1 })),
  };
  const trajectory = (one: (typeof tasks)[number]): Trajectory => ({
    status: one.control === one.reach ? "reach-not-triggered" : "reach-repaired",
    detail: null,
    steps: [],
    visibleAcceptedAt: 0,
    control: { patchDigest: digest(`${one.id} control`), step: 0 },
    reach: {
      patchDigest: digest(`${one.id} ${one.control === one.reach ? "control" : "reach"}`),
      step: 0,
      triggered: one.control !== one.reach,
      repairs: one.control === one.reach ? 0 : 1,
      satisfied: true,
    },
  });
  return summarize({
    manifest: big,
    identity,
    results: tasks.map((one) => row(one.id, trajectory(one))),
    hiddenScores: tasks.flatMap((one) => [
      score(one.id, `${one.id} control`, one.control ? "pass" : "fail"),
      ...(one.control === one.reach
        ? []
        : [score(one.id, `${one.id} reach`, one.reach ? "pass" : "fail")]),
    ]),
  }).primary;
}

describe("the page is a function of the summary", () => {
  it("prints the 2x2 before any reading of it, and every discordant pair by name", async () => {
    const harm = await trajectoryOf([
      { patch: wide, verdict: unreached },
      { patch: narrow, verdict: accepted },
    ]);
    const summary = summarize({
      manifest,
      identity,
      results: [row("lib/a#1", harm)],
      hiddenScores: [score("lib/a#1", wide, "pass"), score("lib/a#1", narrow, "fail")],
    });
    const input = {
      summary,
      parameters: { model: "local:m", endpoint: "http://127.0.0.1:8000/v1" },
      environment: null,
      pairNotes: { "lib/a#1": "The repair deleted the `value > high` branch." },
      postscript: "## Written after the run\n\nNothing more.",
      digests: {
        driverAtAnalysis: identity.driverDigest,
        results: digest("r"),
        hiddenScores: digest("h"),
        summary: digest("s"),
      },
    };

    const page = renderReport(input);

    expect(page.indexOf("## Primary outcome")).toBeLessThan(page.indexOf("## Reading"));
    expect(page).toContain("| pass | fail | reach hurt | 1 | 100.0% |");
    expect(page).toContain("**lib/a#1**");
    expect(page).toContain("The repair deleted the `value > high` branch.");
    expect(page).toContain(`patches/${digest(narrow).slice(7)}.patch`);
    expect(page).toContain("mcnemar-exact-binomial-two-sided");
    expect(page).toContain("newcombe-paired-score-95");
    expect(page).toContain("## Limitations");
    expect(page.indexOf("## Written after the run")).toBeGreaterThan(
      page.indexOf("## Limitations"),
    );
    expect(page).not.toContain(String.fromCodePoint(0x2014));
    expect(renderReport(input)).toBe(page);
  });
});
