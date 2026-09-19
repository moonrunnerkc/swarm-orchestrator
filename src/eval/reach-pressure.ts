import { z } from "zod";
import { digestOfBytes, digestOfJson, digestPattern } from "../evidence/canonical-json.ts";
import { type RefusalReason, reasonsToRefuse } from "../gates/certification.ts";
import { replayFileSet } from "../gates/file-set.ts";
import { attributeInvocation, type GenerationProbe } from "./endpoint-health.ts";
import type { PatchMetrics } from "./patch-metrics.ts";
import { type HalfVerdict, whyNothingWasJudged } from "./pr-task-judge.ts";
import {
  type Finding,
  type PatchFile,
  patchFileSchema,
  repairProgress,
  repairProgressSchema,
} from "./repair-progress.ts";

/**
 * Whether making an agent satisfy changed-line reach before it may stop changes what a held-back
 * oracle says about the result.
 *
 * One trajectory per task runs until the visible oracle first accepts. That workspace is the
 * control outcome, because a verifier without reach enforcement would have let the run stop
 * there. The reach condition forks from exactly that state: where reach already holds the pair is
 * one patch, and where it does not the agent is told which added lines went unexecuted and may
 * repair. Nothing before the fork can differ between the conditions because there is only one of
 * it, which is what a second independent generation per arm could not offer.
 *
 * Oracle bonding is recorded on every verdict and enforced by neither condition here. Production
 * certification is untouched: this reads `reasonsToRefuse` and keeps a named subset per
 * condition, so the one definition of each refusal stays where it was.
 */
const enforcedByCondition = {
  control: ["regression-not-pass", "task-not-accepted"],
  reach: ["regression-not-pass", "task-not-accepted", "oracle-did-not-reach-the-change"],
} as const satisfies Readonly<Record<string, readonly RefusalReason[]>>;

/**
 * Every treatment this harness has ever applied, each under the identity its rows carry.
 *
 * A protocol names one and freezes its digest. The feedback wording is part of the treatment, so
 * a change to it is a new entry and never an edit: `reach-pressure-v1` is what generation 3 was
 * told, word for word, and stays here so its rows keep describing something that exists.
 */
export const experimentPolicies = {
  "reach-pressure-v1": { id: "reach-pressure-v1", enforced: enforcedByCondition },
  "reach-pressure-v2": {
    id: "reach-pressure-v2",
    enforced: enforcedByCondition,
    reachFeedback: "reach-feedback-v2",
  },
} as const;
export type ExperimentPolicyId = keyof typeof experimentPolicies;

export const experimentPolicy = experimentPolicies["reach-pressure-v1"];

export type ExperimentArm = keyof typeof enforcedByCondition;

export const experimentPolicyDigest: string = digestOfJson(experimentPolicy);

export class UnknownExperimentPolicy extends Error {
  constructor(id: string) {
    super(
      `no experiment policy is named ${id}; this harness knows ${Object.keys(experimentPolicies).join(", ")}`,
    );
    this.name = "UnknownExperimentPolicy";
  }
}

/** The policy a protocol names. One that names none is generation 3's, which predates the field. */
export function experimentPolicyNamed(id: string | undefined): {
  readonly id: ExperimentPolicyId;
  readonly digest: string;
} {
  const named = id ?? "reach-pressure-v1";
  if (!Object.hasOwn(experimentPolicies, named)) throw new UnknownExperimentPolicy(named);
  const policyId = named as ExperimentPolicyId;
  return { id: policyId, digest: digestOfJson(experimentPolicies[policyId]) };
}

/** The verdict fields a stop decision reads, as a live verdict and a recorded one both carry them. */
export interface RefusalFields {
  readonly regression: HalfVerdict["regression"];
  readonly task: HalfVerdict["task"];
  readonly oracleReach?: HalfVerdict["oracleReach"] | undefined;
  readonly oracleBond?: HalfVerdict["oracleBond"] | undefined;
  readonly unreachedByOracle?: HalfVerdict["unreachedByOracle"] | undefined;
}

