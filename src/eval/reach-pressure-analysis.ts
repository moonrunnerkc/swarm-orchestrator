import { z } from "zod";
import { digestPattern } from "../evidence/canonical-json.ts";
import { knownTotal } from "./known-total.ts";
import { metricsDelta, type PatchMetrics } from "./patch-metrics.ts";
import {
  blockingFindings,
  emptyPatchDigest,
  type Trajectory,
  type TrajectoryStep,
  trajectorySchema,
} from "./reach-pressure.ts";
import { type RepairProgress, type RepairRelation, repairProgress } from "./repair-progress.ts";
import {
  type ExactMcNemarResult,
  type Interval,
  mcNemarExact,
  pairedDifferenceInterval,
} from "./statistics.ts";

/**
 * The arithmetic of the reach-pressure experiment, over saved rows and nothing else.
 *
 * No model, judge or filesystem is reachable from here, so the summary a run printed and the
 * summary re-derived later from the committed rows are one function applied twice.
 */
export const manifestTaskSchema = z.object({
  id: z.string().min(1),
  repository: z.string().min(1),
  pull: z.number().int().positive(),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  mergeCommit: z.string().regex(/^[0-9a-f]{40}$/),
  testFile: z.string().min(1),
  runner: z.string().min(1),
  taskTextDigest: z.string().regex(digestPattern),
  /** Case titles are the case identities: they are what each half's title filter selects. */
  visibleCases: z.array(z.string()).min(1),
  heldBackCases: z.array(z.string()).min(1),
  /** The pull request's test file at the merge commit, which both halves are filters over. */
  oracleFileDigest: z.string().regex(digestPattern),
  /** The whole viability record this entry was frozen from. */
  sourceRecordDigest: z.string().regex(digestPattern),
});
export type ManifestTask = z.infer<typeof manifestTaskSchema>;

export const manifestSchema = z
  .object({
    schema: z.literal("swarm.reach-pressure.manifest.v1"),
    cohort: z.string().min(1),
    source: z.object({ path: z.string(), digest: z.string().regex(digestPattern) }),
    tasks: z.array(manifestTaskSchema).min(1),
  })
  .refine((value) => new Set(value.tasks.map((one) => one.id)).size === value.tasks.length, {
    message: "a frozen cohort names each task once",
  })
  .refine(
    (value) => value.tasks.every((one, at) => at === 0 || (value.tasks[at - 1]?.id ?? "") < one.id),
    { message: "a frozen cohort is ordered by task id" },
  );
export type Manifest = z.infer<typeof manifestSchema>;

const identitySchema = z.object({
  generation: z.number().int().positive(),
  protocolDigest: z.string().regex(digestPattern),
  manifestDigest: z.string().regex(digestPattern),
  driverDigest: z.string().regex(digestPattern),
  policyDigest: z.string().regex(digestPattern),
  harness: z.string().regex(/^[0-9a-f]{40}$/),
});
export type ExperimentIdentity = z.infer<typeof identitySchema>;

/**
 * A row read for its identity alone. Whose row it is has to be answerable before its contents are
 * parsed: generation 1's rows predate fields today's row schema requires, and a stray one should
 * be refused as another generation's and not as malformed.
 */
export const identifiedRowSchema = identitySchema.extend({ taskId: z.string().min(1) });
export type IdentifiedRow = z.infer<typeof identifiedRowSchema>;

export const resultRowSchema = identitySchema.extend({
  schema: z.literal("swarm.reach-pressure.result.v1"),
  taskId: z.string().min(1),
  /** 1 for the first time a task was scheduled; higher only after a recorded interruption. */
  attempt: z.number().int().positive(),
  startedAt: z.string(),
  wallMs: z.number().nonnegative(),
  trajectory: trajectorySchema,
});
export type ResultRow = z.infer<typeof resultRowSchema>;

export const hiddenScoreSchema = identitySchema.extend({
  schema: z.literal("swarm.reach-pressure.hidden-score.v1"),
  taskId: z.string().min(1),
  patchDigest: z.string().regex(digestPattern),
  hidden: z.enum(["pass", "fail", "unjudgeable"]),
  /** Which rule produced `hidden`, in words, so an unjudgeable row names its reason. */
  basis: z.string().min(1),
  heldBackVerdict: z.enum(["accepted", "rejected", "unjudged", "vacuous"]).nullable(),
  orderDependent: z.boolean(),
  heldBackBond: z.enum(["held", "vacuous", "unshown", "not-bonded"]).nullable(),
});
export type HiddenScore = z.infer<typeof hiddenScoreSchema>;

