import { z } from "zod";
import { digestPattern } from "../evidence/canonical-json.ts";
import { namesATestFile, namesATypeTest, pathSetAside } from "../gates/oracle-reach.ts";
import {
  armRecordSchema,
  findingCount,
  prefixRecordSchema,
  type SignalKind,
  type StudyArm,
  type StudyStep,
  signalsClassifiedBy,
  studyArms,
} from "./feedback-study.ts";
import { knownTotal } from "./known-total.ts";
import { metricsDelta, type PatchMetrics } from "./patch-metrics.ts";
import { manifestTaskSchema } from "./reach-pressure-analysis.ts";
import { scheduleOf, type TaskSchedule } from "./reach-pressure-derivation.ts";
import {
  type ClusteredRow,
  clusteredDifferenceInterval,
  holmAdjusted,
  type PairedComparison,
  pairedComparison,
} from "./statistics.ts";

/**
 * The arithmetic of the feedback study, over saved rows and nothing else.
 *
 * No model, judge or filesystem is reachable from here, so a summary written when the run ended
 * and one re-derived later from the committed rows are one function applied twice.
 */

export const studyManifestSchema = z
  .object({
    schema: z.literal("swarm.feedback-study.manifest.v1"),
    cohort: z.string().min(1),
    /** The viability record the tasks were frozen from, by digest. */
    source: z.object({ path: z.string(), digest: z.string().regex(digestPattern) }),
    /** How the cohort was chosen from what was viable, stated before any outcome existed. */
    selection: z.object({
      rule: z.string().min(1),
      repositoryCapShare: z.number().positive(),
      historical: z.object({
        path: z.string(),
        digest: z.string().regex(digestPattern),
        tasks: z.number().int(),
      }),
      viable: z.number().int().nonnegative(),
      setAsideByCap: z.array(z.object({ id: z.string(), key: z.string() })),
      repositoriesOverCap: z.array(z.object({ repository: z.string(), tasks: z.number().int() })),
    }),
    tasks: z.array(manifestTaskSchema).min(1),
  })
  .refine((value) => new Set(value.tasks.map((one) => one.id)).size === value.tasks.length, {
    message: "a frozen cohort names each task once",
  })
  .refine(
    (value) => value.tasks.every((one, at) => at === 0 || (value.tasks[at - 1]?.id ?? "") < one.id),
    { message: "a frozen cohort is ordered by task id" },
  );
export type StudyManifest = z.infer<typeof studyManifestSchema>;

const sha1 = z.string().regex(/^[0-9a-f]{40}$/);
const digest = z.string().regex(digestPattern);

export const studyIdentitySchema = z.object({
  study: z.literal("feedback-intervention"),
  generation: z.number().int().positive(),
  protocolDigest: digest,
  manifestDigest: digest,
  /** Every source that ran a task, applied a treatment or recorded an observation. */
  acquisitionDigest: digest,
  /** Every source that turned a stored patch into a held-back pass or fail. */
  scoringDigest: digest,
  /** The treatment wording, all four arms and the prefix's feedback rule together. */
  policyDigest: digest,
  harness: sha1,
});
export type StudyIdentity = z.infer<typeof studyIdentitySchema>;

/** A model as the protocol registered it: its id and the digest of everything that pins it. */
export const modelIdentitySchema = z.object({ id: z.string().min(1), digest });
export type ModelIdentity = z.infer<typeof modelIdentitySchema>;

const identifiedRowSchema = studyIdentitySchema.extend({
  schema: z.string(),
  model: modelIdentitySchema,
  taskId: z.string().min(1),
});

export const launchRowSchema = studyIdentitySchema.extend({
  schema: z.literal("swarm.feedback-study.launch.v1"),
  model: modelIdentitySchema,
  taskId: z.string().min(1),
  unit: z.enum(["prefix", ...studyArms]),
  attempt: z.number().int().positive(),
  /** The prefix attempt an arm forks from. Null for a prefix. */
  prefixAttempt: z.number().int().positive().nullable(),
  startedAt: z.string(),
});
export type LaunchRow = z.infer<typeof launchRowSchema>;

export const prefixRowSchema = studyIdentitySchema.extend({
  schema: z.literal("swarm.feedback-study.prefix.v1"),
  model: modelIdentitySchema,
  taskId: z.string().min(1),
  attempt: z.number().int().positive(),
  startedAt: z.string(),
  wallMs: z.number().nonnegative(),
  prefix: prefixRecordSchema,
});
export type PrefixRow = z.infer<typeof prefixRowSchema>;