/** The refusals one condition enforces, out of everything the verdict's record holds. */
export function enforcedRefusals(
  arm: ExperimentArm,
  verdict: RefusalFields,
): readonly RefusalReason[] {
  const enforced: readonly RefusalReason[] = enforcedByCondition[arm];
  return reasonsToRefuse({
    regression: verdict.regression,
    task: verdict.task,
    // An early refusal carries neither field, and an absent measurement is not a reached one.
    oracleReach: verdict.oracleReach ?? "unmeasured",
    oracleBond: verdict.oracleBond ?? "not-bonded",
  }).filter((reason) => enforced.includes(reason));
}

export type VisibleObservation =
  | { readonly kind: "no-change" }
  | { readonly kind: "judged"; readonly verdict: HalfVerdict };

export function mayStop(arm: ExperimentArm, observation: VisibleObservation): boolean {
  return observation.kind === "judged" && enforcedRefusals(arm, observation.verdict).length === 0;
}

/**
 * What the agent is told after a refusal, built from verdict fields and never from program output.
 *
 * Both oracle halves are one file under different title filters, and a runner's own output can
 * name the cases it skipped, which are the held-back ones. So nothing a runner printed travels:
 * the agent reads which named dimension refused, and for reach the paths and line numbers of its
 * own added lines.
 *
 * Two wordings of the reach refusal exist and the policy picks one. `reach-pressure-v1` says what
 * was observed and what certification requires and stops there. Generation 3 showed what that
 * leaves open: across eighteen repair invocations six patches never changed, two gained a scratch
 * script and one edited the agent's own examples, none of which can change what the acceptance
 * check executes. `reach-pressure-v2` closes those exits by naming them, and says the two honest
 * answers a named line admits: the implementation is where the repair belongs, or the line is
 * not executable behaviour and the agent may say why.
 *
 * Neither wording says what to write, and neither asks for less code or for more. Removing a line
 * and making it run are both answers, and which one a model picks is the measurement.
 */
export function refusalFeedback(
  arm: ExperimentArm,
  observation: VisibleObservation,
  policy: ExperimentPolicyId = "reach-pressure-v1",
): string {
  if (observation.kind === "no-change") {
    return (
      "An independent verifier looked at this workspace and found no change against the base " +
      "commit, so there was nothing to judge. The task is still to be done."
    );
  }
  const verdict = observation.verdict;
  const refusals = enforcedRefusals(arm, verdict);
  const lines = [
    "An independent verifier judged the change in this workspace and declined to certify it. " +
      "It judges with an acceptance check you cannot see or edit, and with the repository's own checks.",
  ];
  if (refusals.includes("regression-not-pass")) {
    lines.push(
      verdict.regression === "fail"
        ? "The repository's own checks fail with the change applied and pass without it."
        : "The repository's own checks could not be measured with the change applied.",
    );
  }
  if (refusals.includes("task-not-accepted")) {
    lines.push("The acceptance check for the task fails with the change applied.");
  }
  if (refusals.includes("oracle-did-not-reach-the-change")) {
    const unreached = (verdict.unreachedByOracle ?? []).map(
      (file) => `  ${file.path}: ${file.lines.join(", ")}`,
    );
    if (policy === "reach-pressure-v1") {
      lines.push(
        "The acceptance check passes and the repository's own checks pass. The acceptance check " +
          "never executed these lines the change added, so it did not judge them:",
        ...unreached,
        "The verifier certifies a change only where its acceptance check executes every line the " +
          "change adds.",
      );
    } else {
      lines.push(
        "The acceptance check passes and the repository's own checks pass, and both still have to " +
          "after any revision. The acceptance check never executed these executable lines the " +
          "change added, so it did not judge them:",
        ...unreached,
        "The verifier certifies a change only where its acceptance check executes every executable " +
          "line the change adds. The acceptance check exercises the behaviour the task describes, " +
          "through the code the task is about, so the place to address this is that implementation. " +
          "If a named line is not executable behaviour at all, leave it and say in your final " +
          "message which line and why.",
        "The acceptance check never runs tests, examples or documentation in this workspace, and " +
          "a new executable file it does not load is one more file it did not execute. Changing " +
          "those cannot alter what it executed and is not a repair. A file you create only to " +
          "investigate is not part of the change: do not leave it in the workspace.",
      );
    }
  }
  lines.push(
    "The change is already in this workspace. Revise it so that the verifier can certify it.",
  );
  return lines.join("\n");
}