/** The held-back verdict as the primary outcome reads it. Only a verdict about the patch counts. */
export function hiddenOutcome(heldBackVerdict: string): HiddenScore["hidden"] {
  if (heldBackVerdict === "accepted") return "pass";
  if (heldBackVerdict === "rejected") return "fail";
  return "unjudgeable";
}

export interface PairedTableReport {
  readonly denominator: string;
  readonly pairs: number;
  readonly cells: {
    readonly passPass: number;
    readonly failPass: number;
    readonly passFail: number;
    readonly failFail: number;
  };
  readonly percentages: PairedTableReport["cells"];
  readonly help: readonly string[];
  readonly harm: readonly string[];
  readonly controlPassRate: number | null;
  readonly reachPassRate: number | null;
  readonly mcnemar: ExactMcNemarResult;
  /** Reach minus control. */
  readonly difference: Interval & { readonly pairs: number; readonly method: string };
}

interface Pair {
  readonly taskId: string;
  readonly control: boolean;
  readonly reach: boolean;
}

function pairedTable(denominator: string, pairs: readonly Pair[]): PairedTableReport {
  const count = (control: boolean, reach: boolean) =>
    pairs.filter((one) => one.control === control && one.reach === reach).length;
  const cells = {
    passPass: count(true, true),
    failPass: count(false, true),
    passFail: count(true, false),
    failFail: count(false, false),
  };
  const share = (value: number) => (pairs.length === 0 ? 0 : (100 * value) / pairs.length);
  return {
    denominator,
    pairs: pairs.length,
    cells,
    percentages: {
      passPass: share(cells.passPass),
      failPass: share(cells.failPass),
      passFail: share(cells.passFail),
      failFail: share(cells.failFail),
    },
    help: pairs.filter((one) => !one.control && one.reach).map((one) => one.taskId),
    harm: pairs.filter((one) => one.control && !one.reach).map((one) => one.taskId),
    controlPassRate: pairs.length === 0 ? null : (cells.passPass + cells.passFail) / pairs.length,
    reachPassRate: pairs.length === 0 ? null : (cells.passPass + cells.failPass) / pairs.length,
    // First is control, so `onlyFirst` is the harm count and `onlySecond` the help count.
    mcnemar: mcNemarExact({ onlyFirst: cells.passFail, onlySecond: cells.failPass }),
    difference: pairedDifferenceInterval({
      bothPass: cells.passPass,
      onlyFirst: cells.passFail,
      onlySecond: cells.failPass,
      bothFail: cells.failFail,
    }),
  };
}

/**
 * The predeclared reading of the primary table, as a rule rather than a judgement.
 *
 * A population claim in either direction needs the exact test past 5%. Anything else is
 * insufficient, however the discordant pairs happen to lean, and the pairs are listed either way.
 */
export function populationReading(
  table: PairedTableReport,
): "supports-harm" | "supports-help" | "insufficient" {
  if (table.mcnemar.pValue >= 0.05) return "insufficient";
  return table.cells.passFail > table.cells.failPass ? "supports-harm" : "supports-help";
}

/** Token counts of one invocation. A call that did not report makes the whole invocation unknown. */
function tokensOf(step: TrajectoryStep, field: "inputTokens" | "outputTokens"): number | null {
  const { usage } = step.invocation;
  return usage.status === "unknown" ? null : usage[field];
}

function totalsOf(steps: readonly TrajectoryStep[]) {
  const modelCalls = knownTotal(steps.map((step) => step.invocation.usage.modelCalls));
  const inputTokens = knownTotal(steps.map((step) => tokensOf(step, "inputTokens")));
  const outputTokens = knownTotal(steps.map((step) => tokensOf(step, "outputTokens")));
  return {
    invocations: steps.length,
    // Wall time is the driver's own clock around the invocation and the judge, so it is always known.
    agentWallMs: steps.reduce((total, step) => total + step.invocation.wallMs, 0),
    judgeWallMs: steps.reduce((total, step) => total + step.judgeWallMs, 0),
    modelCalls: modelCalls.total,
    inputTokens: inputTokens.total,
    outputTokens: outputTokens.total,
    accounting: {
      complete:
        modelCalls.unknownParts === 0 &&
        inputTokens.unknownParts === 0 &&
        outputTokens.unknownParts === 0,
      invocationsWithUnknownModelCalls: modelCalls.unknownParts,
      invocationsWithUnknownTokens: Math.max(inputTokens.unknownParts, outputTokens.unknownParts),
      knownSubtotals: {
        modelCalls: modelCalls.knownSubtotal,
        inputTokens: inputTokens.knownSubtotal,
        outputTokens: outputTokens.knownSubtotal,
      },
    },
  };
}