export const armRowSchema = studyIdentitySchema.extend({
  schema: z.literal("swarm.feedback-study.arm.v1"),
  model: modelIdentitySchema,
  taskId: z.string().min(1),
  arm: z.enum(studyArms),
  treatmentDigest: digest,
  attempt: z.number().int().positive(),
  prefixAttempt: z.number().int().positive(),
  /** The parent as the prefix froze it, and what the arm's workspace held before anything ran. */
  fork: z.object({
    patchDigest: digest,
    treeDigest: z.string().min(1),
    verified: z.object({ patchDigest: digest, treeDigest: z.string().min(1) }).nullable(),
  }),
  startedAt: z.string(),
  wallMs: z.number().nonnegative(),
  record: armRecordSchema,
});
export type ArmRow = z.infer<typeof armRowSchema>;

export const hiddenScoreRowSchema = studyIdentitySchema.extend({
  schema: z.literal("swarm.feedback-study.hidden-score.v1"),
  model: modelIdentitySchema,
  taskId: z.string().min(1),
  patchDigest: digest,
  hidden: z.enum(["pass", "fail", "unjudgeable"]),
  basis: z.string().min(1),
  heldBackVerdict: z.enum(["accepted", "rejected", "unjudged", "vacuous"]).nullable(),
  orderDependent: z.boolean(),
  heldBackBond: z.enum(["held", "vacuous", "unshown", "not-bonded"]).nullable(),
  judgeWallMs: z.number().nonnegative(),
});
export type HiddenScoreRow = z.infer<typeof hiddenScoreRowSchema>;

export class MixedStudyIdentities extends Error {
  constructor(found: readonly string[]) {
    super(`rows of more than one acquisition cannot make one estimate: ${found.join("; ")}`);
    this.name = "MixedStudyIdentities";
  }
}

/**
 * Every row held to one acquisition and the registered model panel, read for identity before its
 * contents are parsed: a stray row of an earlier generation is refused as that and not as a row
 * today's schema happens not to read.
 */
export function assertOneStudyAcquisition(
  identity: StudyIdentity,
  panel: readonly ModelIdentity[],
  rawRows: readonly unknown[],
): void {
  const keys = [
    "study",
    "generation",
    "protocolDigest",
    "manifestDigest",
    "acquisitionDigest",
    "scoringDigest",
    "policyDigest",
    "harness",
  ] as const;
  const registered = new Map(panel.map((one) => [one.id, one.digest]));
  const foreign: string[] = [];
  for (const raw of rawRows) {
    const parsed = identifiedRowSchema.safeParse(raw);
    if (!parsed.success) {
      foreign.push(`a row without a feedback-study identity: ${JSON.stringify(raw).slice(0, 120)}`);
      continue;
    }
    const row = parsed.data;
    const differs: string[] = keys.filter((key) => row[key] !== identity[key]);
    if (registered.get(row.model.id) !== row.model.digest) differs.push("model");
    if (differs.length > 0) {
      foreign.push(
        `${row.model.id} ${row.taskId} generation ${row.generation} (differs in ${differs.join(", ")})`,
      );
    }
  }
  if (foreign.length > 0) throw new MixedStudyIdentities([...new Set(foreign)]);
}

// ---------------------------------------------------------------------------------------------
// What runs next, from the rows alone.

export type StudyUnit = "prefix" | StudyArm;

export interface UnitSchedule extends TaskSchedule {
  readonly unit: StudyUnit;
  /** For an arm, the prefix attempt it forks from. */
  readonly prefixAttempt: number | null;
}

const rowsOf = <Row extends { readonly model: ModelIdentity; readonly taskId: string }>(
  rows: readonly Row[],
  model: string,
  taskId: string,
) => rows.filter((row) => row.model.id === model && row.taskId === taskId);

/** The settled prefix of one model and task: its last attempt, where that is not infrastructure. */
export function settledPrefix(
  prefixes: readonly PrefixRow[],
  model: string,
  taskId: string,
): PrefixRow | null {
  const last = [...rowsOf(prefixes, model, taskId)]
    .sort((one, other) => one.attempt - other.attempt)
    .at(-1);
  return last === undefined || last.prefix.status === "infrastructure-failure" ? null : last;
}

/**
 * Every unit of one model and task in the order it runs: the prefix, then each arm its eligibility
 * named, in the order recorded there. A unit waits for the one before it, so an arm never forks
 * from a prefix that has not settled, and a resume can neither repeat nor skip an observation.
 */