/** The task statement first and unchanged, so a repair invocation reads the same brief. */
export function repairPrompt(taskText: string, feedback: string): string {
  return `${taskText}\n\nRecorded verifier observations about earlier work on this task:\n${feedback}`;
}

export interface ExperimentLimits {
  /** Agent invocations in the shared prefix, the first included. */
  readonly prefixInvocations: number;
  /** Agent invocations after the fork, in the reach condition only. */
  readonly reachRepairInvocations: number;
}

const patchMetricsSchema = z.object({
  filesChanged: z.number().int(),
  sourceFilesChanged: z.number().int(),
  testFilesChanged: z.number().int(),
  addedLines: z.number().int(),
  deletedLines: z.number().int(),
  executableAddedLines: z.number().int(),
  executableDeletedLines: z.number().int(),
  testAddedLines: z.number().int(),
  diffBytes: z.number().int(),
}) satisfies z.ZodType<PatchMetrics>;

const patchSnapshotSchema = z.object({
  digest: z.string().regex(digestPattern),
  metrics: patchMetricsSchema,
  /** Absent on rows written before repairs were compared file by file. */
  files: z.array(patchFileSchema).optional(),
});
export type PatchSnapshot = z.infer<typeof patchSnapshotSchema>;

/**
 * A snapshot as the driver hands it over: the recorded part, and a way to read a line of it.
 * The reader is never stored. It lets a finding be named by what its line says, so a repair that
 * renumbers an unreached line is not read as having resolved it.
 */
export type TakenSnapshot = PatchSnapshot & {
  readonly lineText?: (path: string, line: number) => string | null;
};

export const emptyPatchDigest: string = digestOfBytes("");

const usageSchema = z.object({
  modelCalls: z.number().int().nonnegative().nullable(),
  /** Calls the provider layer recorded as failed before any answer arrived. */
  failedCalls: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  /** `unknown` where any call did not report usage or the session could not be read. */
  status: z.enum(["reported", "unknown"]),
  /** Failed calls the harness cancelled itself, at a budget or a stop. Absent on earlier rows. */
  cancelledCalls: z.number().int().nonnegative().nullable().optional(),
  /**
   * Whether the last model call raised without the harness having cancelled it, so the
   * invocation ended because the provider failed and not because the agent stopped.
   */
  endedOnProviderFailure: z.boolean().nullable().optional(),
});
export type InvocationUsage = z.infer<typeof usageSchema>;

/** What the invocation's own ledger declared, read after it ended. Null where it could not be read. */
const invocationFileSetSchema = z.object({
  declared: z.boolean(),
  allowed: z.array(z.string()),
  temporary: z.array(z.string()),
  retained: z.array(z.object({ path: z.string(), reason: z.string() })),
});
export type InvocationFileSet = z.infer<typeof invocationFileSetSchema>;

const invocationSchema = z.object({
  exitCode: z.number().int(),
  wallMs: z.number().nonnegative(),
  timedOut: z.boolean(),
  runId: z.string().nullable(),
  /** SHA-256 of the session's ledger bytes: every model call and tool call of the invocation. */
  ledgerDigest: z.string().regex(digestPattern).nullable(),
  ledgerRecords: z.number().int().nonnegative().nullable(),
  usage: usageSchema,
  fileSet: invocationFileSetSchema.nullable().optional(),
});
export type AgentInvocation = z.infer<typeof invocationSchema>;

