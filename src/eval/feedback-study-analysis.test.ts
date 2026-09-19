import { describe, expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import {
  type ArmRecord,
  armOrder,
  type PrefixRecord,
  runArm,
  runPrefix,
  type StudyArm,
  type StudyEffects,
  treatmentDigest,
} from "./feedback-study.ts";
import {
  type ArmRow,
  assertOneStudyAcquisition,
  fewestDiscordantForAClaim,
  type HiddenScoreRow,
  type LaunchRow,
  MixedStudyIdentities,
  type ModelIdentity,
  type PrefixRow,
  patchesToScore,
  type StudyIdentity,
  type StudyManifest,
  summarizeStudy,
  unitSchedules,
  unsettledUnits,
} from "./feedback-study-analysis.ts";
import { addedLineText, patchFiles, patchMetrics } from "./patch-metrics.ts";
import type { HalfVerdict } from "./pr-task-judge.ts";

const identity: StudyIdentity = {
  study: "feedback-intervention",
  generation: 1,
  protocolDigest: digestOfBytes("protocol"),
  manifestDigest: digestOfBytes("manifest"),
  acquisitionDigest: digestOfBytes("acquisition"),
  scoringDigest: digestOfBytes("scoring"),
  policyDigest: digestOfBytes("policy"),
  harness: "a".repeat(40),
};
const qwen: ModelIdentity = { id: "local:qwen", digest: digestOfBytes("qwen") };
const glm: ModelIdentity = { id: "local:glm", digest: digestOfBytes("glm") };
const panel = [qwen, glm];

const taskIds = ["a/one#1", "b/two#2", "c/three#3"];
const manifest: StudyManifest = {
  schema: "swarm.feedback-study.manifest.v1",
  cohort: "mined-pr-test-3",
  source: { path: "campaign/pr-tasks/viable.json", digest: digestOfBytes("viable") },
  selection: {
    rule: "all viable, capped",
    repositoryCapShare: 0.1,
    historical: { path: "x", digest: digestOfBytes("x"), tasks: 0 },
    viable: 3,
    setAsideByCap: [],
    repositoriesOverCap: [],
  },
  tasks: taskIds.map((id, at) => ({
    id,
    repository: id.split("#")[0] ?? "",
    pull: at + 1,
    baseCommit: "b".repeat(40),
    mergeCommit: "c".repeat(40),
    testFile: "test/x.test.js",
    runner: "node --test test/x.test.js",
    taskTextDigest: digestOfBytes(id),
    visibleCases: ["v"],
    heldBackCases: ["h"],
    oracleFileDigest: digestOfBytes("oracle"),
    sourceRecordDigest: digestOfBytes(`record ${id}`),
  })),
};

const patchOf = (lines: readonly string[]) =>
  [
    "diff --git a/lib/x.js b/lib/x.js",
    "--- a/lib/x.js",
    "+++ b/lib/x.js",
    `@@ -1,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");

const accepted: HalfVerdict = {
  regression: "pass",
  task: "accepted",
  oracleReach: "reached",
  oracleBond: "held",
  bondedMutants: [],
};
const unreached = (line: number): HalfVerdict => ({
  ...accepted,
  oracleReach: "unreached",
  unreachedByOracle: [{ path: "lib/x.js", lines: [line] }],
});
const rejected: HalfVerdict = {
  regression: "pass",
  task: "rejected",
  oracleReach: "unmeasured",
  oracleBond: "not-bonded",
};

function world(script: readonly { patch: string; verdict: HalfVerdict }[]): StudyEffects {
  let at = -1;
  return {
    invokeAgent: async () => {
      at += 1;
      return {
        exitCode: 0,
        wallMs: 60_000,
        timedOut: false,
        runId: `run-${at}`,
        ledgerDigest: digestOfBytes(`ledger ${at}`),
        ledgerRecords: 10,
        usage: {
          modelCalls: 5,
          failedCalls: 0,
          inputTokens: 1000,
          outputTokens: 100,
          status: "reported",
        },
        stopReason: "completed",
        blinding: { checked: true, references: [] },
      };
    },
    snapshot: async () => {
      const patch = script[at]?.patch ?? "";
      return {
        digest: digestOfBytes(patch),
        metrics: patchMetrics(patch),
        files: patchFiles(patch),
        lineText: (path, line) => addedLineText(patch, path, line),
      };
    },
    judgeVisible: async () => script[at]?.verdict ?? rejected,
    endpointGenerates: async () => ({ generates: true, failure: null, detail: "" }),
    realAgent: true,
    now: () => 0,
  };
}

const forkPatch = patchOf(["open();", "fallback();"]);

async function prefixOf(model: ModelIdentity, taskId: string): Promise<PrefixRecord> {
  return runPrefix({
    task: { id: taskId, taskText: `do ${taskId}` },
    prefixInvocations: 2,
    effects: world([{ patch: forkPatch, verdict: unreached(2) }]),
    heldBackAvailable: true,
    treeDigest: async () => "tree",
    order: (arms) => armOrder(model.id, taskId, arms),
  });
}

async function armOf(
  arm: StudyArm,
  script: readonly { patch: string; verdict: HalfVerdict }[],
  prefix: PrefixRecord,
): Promise<ArmRecord> {
  const step = prefix.steps[prefix.frozen?.step ?? 0];
  if (step === undefined) throw new Error("no fork");
  return runArm({
    task: { id: "t", taskText: "t" },
    arm,
    policy: "feedback-study-v1",
    repairInvocations: 2,
    fork: {
      patchDigest: step.patch.digest,
      files: step.patch.files,
      observation: { kind: "judged", verdict: accepted },
      signals: step.signals,
    },
    effects: world(script),
  });
}

const base = (model: ModelIdentity, taskId: string) => ({ ...identity, model, taskId });

async function rowsFor(
  model: ModelIdentity,
  taskId: string,
  outcomes: Record<"neutral" | "reach" | "combined", string>,
) {
  const prefix = await prefixOf(model, taskId);
  const prefixRow: PrefixRow = {
    ...base(model, taskId),
    schema: "swarm.feedback-study.prefix.v1",
    attempt: 1,
    startedAt: "t",
    wallMs: 1,
    prefix,
  };
  const arms: ArmRow[] = [];
  for (const arm of prefix.eligibility.arms) {
    const patch = outcomes[arm as "neutral" | "reach" | "combined"];
    const record = await armOf(
      arm,
      [
        { patch, verdict: patch === forkPatch ? unreached(2) : accepted },
        { patch, verdict: patch === forkPatch ? unreached(2) : accepted },
      ],
      prefix,
    );
    arms.push({
      ...base(model, taskId),
      schema: "swarm.feedback-study.arm.v1",
      arm,
      treatmentDigest: treatmentDigest("feedback-study-v1", arm),
      attempt: 1,
      prefixAttempt: 1,
      fork: {
        patchDigest: prefix.frozen?.patchDigest ?? "",
        treeDigest: "tree",
        verified: { patchDigest: prefix.frozen?.patchDigest ?? "", treeDigest: "tree" },
      },
      startedAt: "t",
      wallMs: 1,
      record,
    });
  }
  return { prefixRow, arms };
}

const score = (
  model: ModelIdentity,
  taskId: string,
  patch: string,
  hidden: "pass" | "fail" | "unjudgeable",
): HiddenScoreRow => ({
  ...base(model, taskId),
  schema: "swarm.feedback-study.hidden-score.v1",
  patchDigest: digestOfBytes(patch),
  hidden,
  basis: "the held-back half's own verdict on this patch",
  heldBackVerdict: hidden === "pass" ? "accepted" : hidden === "fail" ? "rejected" : "unjudged",
  orderDependent: false,
  heldBackBond: null,
  judgeWallMs: 30_000,
});

describe("rows of one acquisition, and nothing else", () => {
  const row = { ...base(qwen, "a/one#1"), schema: "swarm.feedback-study.launch.v1" };

  it("accepts rows of the registered identity and panel", () => {
    expect(() =>
      assertOneStudyAcquisition(identity, panel, [row, { ...row, model: glm }]),
    ).not.toThrow();
  });

  it("refuses another generation, another protocol, a re-weighted model and a row of another study", () => {
    for (const foreign of [
      { ...row, generation: 2 },
      { ...row, protocolDigest: digestOfBytes("edited") },
      { ...row, model: { id: qwen.id, digest: digestOfBytes("other weights") } },
      { ...row, model: { id: "local:unregistered", digest: qwen.digest } },
      {
        generation: 3,
        protocolDigest: identity.protocolDigest,
        taskId: "a/one#1",
        schema: "swarm.reach-pressure.result.v1",
      },
    ]) {
      expect(() => assertOneStudyAcquisition(identity, panel, [row, foreign])).toThrow(
        MixedStudyIdentities,
      );
    }
  });
});

describe("what runs next, from the rows alone", () => {
  const launch = (
    unit: LaunchRow["unit"],
    attempt: number,
    prefixAttempt: number | null,
  ): LaunchRow => ({
    ...base(qwen, "a/one#1"),
    schema: "swarm.feedback-study.launch.v1",
    unit,
    attempt,
    prefixAttempt,
    startedAt: `t${attempt}`,
  });

  it("dispatches the prefix first, then each arm the prefix earned in its recorded order", async () => {
    expect(
      unitSchedules({
        model: qwen.id,
        taskId: "a/one#1",
        launches: [],
        prefixes: [],
        arms: [],
        attemptsPerUnit: 3,
      }),
    ).toEqual([
      { action: "dispatch", attempt: 1, closeDangling: null, unit: "prefix", prefixAttempt: null },
    ]);
    const { prefixRow, arms } = await rowsFor(qwen, "a/one#1", {
      neutral: forkPatch,
      reach: forkPatch,
      combined: forkPatch,
    });
    const order = prefixRow.prefix.eligibility.arms;
    const schedules = unitSchedules({
      model: qwen.id,
      taskId: "a/one#1",
      launches: [launch("prefix", 1, null)],
      prefixes: [prefixRow],
      arms: [],
      attemptsPerUnit: 3,
    });
    expect(schedules.map((one) => [one.unit, one.action])).toEqual([
      ["prefix", "settled"],
      [order[0], "dispatch"],
    ]);
    const settledAll = unitSchedules({
      model: qwen.id,
      taskId: "a/one#1",
      launches: [launch("prefix", 1, null), ...order.map((arm) => launch(arm, 1, 1))],
      prefixes: [prefixRow],
      arms,
      attemptsPerUnit: 3,
    });
    expect(settledAll.every((one) => one.action === "settled")).toBe(true);
    expect(settledAll.map((one) => one.unit)).toEqual(["prefix", ...order]);
  });

  it("closes an arm launch that never settled as an infrastructure failure and runs it again", async () => {
    const { prefixRow } = await rowsFor(qwen, "a/one#1", {
      neutral: forkPatch,
      reach: forkPatch,
      combined: forkPatch,
    });
    const first = prefixRow.prefix.eligibility.arms[0] as StudyArm;
    const schedules = unitSchedules({
      model: qwen.id,
      taskId: "a/one#1",
      launches: [launch("prefix", 1, null), launch(first, 1, 1)],
      prefixes: [prefixRow],
      arms: [],
      attemptsPerUnit: 3,
    });
    expect(schedules.at(-1)).toMatchObject({
      unit: first,
      action: "dispatch",
      attempt: 2,
      closeDangling: { attempt: 1 },
    });
  });

  it("holds scoring until every unit of every registered model has settled", async () => {
    const { prefixRow } = await rowsFor(qwen, "a/one#1", {
      neutral: forkPatch,
      reach: forkPatch,
      combined: forkPatch,
    });
    const open = unsettledUnits({
      panel: [qwen],
      taskIds: ["a/one#1"],
      launches: [launch("prefix", 1, null)],
      prefixes: [prefixRow],
      arms: [],
      attemptsPerUnit: 3,
    });
    expect(open).toEqual([`${qwen.id} a/one#1 ${prefixRow.prefix.eligibility.arms[0]}`]);
  });

  it("scores the accepted prefix and every arm's final patch, each once", async () => {
    const { prefixRow, arms } = await rowsFor(qwen, "a/one#1", {
      neutral: forkPatch,
      reach: patchOf(["open();", "x();"]),
      combined: patchOf(["open();", "x();"]),
    });
    expect(patchesToScore(prefixRow, arms)).toEqual([
      digestOfBytes(forkPatch),
      digestOfBytes(patchOf(["open();", "x();"])),
    ]);
  });
});

