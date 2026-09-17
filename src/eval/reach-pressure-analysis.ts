import { z } from "zod";
import { digestPattern } from "../evidence/canonical-json.ts";
import { metricsDelta, type PatchMetrics } from "./patch-metrics.ts";
import { emptyPatchDigest, type Trajectory, trajectorySchema } from "./reach-pressure.ts";
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

type Usage = { modelCalls: number; inputTokens: number | null; outputTokens: number | null };

function phaseTotals(trajectory: Trajectory, phase: "prefix" | "reach-repair") {
  const steps = trajectory.steps.filter((one) => one.phase === phase);
  const usage = steps.reduce<Usage>(
    (total, step) => {
      const { usage: one } = step.invocation;
      const unknown = one.status === "unknown";
      return {
        modelCalls: total.modelCalls + (one.modelCalls ?? 0),
        inputTokens:
          total.inputTokens === null || unknown ? null : total.inputTokens + (one.inputTokens ?? 0),
        outputTokens:
          total.outputTokens === null || unknown
            ? null
            : total.outputTokens + (one.outputTokens ?? 0),
      };
    },
    { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
  );
  return {
    invocations: steps.length,
    agentWallMs: steps.reduce((total, step) => total + step.invocation.wallMs, 0),
    judgeWallMs: steps.reduce((total, step) => total + step.judgeWallMs, 0),
    ...usage,
  };
}

function visibleOf(trajectory: Trajectory, step: number) {
  const observation = trajectory.steps[step]?.observation;
  return observation?.kind === "judged" ? observation.verdict : null;
}

function metricsOf(trajectory: Trajectory, step: number): PatchMetrics | null {
  return trajectory.steps[step]?.patch.metrics ?? null;
}

export interface ReachPressureSummary {
  readonly schema: "swarm.reach-pressure.summary.v1";
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

export function summarize(input: {
  readonly manifest: Manifest;
  readonly identity: ExperimentIdentity;
  readonly results: readonly ResultRow[];
  readonly hiddenScores: readonly HiddenScore[];
}): ReachPressureSummary {
  const { manifest, identity } = input;
  const identityKeys = [
    "generation",
    "protocolDigest",
    "manifestDigest",
    "driverDigest",
    "policyDigest",
    "harness",
  ] as const;
  const foreign = [...input.results, ...input.hiddenScores].filter((row) =>
    identityKeys.some((key) => row[key] !== identity[key]),
  );
  if (foreign.length > 0) {
    throw new MixedProtocolGenerations([
      ...new Set(foreign.map((row) => `${row.taskId} generation ${row.generation} ${row.harness}`)),
    ]);
  }
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
  const overhead = { triggeredTasks: 0, prefix: emptyTotals(), reachRepair: emptyTotals() };

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
      overhead.triggeredTasks += 1;
      addTotals(overhead.prefix, phaseTotals(trajectory, "prefix"));
      addTotals(overhead.reachRepair, phaseTotals(trajectory, "reach-repair"));
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
        overhead: phaseTotals(trajectory, "reach-repair"),
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
    schema: "swarm.reach-pressure.summary.v1",
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
      overhead,
    },
    triggered,
    excluded,
  };
}

function emptyTotals() {
  return {
    invocations: 0,
    agentWallMs: 0,
    judgeWallMs: 0,
    modelCalls: 0,
    inputTokens: 0 as number | null,
    outputTokens: 0 as number | null,
  };
}

function addTotals(into: ReturnType<typeof emptyTotals>, one: ReturnType<typeof phaseTotals>) {
  into.invocations += one.invocations;
  into.agentWallMs += one.agentWallMs;
  into.judgeWallMs += one.judgeWallMs;
  into.modelCalls += one.modelCalls;
  into.inputTokens =
    into.inputTokens === null || one.inputTokens === null
      ? null
      : into.inputTokens + one.inputTokens;
  into.outputTokens =
    into.outputTokens === null || one.outputTokens === null
      ? null
      : into.outputTokens + one.outputTokens;
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