const verdictSchema = z.object({
  regression: z.enum(["pass", "fail", "unmeasured"]),
  task: z.enum(["accepted", "rejected", "unjudged", "vacuous"]),
  oracleReach: z.enum(["reached", "unreached", "unmeasured"]).optional(),
  unreachedByOracle: z
    .array(z.object({ path: z.string(), lines: z.array(z.number().int()) }))
    .optional(),
  setAsideByReach: z.array(z.object({ path: z.string(), reason: z.string() })).optional(),
  oracleBond: z.enum(["held", "vacuous", "unshown", "not-bonded"]).optional(),
  bondedMutants: z
    .array(z.object({ id: z.string(), verdict: z.string(), witness: z.string().optional() }))
    .optional(),
  /** What production certification said, recorded beside the experiment's own stop decision. */
  verified: z.boolean().optional(),
  applied: z.boolean().optional(),
  refusal: z.string().nullable().optional(),
  judgeFailure: z.string().optional(),
});

const observationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no-change") }),
  z.object({ kind: z.literal("judged"), verdict: verdictSchema }),
]);

const stepSchema = z.object({
  phase: z.enum(["prefix", "reach-repair"]),
  ordinal: z.number().int().positive(),
  promptDigest: z.string().regex(digestPattern),
  feedbackDigest: z.string().regex(digestPattern).nullable(),
  invocation: invocationSchema,
  patch: patchSnapshotSchema,
  observation: observationSchema,
  refusals: z.object({ control: z.array(z.string()), reach: z.array(z.string()) }),
  judgeWallMs: z.number().nonnegative(),
  /**
   * Whether what this invocation left may be read as the agent's. Absent on rows written before
   * it was recorded per step; there the trajectory's status and detail carry it.
   */
  attribution: z
    .discriminatedUnion("to", [
      z.object({ to: z.literal("agent") }),
      z.object({
        to: z.literal("infrastructure"),
        reason: z.enum(["endpoint-not-generating", "no-model-call-answered"]),
        detail: z.string(),
      }),
    ])
    .optional(),
  /** What this invocation did to the findings of the one before it. Never on a first invocation. */
  repairProgress: repairProgressSchema.optional(),
  /**
   * The files this invocation brought into the patch, held against what its own ledger declared.
   * A scratch script shows up here by what the agent recorded about it and never by its name:
   * `undeclared` it never authorized, `temporaryLeft` it said it would delete and did not,
   * `retained` it said it was keeping, with its reason. Absent where either side is unknown.
   */
  scope: z
    .object({
      entered: z.array(z.string()),
      undeclared: z.array(z.string()),
      temporaryLeft: z.array(z.string()),
      retained: z.array(z.object({ path: z.string(), reason: z.string() })),
    })
    .optional(),
});
export type TrajectoryStep = z.infer<typeof stepSchema>;

export const terminalStatuses = [
  "never-visible-accepted",
  "reach-not-triggered",
  "reach-repaired",
  "reach-repair-exhausted",
  "unjudgeable",
  "infrastructure-failure",
] as const;
export type TerminalStatus = (typeof terminalStatuses)[number];

export const trajectorySchema = z.object({
  status: z.enum(terminalStatuses),
  /** Why, for the two statuses that are about the instrument rather than the model. */
  detail: z.string().nullable(),
  steps: z.array(stepSchema),
  /** Index into `steps` of the first visible acceptance, which is the control outcome. */
  visibleAcceptedAt: z.number().int().nonnegative().nullable(),
  control: z
    .object({ patchDigest: z.string().regex(digestPattern), step: z.number().int() })
    .nullable(),
  reach: z
    .object({
      patchDigest: z.string().regex(digestPattern),
      step: z.number().int(),
      triggered: z.boolean(),
      repairs: z.number().int().nonnegative(),
      /** Whether the final patch is one the reach condition would let the run stop on. */
      satisfied: z.boolean(),
      /**
       * The final observation against the one at the fork, for a triggered task. `repairs`
       * exhausted says the budget ran out; this says what the budget bought. Absent on rows
       * written before it was recorded, where the analysis derives it from line numbers.
       */
      progress: repairProgressSchema.optional(),
    })
    .nullable(),
});
export type Trajectory = z.infer<typeof trajectorySchema>;