function phaseSteps(trajectory: Trajectory, phase: "prefix" | "reach-repair") {
  return trajectory.steps.filter((one) => one.phase === phase);
}

/**
 * What each repair invocation did to the findings before it.
 *
 * A row written since repairs were compared carries the record, made with the patch text in hand.
 * An earlier row does not, and the comparison is made here from what the row does hold: patch
 * digests and the verdict's line numbers. That is a re-derivation and is marked as one, with
 * findings named by line number because no text was kept, so a renumbered line reads as moved.
 */
export function repairProgressOf(
  trajectory: Trajectory,
): readonly (RepairProgress & { readonly step: number; readonly derivedAtAnalysis: boolean })[] {
  const progress: (RepairProgress & { step: number; derivedAtAnalysis: boolean })[] = [];
  let earlier: number | null = null;
  trajectory.steps.forEach((step, at) => {
    const infrastructure = step.attribution?.to === "infrastructure";
    if (step.repairProgress !== undefined) {
      progress.push({ ...step.repairProgress, step: at, derivedAtAnalysis: false });
    } else if (earlier !== null && !infrastructure) {
      const derived = progressBetween(trajectory, earlier, at);
      if (derived !== null) progress.push({ ...derived, step: at, derivedAtAnalysis: true });
    }
    if (!infrastructure) earlier = at;
  });
  return progress;
}

/** What the repair budget bought: the final observation against the one at the fork. */
export function repairOutcomeOf(
  trajectory: Trajectory,
): (RepairProgress & { readonly derivedAtAnalysis: boolean }) | null {
  if (trajectory.control === null || trajectory.reach === null || !trajectory.reach.triggered) {
    return null;
  }
  if (trajectory.reach.progress !== undefined) {
    return { ...trajectory.reach.progress, derivedAtAnalysis: false };
  }
  const derived = progressBetween(trajectory, trajectory.control.step, trajectory.reach.step);
  return derived === null ? null : { ...derived, derivedAtAnalysis: true };
}

function progressBetween(trajectory: Trajectory, from: number, to: number): RepairProgress | null {
  const before = trajectory.steps[from];
  const after = trajectory.steps[to];
  if (before === undefined || after === undefined) return null;
  const arm = after.phase === "reach-repair" ? "reach" : "control";
  const byNumber = (_path: string, line: number) => `L${line}`;
  return repairProgress({
    comparedWithStep: from,
    findingIdentity: "line-number",
    before: {
      patchDigest: before.patch.digest,
      findings: blockingFindings(arm, before.observation, byNumber),
      files: before.patch.files,
    },
    after: {
      patchDigest: after.patch.digest,
      findings: blockingFindings(arm, after.observation, byNumber),
      files: after.patch.files,
    },
  });
}

function visibleOf(trajectory: Trajectory, step: number) {
  const observation = trajectory.steps[step]?.observation;
  return observation?.kind === "judged" ? observation.verdict : null;
}

function metricsOf(trajectory: Trajectory, step: number): PatchMetrics | null {
  return trajectory.steps[step]?.patch.metrics ?? null;
}

export interface ReachPressureSummary {
  readonly schema: "swarm.reach-pressure.summary.v2";
  readonly identity: ExperimentIdentity;
  readonly cohort: {
    readonly name: string;
    readonly tasks: number;
    readonly byRepository: Readonly<Record<string, number>>;
    /** Tasks where either half is a single case, which is the thinnest an oracle gets. */
    readonly singleCaseHalf: number;
  };
  readonly accounting: Record<string, unknown>;
  readonly primary: PairedTableReport;
  readonly populationReading: ReturnType<typeof populationReading>;
  readonly subsets: {
    readonly visibleAccepted: PairedTableReport;
    readonly reachTriggered: PairedTableReport;
    readonly reachRepaired: PairedTableReport;
  };
  readonly secondary: Record<string, unknown>;
  readonly triggered: readonly Record<string, unknown>[];
  readonly excluded: readonly { readonly taskId: string; readonly reason: string }[];
}

export class MixedProtocolGenerations extends Error {
  constructor(found: readonly string[]) {
    super(
      `rows from more than one protocol identity cannot make one estimate: ${found.join(", ")}`,
    );
    this.name = "MixedProtocolGenerations";
  }
}