describe("the summary", () => {
  const helped = patchOf(["open();", "fixed();"]);
  const proxy = patchOf(["open();", "narrowed();"]);

  async function dataset() {
    const prefixes: PrefixRow[] = [];
    const arms: ArmRow[] = [];
    const hiddenScores: HiddenScoreRow[] = [];
    for (const model of panel) {
      for (const taskId of taskIds) {
        // Neutral leaves the patch alone; reach repairs one task for real and narrows another into
        // a patch the verifier clears and the held-back half refuses.
        const reach = taskId === "a/one#1" ? helped : taskId === "b/two#2" ? proxy : forkPatch;
        const rows = await rowsFor(model, taskId, { neutral: forkPatch, reach, combined: reach });
        prefixes.push(rows.prefixRow);
        arms.push(...rows.arms);
        hiddenScores.push(score(model, taskId, forkPatch, "fail"));
        if (reach !== forkPatch)
          hiddenScores.push(score(model, taskId, reach, reach === helped ? "pass" : "fail"));
      }
    }
    return { prefixes, arms, hiddenScores };
  }

  it("compares each treatment with neutral review on its own pairs, per model, with the family adjusted", async () => {
    const data = await dataset();
    const { summary } = summarizeStudy({
      manifest,
      identity,
      panel,
      launches: [],
      ...data,
      options: { bootstrap: { resamples: 500, seed: 3 } },
    });
    const primary = (
      summary.byModel[qwen.id] as {
        primary: Record<string, { cells: unknown; onlySecondIds: string[]; pairs: number }>;
      }
    ).primary;
    expect(primary.reach?.pairs).toBe(3);
    expect(primary.reach?.cells).toEqual({ bothPass: 0, onlyFirst: 0, onlySecond: 1, bothFail: 2 });
    expect(primary.reach?.onlySecondIds).toEqual(["a/one#1"]);
    expect(primary.mutation?.pairs).toBe(0);
    expect(summary.primaryFamily.tests).toBe(6);
    expect(summary.primaryFamily.family.every((entry) => entry.reading === "insufficient")).toBe(
      true,
    );
    expect(summary.pooled.byTreatment.reach).toMatchObject({
      computed: true,
      models: [glm.id, qwen.id],
    });
    expect(summary.pooled.byTreatment.mutation).toMatchObject({ computed: false });
  });

  it("counts a finding the verifier cleared on a patch the held-back half refuses as proxy-only", async () => {
    const data = await dataset();
    const { summary, classifications } = summarizeStudy({
      manifest,
      identity,
      panel,
      launches: [],
      ...data,
      options: { bootstrap: { resamples: 200, seed: 3 } },
    });
    const reach = (
      summary.byModel[qwen.id] as { mechanism: Record<string, Record<string, unknown>> }
    ).mechanism.reach;
    expect(reach).toMatchObject({
      ran: 3,
      signalCleared: 2,
      proxyOnlySuccess: 1,
      proxyOnlyTasks: ["b/two#2"],
      helpfulHiddenTransitions: 1,
      harmfulHiddenTransitions: 0,
    });
    expect(reach?.byTerminal).toEqual({
      "repair-exhausted-no-change": 1,
      "repaired-signal-cleared": 2,
    });
    const neutral = (
      summary.byModel[qwen.id] as { mechanism: Record<string, Record<string, unknown>> }
    ).mechanism.neutral;
    expect(neutral).toMatchObject({
      patchChanged: 0,
      signalCleared: 0,
      helpfulHiddenTransitions: 0,
    });
    const row = classifications.rows.find(
      (one) => one.model === qwen.id && one.taskId === "b/two#2" && one.arm === "reach",
    );
    expect(row).toMatchObject({
      terminal: "repaired-signal-cleared",
      signalCleared: true,
      proxyOnly: true,
      hidden: { prefix: "fail", arm: "fail" },
    });
  });

  it("names every pair it could not compare, with the reason", async () => {
    const data = await dataset();
    const withoutOne = data.hiddenScores.filter(
      (row) =>
        !(
          row.model.id === qwen.id &&
          row.taskId === "a/one#1" &&
          row.patchDigest === digestOfBytes(helped)
        ),
    );
    withoutOne.push(score(qwen, "a/one#1", helped, "unjudgeable"));
    const { summary } = summarizeStudy({
      manifest,
      identity,
      panel,
      launches: [],
      ...data,
      hiddenScores: withoutOne,
      options: { bootstrap: { resamples: 100, seed: 1 } },
    });
    const primary = (
      summary.byModel[qwen.id] as {
        primary: Record<string, { pairs: number; excluded: unknown[] }>;
      }
    ).primary;
    expect(primary.reach?.pairs).toBe(2);
    expect(primary.reach?.excluded).toEqual([
      { taskId: "a/one#1", reason: "reach patch is unjudgeable by the held-back half" },
    ]);
  });

  it("is the same bytes every time it is derived", async () => {
    const data = await dataset();
    const derive = () =>
      JSON.stringify(
        summarizeStudy({
          manifest,
          identity,
          panel,
          launches: [],
          ...data,
          options: { bootstrap: { resamples: 300, seed: 9 } },
        }),
      );
    expect(derive()).toBe(derive());
  });

  it("needs eight discordant pairs, all one way, before six Holm-adjusted tests can support a claim", () => {
    expect(fewestDiscordantForAClaim(1)).toBe(6);
    expect(fewestDiscordantForAClaim(6)).toBe(8);
  });
});