export function unitSchedules(input: {
  readonly model: string;
  readonly taskId: string;
  readonly launches: readonly LaunchRow[];
  readonly prefixes: readonly PrefixRow[];
  readonly arms: readonly ArmRow[];
  readonly attemptsPerUnit: number;
}): readonly UnitSchedule[] {
  const launches = rowsOf(input.launches, input.model, input.taskId);
  const prefixes = rowsOf(input.prefixes, input.model, input.taskId).sort(
    (one, other) => one.attempt - other.attempt,
  );
  const prefix = scheduleOf({
    launches: launches.filter((one) => one.unit === "prefix"),
    results: prefixes.map((row) => ({ trajectory: { status: row.prefix.status } })),
    attemptsPerTask: input.attemptsPerUnit,
  });
  const schedules: UnitSchedule[] = [{ ...prefix, unit: "prefix", prefixAttempt: null }];
  const settled = prefix.action === "settled" ? prefixes.at(-1) : undefined;
  if (settled === undefined || !settled.prefix.eligibility.eligible) return schedules;
  for (const arm of settled.prefix.eligibility.arms) {
    const armRows = rowsOf(input.arms, input.model, input.taskId)
      .filter((row) => row.arm === arm && row.prefixAttempt === settled.attempt)
      .sort((one, other) => one.attempt - other.attempt);
    const schedule = scheduleOf({
      launches: launches.filter((one) => one.unit === arm && one.prefixAttempt === settled.attempt),
      results: armRows.map((row) => ({ trajectory: { status: row.record.status } })),
      attemptsPerTask: input.attemptsPerUnit,
    });
    schedules.push({ ...schedule, unit: arm, prefixAttempt: settled.attempt });
    if (schedule.action === "dispatch" || schedule.closeDangling !== null) break;
  }
  return schedules;
}

/** Whether every unit of every registered model has settled, which is when scoring may start. */
export function unsettledUnits(input: {
  readonly panel: readonly ModelIdentity[];
  readonly taskIds: readonly string[];
  readonly launches: readonly LaunchRow[];
  readonly prefixes: readonly PrefixRow[];
  readonly arms: readonly ArmRow[];
  readonly attemptsPerUnit: number;
}): readonly string[] {
  const open: string[] = [];
  for (const model of input.panel) {
    for (const taskId of input.taskIds) {
      for (const schedule of unitSchedules({ ...input, model: model.id, taskId })) {
        if (schedule.action === "dispatch" || schedule.closeDangling !== null) {
          open.push(`${model.id} ${taskId} ${schedule.unit}`);
        }
      }
    }
  }
  return open;
}

/** The settled attempt of one arm, forked from the settled prefix. */
function settledArm(arms: readonly ArmRow[], prefix: PrefixRow, arm: StudyArm): ArmRow | null {
  return (
    arms
      .filter(
        (row) =>
          row.model.id === prefix.model.id &&
          row.taskId === prefix.taskId &&
          row.arm === arm &&
          row.prefixAttempt === prefix.attempt,
      )
      .sort((one, other) => one.attempt - other.attempt)
      .at(-1) ?? null
  );
}

/**
 * Which patches the held-back half scores for one settled prefix: the accepted prefix patch and
 * every arm's final patch, each digest once.
 */
export function patchesToScore(prefix: PrefixRow, arms: readonly ArmRow[]): readonly string[] {
  if (prefix.prefix.frozen === null) return [];
  const patches = [prefix.prefix.frozen.patchDigest];
  for (const arm of prefix.prefix.eligibility.arms) {
    const row = settledArm(arms, prefix, arm);
    if (row?.record.final !== null && row?.record.final !== undefined)
      patches.push(row.record.final.patchDigest);
  }
  return [...new Set(patches)];
}

// ---------------------------------------------------------------------------------------------
// The summary.

export const treatments = ["reach", "mutation", "combined"] as const;
export type Treatment = (typeof treatments)[number];

type Hidden = "pass" | "fail" | "unjudgeable" | "unscored";

interface Unit {
  readonly model: string;
  readonly taskId: string;
  readonly prefix: PrefixRow;
  readonly arms: ReadonlyMap<StudyArm, ArmRow>;
  readonly hidden: (patchDigest: string) => Hidden;
}

function tokensOf(step: StudyStep, field: "inputTokens" | "outputTokens"): number | null {
  const { usage } = step.invocation;
  return usage.status === "unknown" ? null : usage[field];
}

export function costOf(steps: readonly StudyStep[]) {
  const modelCalls = knownTotal(steps.map((step) => step.invocation.usage.modelCalls));
  const inputTokens = knownTotal(steps.map((step) => tokensOf(step, "inputTokens")));
  const outputTokens = knownTotal(steps.map((step) => tokensOf(step, "outputTokens")));
  return {
    invocations: steps.length,
    agentWallMs: steps.reduce((total, step) => total + step.invocation.wallMs, 0),
    judgeWallMs: steps.reduce((total, step) => total + step.judgeWallMs, 0),
    modelCalls: modelCalls.total,
    inputTokens: inputTokens.total,
    outputTokens: outputTokens.total,
    /** A total is null where any part was unknown; the known part is kept under its own name. */
    known: {
      modelCalls: modelCalls.knownSubtotal,
      inputTokens: inputTokens.knownSubtotal,
      outputTokens: outputTokens.knownSubtotal,
      invocationsWithUnknownUsage: Math.max(
        modelCalls.unknownParts,
        inputTokens.unknownParts,
        outputTokens.unknownParts,
      ),
    },
  };
}
const counted = (values: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    // Code-point order, so a summary never depends on the locale of the machine that derived it.
    Object.entries(counts).sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0)),
  );
};