/**
 * What the agent side of a trajectory is allowed to know about a task.
 *
 * The held-back cases are not a field here, so no code path that builds a prompt or a feedback
 * message has them to leak. The driver holds the full task for judging and hands over only this.
 */
export interface AgentVisibleTask {
  readonly id: string;
  readonly taskText: string;
}

export interface TrajectoryEffects {
  readonly invokeAgent: (prompt: string) => Promise<AgentInvocation>;
  /** The workspace's whole diff against the base, stored by content address. */
  readonly snapshot: () => Promise<TakenSnapshot>;
  /** The visible oracle and the repository's own checks over one stored patch. */
  readonly judgeVisible: (patch: PatchSnapshot) => Promise<HalfVerdict>;
  /**
   * A bounded completion from the configured model. Named for what it must measure: a probe that
   * only lists models passes on a server that has stopped completing.
   */
  readonly endpointGenerates: () => Promise<GenerationProbe>;
  readonly now: () => number;
}

function recorded(verdict: HalfVerdict): z.infer<typeof verdictSchema> {
  return verdictSchema.parse({
    regression: verdict.regression,
    task: verdict.task,
    oracleReach: verdict.oracleReach,
    unreachedByOracle: verdict.unreachedByOracle,
    setAsideByReach: verdict.setAsideByReach,
    oracleBond: verdict.oracleBond,
    bondedMutants: verdict.bondedMutants?.map((one) => ({
      id: one.id,
      verdict: one.verdict,
      witness: (one as { witness?: string }).witness,
    })),
    verified: verdict.verified,
    applied: verdict.applied,
    refusal: verdict.refusal,
    judgeFailure: verdict.judgeFailure,
  });
}

/**
 * One task, from the base commit to a terminal status.
 *
 * Feedback inside the shared prefix is always the control condition's. A patch can fail the
 * repository's checks while its oracle accepts and leaves lines unreached, and naming those lines
 * there would start the treatment before the fork it is defined to start at.
 */