/**
 * Every row already in an evidence directory, held to the identity about to write beside it.
 *
 * `analyze` has always refused mixed rows. `run` and `score` did not look: a results file left in
 * place across a protocol change would have had its settled tasks skipped as settled and its
 * open ones continued under the new generation, and the mix would surface only at analysis, after
 * the cohort had been spent. Generations 1 and 2 were kept apart by moving files by hand.
 */
export function assertOneAcquisition(
  identity: ExperimentIdentity,
  rawRows: readonly unknown[],
): void {
  // Identity first and nothing else: an older generation's row need not parse as today's.
  const rows = rawRows.map((row) => identifiedRowSchema.parse(row));
  const keys = [
    "generation",
    "protocolDigest",
    "manifestDigest",
    "driverDigest",
    "policyDigest",
    "harness",
  ] as const;
  const foreign = rows.filter((row) => keys.some((key) => row[key] !== identity[key]));
  if (foreign.length === 0) return;
  throw new MixedProtocolGenerations([
    ...new Set(
      foreign.map(
        (row) =>
          `${row.taskId} generation ${row.generation} ${row.harness} (differs in ${keys
            .filter((key) => row[key] !== identity[key])
            .join(", ")})`,
      ),
    ),
  ]);
}

export function summarize(input: {
  readonly manifest: Manifest;
  readonly identity: ExperimentIdentity;
  readonly results: readonly ResultRow[];
  readonly hiddenScores: readonly HiddenScore[];
}): ReachPressureSummary {
  const { manifest, identity } = input;
  // The one identity rule, which `run` and `score` apply before they write and `analyze` applies
  // before it parses. Two copies of it is how the fresh pass and the re-judge once disagreed.
  assertOneAcquisition(identity, [...input.results, ...input.hiddenScores]);
  const known = new Set(manifest.tasks.map((one) => one.id));
  const stray = input.results.find((row) => !known.has(row.taskId));
  if (stray !== undefined) throw new Error(`${stray.taskId} is not in the frozen cohort`);

  const scoreOf = new Map(
    input.hiddenScores.map((one) => [`${one.taskId} ${one.patchDigest}`, one]),
  );
  const excluded: { taskId: string; reason: string }[] = [];
  const all: Pair[] = [];
  const good: Pair[] = [];
  const visibleAccepted: Pair[] = [];
  const reachTriggered: Pair[] = [];
  const reachRepaired: Pair[] = [];
  const triggered: Record<string, unknown>[] = [];
  const byStatus: Record<string, number> = {};
  let interruptedAttempts = 0;
  let reachMeasured = 0;
  let unknownUsageInvocations = 0;
  let invocations = 0;
  const bondStates: Record<"control" | "reach", Record<string, number>> = {
    control: {},
    reach: {},
  };
  const overheadSteps = { prefix: [] as TrajectoryStep[], reachRepair: [] as TrajectoryStep[] };
  let triggeredTasks = 0;
  const allSteps: TrajectoryStep[] = [];
  const relations: Partial<Record<RepairRelation, number>> = {};

  for (const task of manifest.tasks) {
    const attempts = input.results
      .filter((row) => row.taskId === task.id)
      .sort((left, right) => left.attempt - right.attempt);
    // The last attempt is the task's outcome. Earlier ones are interruptions, kept and counted.
    const settled = attempts.at(-1);
    interruptedAttempts += Math.max(0, attempts.length - 1);
    if (settled === undefined) {
      byStatus["not-run"] = (byStatus["not-run"] ?? 0) + 1;
      excluded.push({ taskId: task.id, reason: "not-run: no row was recorded for this task" });
      continue;
    }
    const { trajectory } = settled;
    byStatus[trajectory.status] = (byStatus[trajectory.status] ?? 0) + 1;
    for (const step of trajectory.steps) {
      invocations += 1;
      allSteps.push(step);
      if (step.invocation.usage.status === "unknown") unknownUsageInvocations += 1;
    }
    if (trajectory.control === null || trajectory.reach === null) {
      excluded.push({
        taskId: task.id,
        reason: `${trajectory.status}: ${trajectory.detail ?? "no reason recorded"}`,
      });
      continue;
    }
    const controlVisible = visibleOf(trajectory, trajectory.control.step);
    const reachVisible = visibleOf(trajectory, trajectory.reach.step);
    if (
      trajectory.visibleAcceptedAt !== null &&
      (controlVisible?.oracleReach === "reached" || controlVisible?.oracleReach === "unreached")
    ) {
      reachMeasured += 1;
    }

    const controlScore = scoreOf.get(`${task.id} ${trajectory.control.patchDigest}`);
    const reachScore = scoreOf.get(`${task.id} ${trajectory.reach.patchDigest}`);
    const unscored = [
      ["control", controlScore],
      ["reach", reachScore],
    ].flatMap(([arm, score]) =>
      score === undefined
        ? [`${arm} patch has no held-back score`]
        : (score as HiddenScore).hidden === "unjudgeable"
          ? [`${arm} patch unjudgeable by the held-back oracle: ${(score as HiddenScore).basis}`]
          : [],
    );
    if (trajectory.reach.triggered) {
      triggeredTasks += 1;
      overheadSteps.prefix.push(...phaseSteps(trajectory, "prefix"));
      overheadSteps.reachRepair.push(...phaseSteps(trajectory, "reach-repair"));
      const repairs = repairProgressOf(trajectory).filter(
        (one) => trajectory.steps[one.step]?.phase === "reach-repair",
      );
      const outcome = repairOutcomeOf(trajectory);
      if (outcome !== null) relations[outcome.relation] = (relations[outcome.relation] ?? 0) + 1;
      const before = metricsOf(trajectory, trajectory.control.step);
      const after = metricsOf(trajectory, trajectory.reach.step);
      triggered.push({
        taskId: task.id,
        status: trajectory.status,
        repairs: trajectory.reach.repairs,
        reachSatisfied: trajectory.reach.satisfied,
        unreachedAtFork: controlVisible?.unreachedByOracle ?? [],
        controlPatch: trajectory.control.patchDigest,
        reachPatch: trajectory.reach.patchDigest,
        patchChanged: trajectory.control.patchDigest !== trajectory.reach.patchDigest,
        controlMetrics: before,
        reachMetrics: after,
        delta: before === null || after === null ? null : metricsDelta(before, after),
        visible: {
          control: { task: controlVisible?.task, regression: controlVisible?.regression },
          reach: {
            task: reachVisible?.task ?? "no-change",
            regression: reachVisible?.regression ?? "no-change",
            oracleReach: reachVisible?.oracleReach ?? "unmeasured",
          },
        },
        bond: {
          control: controlVisible?.oracleBond ?? "not-bonded",
          reach: reachVisible?.oracleBond ?? "not-bonded",
        },
        hidden: { control: controlScore?.hidden ?? null, reach: reachScore?.hidden ?? null },
        overhead: totalsOf(phaseSteps(trajectory, "reach-repair")),
        repairProgress: repairs,
        repairOutcome: outcome,
        // What each repair session's own ledger said about the files it added. Empty for rows
        // written before sessions were read for it.
        repairScope: trajectory.steps.flatMap((step, at) =>
          step.phase === "reach-repair" && step.scope !== undefined
            ? [{ step: at, ...step.scope }]
            : [],
        ),
      });
    }
    if (trajectory.visibleAcceptedAt !== null) {
      for (const [arm, visible] of [
        ["control", controlVisible],
        ["reach", reachVisible],
      ] as const) {
        const state = visible?.oracleBond ?? "not-bonded";
        bondStates[arm][state] = (bondStates[arm][state] ?? 0) + 1;
      }
    }
    if (unscored.length > 0 || controlScore === undefined || reachScore === undefined) {
      excluded.push({ taskId: task.id, reason: unscored.join("; ") });
      continue;
    }
    const pair: Pair = {
      taskId: task.id,
      control: controlScore.hidden === "pass",
      reach: reachScore.hidden === "pass",
    };
    all.push(pair);
    good.push({
      taskId: task.id,
      control: pair.control && controlVisible?.regression === "pass",
      reach: pair.reach && reachVisible?.regression === "pass",
    });
    if (trajectory.visibleAcceptedAt !== null) visibleAccepted.push(pair);
    if (trajectory.reach.triggered) reachTriggered.push(pair);
    if (trajectory.status === "reach-repaired") reachRepaired.push(pair);
  }

  const settledRows = manifest.tasks.length - (byStatus["not-run"] ?? 0);
  const primary = pairedTable("judgeable tasks of the frozen cohort", all);
  const direction = (field: keyof PatchMetrics) => {
    const signs = { decreased: 0, unchanged: 0, increased: 0 };
    for (const one of triggered) {
      const delta = (one.delta as PatchMetrics | null)?.[field];
      if (delta === undefined) continue;
      signs[delta < 0 ? "decreased" : delta > 0 ? "increased" : "unchanged"] += 1;
    }
    return signs;
  };
  return {
    schema: "swarm.reach-pressure.summary.v2",
    identity,
    cohort: {
      name: manifest.cohort,
      tasks: manifest.tasks.length,
      byRepository: sorted(
        manifest.tasks.reduce<Record<string, number>>((counts, task) => {
          counts[task.repository] = (counts[task.repository] ?? 0) + 1;
          return counts;
        }, {}),
      ),
      singleCaseHalf: manifest.tasks.filter(
        (task) => task.visibleCases.length === 1 || task.heldBackCases.length === 1,
      ).length,
    },
    accounting: {
      frozenTasks: manifest.tasks.length,
      settledTasks: settledRows,
      byStatus: sorted(byStatus),
      interruptedAttempts,
      judgeablePairs: all.length,
      visibleAccepted: count(byStatus, [
        "reach-not-triggered",
        "reach-repaired",
        "reach-repair-exhausted",
      ]),
      reachMeasuredAtAcceptance: reachMeasured,
      reachTriggered: count(byStatus, ["reach-repaired", "reach-repair-exhausted"]),
      reachRepaired: byStatus["reach-repaired"] ?? 0,
      reachRepairExhausted: byStatus["reach-repair-exhausted"] ?? 0,
      agentInvocations: invocations,
      invocationsWithUnknownUsage: unknownUsageInvocations,
      usage: totalsOf(allSteps),
      // Null where a ledger predates the field: whether a call was cancelled was not recorded.
      invocationsEndedOnProviderFailure: knownTotal(
        allSteps.map((step) => {
          const ended = step.invocation.usage.endedOnProviderFailure;
          return ended === null || ended === undefined ? null : ended ? 1 : 0;
        }),
      ),
    },
    primary,
    populationReading: populationReading(primary),
    subsets: {
      visibleAccepted: pairedTable(
        "judgeable tasks that reached visible acceptance",
        visibleAccepted,
      ),
      reachTriggered: pairedTable("judgeable tasks where reach triggered", reachTriggered),
      reachRepaired: pairedTable(
        "judgeable tasks where reach triggered and the repair satisfied it",
        reachRepaired,
      ),
    },
    secondary: {
      heldBackPassAndRegressionPass: pairedTable(
        "judgeable tasks, a pass also requiring the repository's own checks to pass",
        good,
      ),
      repairDirection: {
        executableAddedLines: direction("executableAddedLines"),
        executableDeletedLines: direction("executableDeletedLines"),
        sourceFilesChanged: direction("sourceFilesChanged"),
        testAddedLines: direction("testAddedLines"),
        diffBytes: direction("diffBytes"),
      },
      bondAtVisibleAcceptedTasks: {
        control: sorted(bondStates.control),
        reach: sorted(bondStates.reach),
      },
      overhead: {
        triggeredTasks,
        prefix: totalsOf(overheadSteps.prefix),
        reachRepair: totalsOf(overheadSteps.reachRepair),
      },
      repairOutcomes: sorted(relations as Record<string, number>),
    },
    triggered,
    excluded,
  };
}

function count(byStatus: Record<string, number>, statuses: readonly string[]): number {
  return statuses.reduce((total, status) => total + (byStatus[status] ?? 0), 0);
}

function sorted(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Which patches a settled trajectory needs scored, empty ones included, each digest once. */
export function patchesToScore(trajectory: Trajectory): readonly string[] {
  if (trajectory.control === null || trajectory.reach === null) return [];
  return [...new Set([trajectory.control.patchDigest, trajectory.reach.patchDigest])];
}

/**
 * An empty patch needs no judge. The frozen viability record shows the held-back half refusing
 * the unchanged base, and an empty patch is the unchanged base, so this is that observation and
 * not an inference. It is the model's outcome and identical in both conditions by construction.
 */
export function scoreOfAnEmptyPatch(): Pick<
  HiddenScore,
  "patchDigest" | "hidden" | "basis" | "heldBackVerdict" | "orderDependent" | "heldBackBond"
> {
  return {
    patchDigest: emptyPatchDigest,
    hidden: "fail",
    basis:
      "no-change: the patch is empty, and the frozen viability record shows the held-back half " +
      "refusing the unchanged base",
    heldBackVerdict: null,
    orderDependent: false,
    heldBackBond: null,
  };
}