/** Paths whose section differs between two file lists, as a set. */
function changedPaths(
  before: readonly { path: string; diffDigest: string }[] | undefined,
  after: readonly { path: string; diffDigest: string }[] | undefined,
): string[] | null {
  if (before === undefined || after === undefined) return null;
  const was = new Map(before.map((file) => [file.path, file.diffDigest]));
  const is = new Map(after.map((file) => [file.path, file.diffDigest]));
  return [...new Set([...was.keys(), ...is.keys()])]
    .filter((path) => was.get(path) !== is.get(path))
    .sort();
}

/**
 * What kind of change a repair made, where a rule over paths and the agent's own ledger can say
 * so and nothing needs reading: every changed path a test; every changed path one no runtime
 * loads; every changed path one the repair's own sessions declared temporary or never declared.
 * No other judgement of a repair is offered.
 */
function changeClasses(fork: PrefixRow, arm: ArmRow) {
  const forkFiles = fork.prefix.steps[fork.prefix.frozen?.step ?? -1]?.patch.files;
  const finalFiles = arm.record.steps[arm.record.final?.step ?? -1]?.patch.files;
  const paths = changedPaths(forkFiles, finalFiles);
  if (paths === null)
    return {
      readable: false,
      changedPaths: [],
      testOnly: false,
      nonRuntimeOnly: false,
      scratchOnly: false,
    };
  const scratch = new Set(
    arm.record.steps.flatMap((step) => [
      ...(step.scope?.temporaryLeft ?? []),
      ...(step.scope?.undeclared ?? []),
    ]),
  );
  const every = (rule: (path: string) => boolean) => paths.length > 0 && paths.every(rule);
  return {
    readable: true,
    changedPaths: paths,
    testOnly: every((path) => namesATestFile(path) || namesATypeTest(path)),
    nonRuntimeOnly: every((path) => pathSetAside(path) !== null),
    scratchOnly: every((path) => scratch.has(path)),
  };
}

function finalSignalsOf(arm: ArmRow) {
  return arm.record.final === null
    ? null
    : (arm.record.steps[arm.record.final.step]?.signals ?? null);
}

/** Whether the findings an arm is described by are gone from its final patch. */
function cleared(arm: ArmRow): boolean {
  const signals = finalSignalsOf(arm);
  return signals?.measured === true && findingCount(signals, signalsClassifiedBy[arm.arm]) === 0;
}

const settledOutcome = (arm: ArmRow | undefined): arm is ArmRow =>
  arm !== undefined &&
  arm.record.final !== null &&
  arm.record.status !== "infrastructure-failure" &&
  arm.record.status !== "unjudgeable";

/** Where two arms of one pair are compared, why a pair could not be, or null where it can. */
function comparable(unit: Unit, first: StudyArm | "prefix", second: StudyArm): string | null {
  const patchOf = (which: StudyArm | "prefix"): string | null => {
    if (which === "prefix") return unit.prefix.prefix.frozen?.patchDigest ?? null;
    const row = unit.arms.get(which);
    return settledOutcome(row) ? (row.record.final?.patchDigest ?? null) : null;
  };
  for (const which of [first, second]) {
    const patch = patchOf(which);
    if (patch === null) {
      const row = which === "prefix" ? undefined : unit.arms.get(which);
      return `${which} did not settle on a patch${row === undefined ? " (not run)" : ` (${row.record.status})`}`;
    }
    const hidden = unit.hidden(patch);
    if (hidden !== "pass" && hidden !== "fail")
      return `${which} patch is ${hidden} by the held-back half`;
  }
  return null;
}

function passes(unit: Unit, which: StudyArm | "prefix"): boolean {
  const patch =
    which === "prefix"
      ? unit.prefix.prefix.frozen?.patchDigest
      : unit.arms.get(which)?.record.final?.patchDigest;
  return patch !== undefined && patch !== null && unit.hidden(patch) === "pass";
}

export interface ComparisonReport extends PairedComparison {
  readonly first: StudyArm | "prefix";
  readonly second: StudyArm;
  readonly excluded: readonly { readonly taskId: string; readonly reason: string }[];
}