export async function runTrajectory(input: {
  readonly task: AgentVisibleTask;
  readonly limits: ExperimentLimits;
  readonly effects: TrajectoryEffects;
  /** The treatment the protocol names. Generation 3's where none is named. */
  readonly policy?: ExperimentPolicyId;
}): Promise<Trajectory> {
  const { task, limits, effects } = input;
  const policy = input.policy ?? "reach-pressure-v1";
  const steps: TrajectoryStep[] = [];
  const ended = (
    status: TerminalStatus,
    detail: string | null,
    outcome: Pick<Trajectory, "visibleAcceptedAt" | "control" | "reach">,
  ): Trajectory => trajectorySchema.parse({ status, detail, steps, ...outcome });
  const nothing = { visibleAcceptedAt: null, control: null, reach: null };

  let feedback: string | null = null;
  // The last invocation that may be read as the agent's, which is what a repair is compared with.
  let earlier: {
    readonly step: number;
    readonly snapshot: TakenSnapshot;
    readonly observation: VisibleObservation;
  } | null = null;
  const attempt = async (
    phase: TrajectoryStep["phase"],
    ordinal: number,
  ): Promise<{ observation: VisibleObservation; stopped: string | null }> => {
    const prompt = feedback === null ? task.taskText : repairPrompt(task.taskText, feedback);
    const invocation = await effects.invokeAgent(prompt);
    const snapshot = await effects.snapshot();
    let observation: VisibleObservation = { kind: "no-change" };
    const judgeStarted = effects.now();
    // Asked after every invocation, not only an empty one. A server that died halfway through a
    // repair leaves the earlier patch in place, and judging that as the model's answer to the
    // feedback would record a dead endpoint as a model that declined to change anything.
    const attribution = attributeInvocation({
      probe: await effects.endpointGenerates(),
      calls: invocation.usage,
    });
    const stopped = attribution.to === "infrastructure" ? attribution.detail : null;
    if (stopped === null && snapshot.digest !== emptyPatchDigest) {
      observation = { kind: "judged", verdict: await effects.judgeVisible(snapshot) };
    }
    // The condition whose refusals the agent was just told about is the one a repair is read
    // against, for the observation before it as much as the one after.
    const arm: ExperimentArm = phase === "reach-repair" ? "reach" : "control";
    const compared =
      stopped === null && earlier !== null
        ? comparedFindings(arm, earlier, { snapshot, observation })
        : null;
    steps.push({
      phase,
      ordinal,
      promptDigest: digestOfBytes(prompt),
      feedbackDigest: feedback === null ? null : digestOfBytes(feedback),
      invocation,
      patch: {
        digest: snapshot.digest,
        metrics: snapshot.metrics,
        ...(snapshot.files === undefined ? {} : { files: snapshot.files }),
      },
      observation:
        observation.kind === "judged"
          ? { kind: "judged", verdict: recorded(observation.verdict) }
          : observation,
      refusals: {
        control:
          observation.kind === "judged"
            ? [...enforcedRefusals("control", observation.verdict)]
            : [],
        reach:
          observation.kind === "judged" ? [...enforcedRefusals("reach", observation.verdict)] : [],
      },
      judgeWallMs: effects.now() - judgeStarted,
      attribution,
      ...scopeOf(invocation.fileSet, snapshot.files, earlier?.snapshot.files),
      ...(compared === null || earlier === null
        ? {}
        : {
            repairProgress: repairProgress({
              comparedWithStep: earlier.step,
              findingIdentity: compared.identity,
              before: {
                patchDigest: earlier.snapshot.digest,
                findings: compared.before,
                files: earlier.snapshot.files,
              },
              after: {
                patchDigest: snapshot.digest,
                findings: compared.after,
                files: snapshot.files,
              },
            }),
          }),
    });
    if (stopped === null) earlier = { step: steps.length - 1, snapshot, observation };
    return { observation, stopped };
  };
  const sinceTheFork = (fork: NonNullable<typeof earlier>) => {
    const latest = earlier ?? fork;
    const compared = comparedFindings("reach", fork, latest);
    return repairProgress({
      comparedWithStep: fork.step,
      findingIdentity: compared.identity,
      before: {
        patchDigest: fork.snapshot.digest,
        findings: compared.before,
        files: fork.snapshot.files,
      },
      after: {
        patchDigest: latest.snapshot.digest,
        findings: compared.after,
        files: latest.snapshot.files,
      },
    });
  };
  // An oracle that gave no verdict, or that accepts the base as well, judged nothing. That is a
  // finding about the instrument, so the task ends there instead of the model being told to repair.
  const couldNotJudge = (observation: VisibleObservation): string | null => {
    if (observation.kind !== "judged") return null;
    const { verdict } = observation;
    if (verdict.task === "vacuous") return "the visible oracle accepts the base commit as well";
    return whyNothingWasJudged(verdict);
  };

  let accepted: VisibleObservation | null = null;
  for (let ordinal = 1; ordinal <= limits.prefixInvocations; ordinal += 1) {
    const { observation, stopped } = await attempt("prefix", ordinal);
    if (stopped !== null) return ended("infrastructure-failure", stopped, nothing);
    const unjudged = couldNotJudge(observation);
    if (unjudged !== null) return ended("unjudgeable", unjudged, nothing);
    if (mayStop("control", observation)) {
      accepted = observation;
      break;
    }
    feedback = refusalFeedback("control", observation, policy);
  }

  const last = steps.length - 1;
  const lastPatch = steps[last]?.patch.digest ?? emptyPatchDigest;
  if (accepted === null) {
    // No treatment was ever applied, so both conditions end on the one patch there is.
    return ended("never-visible-accepted", null, {
      visibleAcceptedAt: null,
      control: { patchDigest: lastPatch, step: last },
      reach: { patchDigest: lastPatch, step: last, triggered: false, repairs: 0, satisfied: false },
    });
  }

  const control = { patchDigest: lastPatch, step: last };
  if (mayStop("reach", accepted)) {
    return ended("reach-not-triggered", null, {
      visibleAcceptedAt: last,
      control,
      reach: { ...control, triggered: false, repairs: 0, satisfied: true },
    });
  }

  // Narrowed by the acceptance above: the accepted invocation is the last one read as the agent's.
  const fork = earlier as NonNullable<typeof earlier> | null;
  if (fork === null)
    throw new Error("a visible acceptance was recorded with no invocation behind it");
  feedback = refusalFeedback("reach", accepted, policy);
  for (let ordinal = 1; ordinal <= limits.reachRepairInvocations; ordinal += 1) {
    const { observation, stopped } = await attempt("reach-repair", ordinal);
    if (stopped !== null) return ended("infrastructure-failure", stopped, nothing);
    const unjudged = couldNotJudge(observation);
    if (unjudged !== null) return ended("unjudgeable", unjudged, nothing);
    const at = steps.length - 1;
    const patchDigest = steps[at]?.patch.digest ?? emptyPatchDigest;
    if (mayStop("reach", observation)) {
      return ended("reach-repaired", null, {
        visibleAcceptedAt: last,
        control,
        reach: {
          patchDigest,
          step: at,
          triggered: true,
          repairs: ordinal,
          satisfied: true,
          progress: sinceTheFork(fork),
        },
      });
    }
    feedback = refusalFeedback("reach", observation, policy);
  }
  const at = steps.length - 1;
  return ended("reach-repair-exhausted", null, {
    visibleAcceptedAt: last,
    control,
    reach: {
      patchDigest: steps[at]?.patch.digest ?? emptyPatchDigest,
      step: at,
      triggered: true,
      repairs: limits.reachRepairInvocations,
      satisfied: false,
      progress: sinceTheFork(fork),
    },
  });
}