function compare(
  units: readonly Unit[],
  first: StudyArm | "prefix",
  second: StudyArm,
): ComparisonReport {
  const excluded: { taskId: string; reason: string }[] = [];
  const pairs: { id: string; first: boolean; second: boolean }[] = [];
  for (const unit of units) {
    const why = comparable(unit, first, second);
    if (why !== null) {
      excluded.push({ taskId: unit.taskId, reason: why });
      continue;
    }
    pairs.push({ id: unit.taskId, first: passes(unit, first), second: passes(unit, second) });
  }
  return { ...pairedComparison(pairs), first, second, excluded };
}

/** A claim in either direction needs the family's adjusted p-value under 5%, and nothing else does. */
export function readingOf(
  table: PairedComparison,
  adjustedP: number,
): "supports-help" | "supports-harm" | "insufficient" {
  if (adjustedP >= 0.05) return "insufficient";
  return table.cells.onlySecond > table.cells.onlyFirst ? "supports-help" : "supports-harm";
}

/** The fewest discordant pairs, all one way, that could reach a family-wise 5% over `tests` tests. */
export function fewestDiscordantForAClaim(tests: number): number {
  for (let discordant = 1; discordant < 64; discordant += 1) {
    if (Math.min(1, 2 * 0.5 ** discordant) * Math.max(1, tests) < 0.05) return discordant;
  }
  return 64;
}

export interface StudyAnalysisOptions {
  readonly bootstrap: { readonly resamples: number; readonly seed: number };
}

export function summarizeStudy(input: {
  readonly manifest: StudyManifest;
  readonly identity: StudyIdentity;
  readonly panel: readonly ModelIdentity[];
  readonly launches: readonly LaunchRow[];
  readonly prefixes: readonly PrefixRow[];
  readonly arms: readonly ArmRow[];
  readonly hiddenScores: readonly HiddenScoreRow[];
  readonly options: StudyAnalysisOptions;
}) {
  const { manifest, identity, panel } = input;
  assertOneStudyAcquisition(identity, panel, [
    ...input.launches,
    ...input.prefixes,
    ...input.arms,
    ...input.hiddenScores,
  ]);
  const known = new Set(manifest.tasks.map((task) => task.id));
  const stray = [...input.prefixes, ...input.arms].find((row) => !known.has(row.taskId));
  if (stray !== undefined) throw new Error(`${stray.taskId} is not in the frozen cohort`);

  const scoreOf = new Map(
    input.hiddenScores.map((row) => [`${row.model.id}|${row.taskId}|${row.patchDigest}`, row]),
  );
  const repositoryOf = new Map(manifest.tasks.map((task) => [task.id, task.repository]));
  const classifications: Record<string, unknown>[] = [];
  const blindingReferences: Record<string, unknown>[] = [];
  let invocationsChecked = 0;
  let invocationsUnchecked = 0;
  const byModel: Record<string, Record<string, unknown>> = {};
  const primaryFamily: { model: string; treatment: Treatment; table: ComparisonReport }[] = [];
  const pooledRows: Record<Treatment, ClusteredRow[]> = { reach: [], mutation: [], combined: [] };

  for (const model of panel) {
    const units: Unit[] = [];
    const pairStatus: string[] = [];
    const excludedTasks: { taskId: string; reason: string }[] = [];
    let interruptedPrefixAttempts = 0;
    let interruptedArmAttempts = 0;
    const lostToInfrastructure: StudyStep[] = [];
    const prefixSteps: StudyStep[] = [];
    const eligibleCounts = { eligible: 0, reach: 0, mutation: 0, dualTrigger: 0 };
    for (const task of manifest.tasks) {
      const attempts = rowsOf(input.prefixes, model.id, task.id).sort(
        (one, other) => one.attempt - other.attempt,
      );
      for (const earlier of attempts.slice(0, -1)) {
        interruptedPrefixAttempts += 1;
        lostToInfrastructure.push(...earlier.prefix.steps);
      }
      const last = attempts.at(-1);
      if (last === undefined) {
        pairStatus.push("not-run");
        excludedTasks.push({ taskId: task.id, reason: "not-run: no prefix row was recorded" });
        continue;
      }
      for (const step of last.prefix.steps) {
        prefixSteps.push(step);
        audit(step, { model: model.id, taskId: task.id, unit: "prefix" });
      }
      const eligibility = last.prefix.eligibility;
      const status =
        last.prefix.status === "accepted"
          ? eligibility.eligible
            ? "eligible"
            : (eligibility.reason ?? "not-eligible").startsWith("no-eligible-signal")
              ? "no-eligible-signal"
              : "held-back-unavailable"
          : last.prefix.status;
      pairStatus.push(status);
      if (!eligibility.eligible) {
        if (last.prefix.status !== "accepted" && last.prefix.status !== "prefix-not-accepted") {
          excludedTasks.push({
            taskId: task.id,
            reason: `${last.prefix.status}: ${last.prefix.detail ?? "no detail"}`,
          });
        }
        continue;
      }
      eligibleCounts.eligible += 1;
      if (eligibility.arms.includes("reach")) eligibleCounts.reach += 1;
      if (eligibility.arms.includes("mutation")) eligibleCounts.mutation += 1;
      if (eligibility.dualTrigger) eligibleCounts.dualTrigger += 1;
      const arms = new Map<StudyArm, ArmRow>();
      for (const arm of eligibility.arms) {
        const rows = input.arms
          .filter(
            (row) =>
              row.model.id === model.id &&
              row.taskId === task.id &&
              row.arm === arm &&
              row.prefixAttempt === last.attempt,
          )
          .sort((one, other) => one.attempt - other.attempt);
        for (const earlier of rows.slice(0, -1)) {
          interruptedArmAttempts += 1;
          lostToInfrastructure.push(...earlier.record.steps);
        }
        const settled = rows.at(-1);
        if (settled === undefined) continue;
        arms.set(arm, settled);
        for (const step of settled.record.steps)
          audit(step, { model: model.id, taskId: task.id, unit: arm });
      }
      units.push({
        model: model.id,
        taskId: task.id,
        prefix: last,
        arms,
        hidden: (patchDigest) =>
          scoreOf.get(`${model.id}|${task.id}|${patchDigest}`)?.hidden ?? "unscored",
      });
    }

    const primary = Object.fromEntries(
      treatments.map((treatment) => {
        const table = compare(
          units.filter((unit) => unit.prefix.prefix.eligibility.arms.includes(treatment)),
          "neutral",
          treatment,
        );
        primaryFamily.push({ model: model.id, treatment, table });
        return [treatment, table];
      }),
    ) as Record<Treatment, ComparisonReport>;
    for (const treatment of treatments) {
      for (const unit of units.filter((one) =>
        one.prefix.prefix.eligibility.arms.includes(treatment),
      )) {
        if (comparable(unit, "neutral", treatment) === null) {
          pooledRows[treatment].push({
            cluster: unit.taskId,
            first: passes(unit, "neutral"),
            second: passes(unit, treatment),
          });
        }
      }
    }

    const dual = units.filter((unit) => unit.prefix.prefix.eligibility.dualTrigger);
    const dualTrigger = {
      pairs: dual.length,
      reachVersusMutation: compare(dual, "reach", "mutation"),
      reachVersusCombined: compare(dual, "reach", "combined"),
      mutationVersusCombined: compare(dual, "mutation", "combined"),
      neutralVersus: Object.fromEntries(
        treatments.map((treatment) => [treatment, compare(dual, "neutral", treatment)]),
      ),
    };

    const transitions = Object.fromEntries(
      studyArms.map((arm) => [
        arm,
        compare(
          units.filter((unit) => unit.prefix.prefix.eligibility.arms.includes(arm)),
          "prefix",
          arm,
        ),
      ]),
    );

    const mechanism = Object.fromEntries(
      studyArms.map((arm) => {
        const ran = units.flatMap((unit) => {
          const row = unit.arms.get(arm);
          return row === undefined ? [] : [{ unit, row }];
        });
        const settledRows = ran.filter(({ row }) => settledOutcome(row));
        const steps = ran.flatMap(({ row }) => row.record.steps);
        const hiddenOf = (unit: Unit, patch: string | undefined | null) =>
          patch === undefined || patch === null ? "unscored" : unit.hidden(patch);
        const transitionsOf = settledRows.map(({ unit, row }) => {
          const before = hiddenOf(unit, unit.prefix.prefix.frozen?.patchDigest);
          const after = hiddenOf(unit, row.record.final?.patchDigest);
          return before === "pass" || before === "fail"
            ? after === "pass" || after === "fail"
              ? `${before}-to-${after}`
              : `arm-${after}`
            : `prefix-${before}`;
        });
        const helpful = transitionsOf.filter((one) => one === "fail-to-pass").length;
        const clearedRows = settledRows.filter(({ row }) => cleared(row));
        const proxyOnly = clearedRows.filter(
          ({ unit, row }) => hiddenOf(unit, row.record.final?.patchDigest) === "fail",
        );
        const deltas = settledRows.flatMap(({ unit, row }) => {
          const before =
            unit.prefix.prefix.steps[unit.prefix.prefix.frozen?.step ?? -1]?.patch.metrics;
          const after = row.record.steps[row.record.final?.step ?? -1]?.patch.metrics;
          return before === undefined || after === undefined ? [] : [metricsDelta(before, after)];
        });
        const direction = (field: keyof PatchMetrics) => {
          const signs = { decreased: 0, unchanged: 0, increased: 0, total: 0 };
          for (const delta of deltas) {
            signs[delta[field] < 0 ? "decreased" : delta[field] > 0 ? "increased" : "unchanged"] +=
              1;
            signs.total += delta[field];
          }
          return signs;
        };
        const classes = settledRows.map(({ unit, row }) => changeClasses(unit.prefix, row));
        const cost = costOf(steps);
        const judgeable = transitionsOf.filter((one) =>
          /^(pass|fail)-to-(pass|fail)$/.test(one),
        ).length;
        const perHelpful = (value: number | null) =>
          value === null || helpful === 0 ? null : value / helpful;
        return [
          arm,
          {
            ran: ran.length,
            settled: settledRows.length,
            byTerminal: counted(ran.map(({ row }) => row.record.status)),
            patchChanged: settledRows.filter(
              ({ unit, row }) =>
                row.record.final?.patchDigest !== unit.prefix.prefix.frozen?.patchDigest,
            ).length,
            signalCleared: clearedRows.length,
            outcomeRelation: counted(
              settledRows.map(({ row }) => row.record.outcome?.relation ?? "unmeasured"),
            ),
            perKindRelation: Object.fromEntries(
              (["reach", "mutation"] as const satisfies readonly SignalKind[]).map((kind) => [
                kind,
                counted(
                  settledRows
                    .filter(({ unit }) => unit.prefix.prefix.eligibility.arms.includes(kind))
                    .map(({ row }) => row.record.perKind[kind]?.relation ?? "unmeasured"),
                ),
              ]),
            ),
            hiddenTransitions: counted(transitionsOf),
            helpfulHiddenTransitions: helpful,
            harmfulHiddenTransitions: transitionsOf.filter((one) => one === "pass-to-fail").length,
            unchangedHiddenOutcomes: transitionsOf.filter(
              (one) => one === "pass-to-pass" || one === "fail-to-fail",
            ).length,
            proxyOnlySuccess: proxyOnly.length,
            proxyOnlyTasks: proxyOnly.map(({ unit }) => unit.taskId),
            verifierResolutionRate:
              settledRows.length === 0 ? null : clearedRows.length / settledRows.length,
            hiddenImprovementRate: judgeable === 0 ? null : helpful / judgeable,
            patchDirection: Object.fromEntries(
              (
                [
                  "addedLines",
                  "deletedLines",
                  "executableAddedLines",
                  "executableDeletedLines",
                  "sourceFilesChanged",
                  "testAddedLines",
                  "diffBytes",
                ] as const
              ).map((field) => [field, direction(field)]),
            ),
            changeClasses: {
              unreadable: classes.filter((one) => !one.readable).length,
              testOnly: classes.filter((one) => one.testOnly).length,
              nonRuntimeOnly: classes.filter((one) => one.nonRuntimeOnly).length,
              scratchOnly: classes.filter((one) => one.scratchOnly).length,
            },
            stopReasons: counted(steps.map((step) => step.invocation.stopReason ?? "unrecorded")),
            cost,
            costPerHelpfulHiddenRepair: {
              invocations: perHelpful(cost.invocations),
              modelCalls: perHelpful(cost.modelCalls),
              inputTokens: perHelpful(cost.inputTokens),
              outputTokens: perHelpful(cost.outputTokens),
              agentWallMs: perHelpful(cost.agentWallMs),
              judgeWallMs: perHelpful(cost.judgeWallMs),
            },
          },
        ];
      }),
    );

    for (const unit of units) {
      for (const [arm, row] of unit.arms) {
        const classes = changeClasses(unit.prefix, row);
        const prefixHidden = unit.hidden(unit.prefix.prefix.frozen?.patchDigest ?? "");
        const armHidden =
          row.record.final === null ? "unscored" : unit.hidden(row.record.final.patchDigest);
        classifications.push({
          model: model.id,
          taskId: unit.taskId,
          repository: repositoryOf.get(unit.taskId),
          arm,
          attempt: row.attempt,
          dualTrigger: unit.prefix.prefix.eligibility.dualTrigger,
          terminal: row.record.status,
          relation: row.record.outcome?.relation ?? null,
          perKind: {
            reach: row.record.perKind.reach?.relation ?? null,
            mutation: row.record.perKind.mutation?.relation ?? null,
          },
          repairs: row.record.repairs,
          forkPatch: unit.prefix.prefix.frozen?.patchDigest,
          finalPatch: row.record.final?.patchDigest ?? null,
          patchChanged:
            row.record.final !== null &&
            row.record.final.patchDigest !== unit.prefix.prefix.frozen?.patchDigest,
          signalCleared: cleared(row),
          hidden: { prefix: prefixHidden, arm: armHidden },
          proxyOnly: cleared(row) && armHidden === "fail",
          changedPaths: classes.changedPaths,
          testOnly: classes.testOnly,
          nonRuntimeOnly: classes.nonRuntimeOnly,
          scratchOnly: classes.scratchOnly,
          cost: costOf(row.record.steps),
        });
      }
    }

    const allSteps = [
      ...prefixSteps,
      ...units.flatMap((unit) => [...unit.arms.values()].flatMap((row) => row.record.steps)),
    ];
    byModel[model.id] = {
      model,
      accounting: {
        tasks: manifest.tasks.length,
        pairStatus: counted(pairStatus),
        visiblyAccepted:
          units.length +
          pairStatus.filter(
            (one) => one === "no-eligible-signal" || one === "held-back-unavailable",
          ).length,
        eligible: eligibleCounts.eligible,
        eligibleReach: eligibleCounts.reach,
        eligibleMutation: eligibleCounts.mutation,
        dualTrigger: eligibleCounts.dualTrigger,
        interruptedPrefixAttempts,
        interruptedArmAttempts,
        invocations: allSteps.length,
        invocationsWithUnknownUsage: allSteps.filter(
          (step) => step.invocation.usage.status === "unknown",
        ).length,
        stopReasons: counted(allSteps.map((step) => step.invocation.stopReason ?? "unrecorded")),
        prefixCost: costOf(prefixSteps),
        lostToInfrastructure: costOf(lostToInfrastructure),
        heldBackJudgeWallMs: input.hiddenScores
          .filter((row) => row.model.id === model.id)
          .reduce((total, row) => total + row.judgeWallMs, 0),
        excluded: excludedTasks,
      },
      primary,
      dualTrigger,
      transitionsFromPrefix: transitions,
      mechanism,
    };
  }

  const adjusted = holmAdjusted(primaryFamily.map((entry) => entry.table.mcnemar.pValue));
  const family = primaryFamily.map((entry, at) => ({
    model: entry.model,
    treatment: entry.treatment,
    pairs: entry.table.pairs,
    discordant: entry.table.mcnemar.discordant,
    pValue: entry.table.mcnemar.pValue,
    holmAdjustedP: adjusted[at] ?? 1,
    reading: readingOf(entry.table, adjusted[at] ?? 1),
  }));
  const pooled = Object.fromEntries(
    treatments.map((treatment) => {
      const rows = pooledRows[treatment];
      const models = new Set(
        primaryFamily
          .filter((entry) => entry.treatment === treatment && entry.table.pairs > 0)
          .map((entry) => entry.model),
      );
      return [
        treatment,
        models.size < 2
          ? {
              computed: false,
              reason: `pairs from ${models.size} model(s); a pooled estimate needs two`,
            }
          : {
              computed: true,
              models: [...models].sort(),
              table: pairedComparison(
                rows.map((row, at) => ({
                  id: `${row.cluster}#${at}`,
                  first: row.first,
                  second: row.second,
                })),
              ).cells,
              difference: clusteredDifferenceInterval(rows, input.options.bootstrap),
            },
      ];
    }),
  );

  function audit(step: StudyStep, where: Record<string, string>) {
    const blinding = step.invocation.blinding;
    if (blinding === undefined || !blinding.checked) {
      invocationsUnchecked += 1;
      return;
    }
    invocationsChecked += 1;
    if (blinding.references.length > 0)
      blindingReferences.push({
        ...where,
        ordinal: step.ordinal,
        phase: step.phase,
        references: blinding.references,
      });
  }

  const byRepository = counted(manifest.tasks.map((task) => task.repository));
  return {
    summary: {
      schema: "swarm.feedback-study.summary.v1" as const,
      identity,
      panel,
      cohort: {
        name: manifest.cohort,
        tasks: manifest.tasks.length,
        repositories: Object.keys(byRepository).length,
        byRepository,
        largestRepositoryShare: Math.max(...Object.values(byRepository)) / manifest.tasks.length,
        singleCaseHalf: manifest.tasks.filter(
          (task) => task.visibleCases.length === 1 || task.heldBackCases.length === 1,
        ).length,
        selection: manifest.selection,
      },
      byModel,
      primaryFamily: {
        method: "exact two-sided McNemar per model and treatment, Holm-adjusted across the family",
        tests: family.length,
        fewestDiscordantForAClaim: fewestDiscordantForAClaim(family.length),
        family,
      },
      pooled: {
        method:
          "paired risk difference over every model's primary pairs, interval by resampling tasks",
        bootstrap: input.options.bootstrap,
        byTreatment: pooled,
      },
      blinding: {
        invocationsChecked,
        invocationsUnchecked,
        invocationsReferencingHeldBackPlaces: blindingReferences.length,
        references: blindingReferences,
      },
    },
    classifications: {
      schema: "swarm.feedback-study.classifications.v1" as const,
      identity,
      rows: classifications,
    },
  };
}
export type StudySummary = ReturnType<typeof summarizeStudy>["summary"];