/** The file set a finished session's ledger holds, or null where the ledger does not replay. */
export function fileSetOfSession(
  evidence: Parameters<typeof replayFileSet>[0],
): InvocationFileSet | null {
  try {
    const state = replayFileSet(evidence);
    return {
      declared: state.wasDeclared,
      allowed: [...state.allowed].sort(),
      temporary: [...(state.temporary ?? [])].sort(),
      retained: (state.retained ?? []).map((one) => ({ path: one.path, reason: one.reason })),
    };
  } catch {
    return null;
  }
}

function scopeOf(
  fileSet: InvocationFileSet | null | undefined,
  files: readonly PatchFile[] | undefined,
  earlierFiles: readonly PatchFile[] | undefined,
): { scope?: NonNullable<TrajectoryStep["scope"]> } {
  if (fileSet === null || fileSet === undefined || files === undefined) return {};
  const before = new Set((earlierFiles ?? []).map((file) => file.path));
  const present = new Set(files.map((file) => file.path));
  // Only what this invocation added is held against its declaration. Files an earlier
  // invocation left are in the patch too, and a later session never declared those.
  const entered = files.map((file) => file.path).filter((path) => !before.has(path));
  const allowed = new Set(fileSet.allowed);
  return {
    scope: {
      entered,
      undeclared: entered.filter((path) => !allowed.has(path)),
      temporaryLeft: fileSet.temporary.filter((path) => present.has(path)),
      retained: fileSet.retained.filter((one) => present.has(one.path)),
    },
  };
}

/**
 * The blocking findings one condition holds against an observation, as things a set can compare.
 *
 * A refusal other than reach is one finding. A reach refusal is one finding per unreached line,
 * since a repair that makes two of five lines run has done something and the refusal alone would
 * not say so.
 */
export function blockingFindings(
  arm: ExperimentArm,
  observation:
    | { readonly kind: "no-change" }
    | { readonly kind: "judged"; readonly verdict: RefusalFields },
  nameOf: (path: string, line: number) => string,
): readonly Finding[] {
  if (observation.kind === "no-change") return [{ id: "no-change", kind: "no-change" }];
  const findings: Finding[] = [];
  for (const reason of enforcedRefusals(arm, observation.verdict)) {
    const unreached =
      reason === "oracle-did-not-reach-the-change"
        ? (observation.verdict.unreachedByOracle ?? [])
        : [];
    if (unreached.length === 0) {
      findings.push({ id: `refusal:${reason}`, kind: "refusal" });
      continue;
    }
    for (const file of unreached) {
      for (const line of file.lines) {
        findings.push({
          id: `unreached:${file.path}:${nameOf(file.path, line)}`,
          kind: "unreached-line",
          path: file.path,
          line,
        });
      }
    }
  }
  return findings;
}

/**
 * Both sides of one comparison under one naming, chosen by what both snapshots can supply.
 *
 * Naming one side by text and the other by number would make every finding look replaced.
 */
function comparedFindings(
  arm: ExperimentArm,
  before: { readonly snapshot: TakenSnapshot; readonly observation: VisibleObservation },
  after: { readonly snapshot: TakenSnapshot; readonly observation: VisibleObservation },
): {
  readonly identity: "line-text" | "line-number";
  readonly before: readonly Finding[];
  readonly after: readonly Finding[];
} {
  const byNumber = (_path: string, line: number) => `L${line}`;
  const sides = [before, after] as const;
  const readable = sides.every((side) =>
    blockingFindings(arm, side.observation, byNumber).every(
      (finding) =>
        finding.kind !== "unreached-line" ||
        (side.snapshot.lineText?.(finding.path ?? "", finding.line ?? 0) ?? null) !== null,
    ),
  );
  const named = sides.map((side) => {
    if (!readable) return blockingFindings(arm, side.observation, byNumber);
    // Two unreached lines of one file can say the same thing, so each is numbered among its twins.
    const seen = new Map<string, number>();
    return blockingFindings(arm, side.observation, (path, line) => {
      const text = digestOfBytes(side.snapshot.lineText?.(path, line) ?? "").slice(7, 23);
      const nth = (seen.get(`${path} ${text}`) ?? 0) + 1;
      seen.set(`${path} ${text}`, nth);
      return `${text}#${nth}`;
    });
  });
  return {
    identity: readable ? "line-text" : "line-number",
    before: named[0] ?? [],
    after: named[1] ?? [],
  };
}

/** Tokens and calls for one invocation, from its model-call payloads. Unknown stays unknown. */
export function usageOfModelCalls(
  payloads: readonly { readonly type: string; readonly payload: unknown }[],
): InvocationUsage {
  let modelCalls = 0;
  let failedCalls = 0;
  let cancelledCalls = 0;
  let cancellationRecorded = true;
  let inputTokens = 0;
  let outputTokens = 0;
  let unknown = false;
  // Null until a failed call says whether it was cancelled: ledgers written before that was
  // recorded cannot answer, and "not cancelled" would be an answer.
  let endedOnProviderFailure: boolean | null = false;
  for (const entry of payloads) {
    if (entry.type !== "model-call") continue;
    modelCalls += 1;
    const payload = entry.payload as {
      usageStatus?: string;
      inputTokens?: unknown;
      outputTokens?: unknown;
      providerAttempts?: readonly { usage?: string }[];
      content?: { reason?: string };
      cancelled?: unknown;
    };
    const failed = payload.content?.reason === "call-failed";
    if (failed) failedCalls += 1;
    if (failed && payload.cancelled === true) cancelledCalls += 1;
    if (failed && typeof payload.cancelled !== "boolean") cancellationRecorded = false;
    endedOnProviderFailure = !failed
      ? false
      : typeof payload.cancelled === "boolean"
        ? !payload.cancelled
        : null;
    unknown ||=
      payload.usageStatus !== "reported" ||
      payload.providerAttempts?.some((one) => one.usage === "unknown") === true ||
      typeof payload.inputTokens !== "number" ||
      typeof payload.outputTokens !== "number";
    inputTokens += typeof payload.inputTokens === "number" ? payload.inputTokens : 0;
    outputTokens += typeof payload.outputTokens === "number" ? payload.outputTokens : 0;
  }
  const calls = {
    modelCalls,
    failedCalls,
    cancelledCalls: cancellationRecorded ? cancelledCalls : null,
    endedOnProviderFailure,
  };
  return unknown
    ? { ...calls, inputTokens: null, outputTokens: null, status: "unknown" }
    : { ...calls, inputTokens, outputTokens, status: "reported" };
}
