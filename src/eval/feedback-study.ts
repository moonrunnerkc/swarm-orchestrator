import { z } from "zod";
import { digestOfBytes, digestOfJson, digestPattern } from "../evidence/canonical-json.ts";
import { type MutantWitness, witnessedADifference } from "../gates/mutant-witness.ts";
import { attributeInvocation, type GenerationProbe } from "./endpoint-health.ts";
import { type HalfVerdict, whyNothingWasJudged } from "./pr-task-judge.ts";
import {
  type AgentInvocation,
  type AgentVisibleTask,
  emptyPatchDigest,
  invocationSchema,
  mayStop,
  type PatchSnapshot,
  patchSnapshotSchema,
  refusalFeedback,
  repairPrompt,
  scopeOf,
  stepScopeSchema,
  type TakenSnapshot,
  type VisibleObservation,
} from "./reach-pressure.ts";
import {
  type Finding,
  type PatchFile,
  repairProgress,
  repairProgressSchema,
} from "./repair-progress.ts";

/**
 * Whether a specific mechanical finding, given after an agent has already satisfied the visible
 * acceptance check and the repository's own checks, improves independently judged correctness
 * more than the same extra budget spent on a neutral review.
 *
 * One shared prefix per model and task: the agent works until the visible check accepts, and that
 * exact workspace is the parent of every arm. The arms differ in one thing, what the repair prompt
 * says beyond a neutral review instruction:
 *
 *   - neutral: nothing beyond it;
 *   - reach: the executable lines the change adds that the visible check never executed;
 *   - mutation: the witnessed mutants of the change's lines that the visible check ran and accepted;
 *   - combined: both, clearly separated.
 *
 * The prefix patch itself, before any repair call, is the fifth condition and costs nothing more.
 * Held-back correctness is judged later, by the driver, for every arm's final patch, and nothing
 * here can see it: prompts are built from the task text and visible verdict fields alone.
 */
export const studyArms = ["neutral", "reach", "mutation", "combined"] as const;
export type StudyArm = (typeof studyArms)[number];

export type SignalKind = "reach" | "mutation";

/** What each arm is told. The neutral arm is told nothing a verifier found. */
export const signalsReceivedBy: Readonly<Record<StudyArm, readonly SignalKind[]>> = {
  neutral: [],
  reach: ["reach"],
  mutation: ["mutation"],
  combined: ["reach", "mutation"],
};

/**
 * What each arm's outcome is described by. The neutral arm is never told either finding, and
 * whether they clear anyway under a neutral review is the baseline a treatment's clearing is read
 * against, so it is described by both.
 */
export const signalsClassifiedBy: Readonly<Record<StudyArm, readonly SignalKind[]>> = {
  neutral: ["reach", "mutation"],
  reach: ["reach"],
  mutation: ["mutation"],
  combined: ["reach", "mutation"],
};

/**
 * The wording of every prompt the study sends after the prefix, versioned as one treatment.
 *
 * The prefix is told what the reach-pressure run's control condition was told, word for word, by
 * `refusalFeedback("control", ...)`, so a prefix here is the same kind of trajectory as there.
 *
 * Nothing here says how to change the code, asks for less code or more, mentions a score, or
 * encourages deleting a line or editing a test to make a finding go away. The reach sentence that
 * tests written in the workspace cannot change what the acceptance check executes is a fact about
 * the instrument, stated because generation 3 of the reach-pressure run showed agents reaching for
 * exactly that.
 */
export const feedbackStudyPolicies = {
  "feedback-study-v1": {
    id: "feedback-study-v1",
    review:
      "The task above has already been worked on in this workspace, and that change is in place. " +
      "Review your implementation for completeness and correctness against the task. Change it " +
      "only where it needs changing. Run the repository's own checks that apply, and leave the " +
      "working tree clean: no scratch, probe or diagnostic files, and nothing the task does not need.",
    lost: {
      lead: "An independent verifier judged the change after the last revision.",
      regressionFails:
        "The repository's own checks fail with the change applied and pass without it.",
      regressionUnmeasured:
        "The repository's own checks could not be measured with the change applied.",
      acceptanceFails: "The acceptance check for the task fails with the change applied.",
      empty: "The workspace no longer holds any change against the base commit.",
    },
    findings:
      "An independent verifier judged the change. The acceptance check for this task passes and " +
      "the repository's own checks pass. The verifier also reports the following.",
    reach: {
      heading: "Changed lines the acceptance check did not exercise:",
      lead:
        "The acceptance check never executed these executable lines that the change adds, so the " +
        "behaviour on them was not exercised:",
      instruction:
        "Address the underlying implementation, or, where a reported line is not executable " +
        "behaviour, show why through your code changes. The acceptance check runs tests of its " +
        "own that you cannot see or edit, so tests written in this workspace do not change what " +
        "it executes.",
    },
    mutation: {
      heading: "Changes to the code that the acceptance check did not notice:",
      lead:
        "The verifier changed single lines of the change, one at a time, and ran the acceptance " +
        "check again. For each line below, the acceptance check executed the line and still " +
        "passed with the change in place, and a separate measurement showed that the change alters " +
        "what the program does:",
      instruction:
        "This is evidence that the acceptance check is insensitive to the behaviour around these " +
        "lines. Review your implementation against what the task asks, in particular the behaviour " +
        "these lines decide.",
    },
  },
} as const;
export type FeedbackStudyPolicyId = keyof typeof feedbackStudyPolicies;

export function feedbackStudyPolicyNamed(id: string): {
  readonly id: FeedbackStudyPolicyId;
  readonly digest: string;
} {
  if (!Object.hasOwn(feedbackStudyPolicies, id)) {
    throw new Error(
      `no feedback-study policy is named ${id}; this harness knows ${Object.keys(feedbackStudyPolicies).join(", ")}`,
    );
  }
  const policyId = id as FeedbackStudyPolicyId;
  return { id: policyId, digest: digestOfJson(feedbackStudyPolicies[policyId]) };
}

/** One arm's treatment identity: the policy's wording and the finding kinds that arm is sent. */
export function treatmentDigest(policy: FeedbackStudyPolicyId, arm: StudyArm): string {
  return digestOfJson({
    policy: feedbackStudyPolicyNamed(policy).digest,
    arm,
    receives: signalsReceivedBy[arm],
  });
}

// ---------------------------------------------------------------------------------------------
// What a verdict says, as findings.

export const reachFindingSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  /** The trimmed text of the added line, which names the finding across a renumbering. */
  text: z.string().nullable(),
});
export type ReachFinding = z.infer<typeof reachFindingSchema>;

export const mutantFindingSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  operator: z.string().min(1),
  before: z.string(),
  after: z.string(),
  witness: z.enum(["coverage", "repository-suite"]),
});
export type MutantFinding = z.infer<typeof mutantFindingSchema>;

export const signalReadingSchema = z.object({
  /**
   * Whether the verdict could say anything about either finding. Both rest on the one coverage
   * reading of the visible check's run: reach reads which added lines it executed, and a mutant
   * is only ever vacuous on a line that reading shows executed. So both are measured exactly where
   * the check accepted and reach was read, and neither anywhere else. An unmeasured reading is
   * never an empty one.
   */
  measured: z.boolean(),
  reach: z.array(reachFindingSchema),
  mutation: z.array(mutantFindingSchema),
});
export type SignalReading = z.infer<typeof signalReadingSchema>;

const unmeasured: SignalReading = { measured: false, reach: [], mutation: [] };

/**
 * The findings a visible verdict carries.
 *
 * Reach is taken as the verdict states it, after every rule that sets a changed file or line
 * aside. A mutant is a finding only where the visible check ran its line and accepted it and a
 * second detector witnessed that it changes what the program does. Production refuses on the
 * first two facts alone and records the third beside them; a mutant nothing witnessed may change
 * nothing, and telling an agent its oracle missed a change that may not be one is not feedback
 * this study will give.
 */
export function signalsOf(
  observation: VisibleObservation,
  lineText?: (path: string, line: number) => string | null,
): SignalReading {
  if (observation.kind !== "judged") return unmeasured;
  const verdict = observation.verdict;
  const read = verdict.oracleReach === "reached" || verdict.oracleReach === "unreached";
  if (verdict.task !== "accepted" || !read) return unmeasured;
  const reach =
    verdict.oracleReach === "unreached"
      ? (verdict.unreachedByOracle ?? []).flatMap((file) =>
          file.lines.map((line) => ({
            path: file.path,
            line,
            text: lineText?.(file.path, line) ?? null,
          })),
        )
      : [];
  const mutation: MutantFinding[] = [];
  for (const mutant of verdict.bondedMutants ?? []) {
    const witness = mutant.witness as MutantWitness | undefined;
    if (
      mutant.verdict !== "vacuous" ||
      witness === undefined ||
      !witnessedADifference(witness) ||
      mutant.path === undefined ||
      mutant.line === undefined ||
      mutant.operator === undefined ||
      mutant.before === undefined ||
      mutant.after === undefined
    ) {
      continue;
    }
    mutation.push({
      path: mutant.path,
      line: mutant.line,
      operator: mutant.operator,
      before: mutant.before,
      after: mutant.after,
      witness: witness as MutantFinding["witness"],
    });
  }
  return { measured: true, reach, mutation };
}

export function findingCount(reading: SignalReading, kinds: readonly SignalKind[]): number {
  return kinds.reduce((total, kind) => total + reading[kind].length, 0);
}

/**
 * Both sides of one comparison under one naming.
 *
 * A reach finding is named by its file and the text of its line where both readings carry every
 * text, and by its line number otherwise, since naming the two sides differently would make every
 * finding look replaced. A mutant is named by its file, the text of the line it changed and its
 * operator, which it always carries. Twins on one file are numbered among themselves.
 */
export function comparedFindings(
  before: SignalReading,
  after: SignalReading,
  kinds: readonly SignalKind[],
): { identity: "line-text" | "line-number"; before: Finding[]; after: Finding[] } {
  const byText =
    !kinds.includes("reach") ||
    [...before.reach, ...after.reach].every((finding) => finding.text !== null);
  const name = (reading: SignalReading): Finding[] => {
    const seen = new Map<string, number>();
    const numbered = (key: string) => {
      const nth = (seen.get(key) ?? 0) + 1;
      seen.set(key, nth);
      return `${key}#${nth}`;
    };
    const named: Finding[] = [];
    if (kinds.includes("reach")) {
      for (const finding of reading.reach) {
        const key = byText
          ? `reach:${finding.path}:${digestOfBytes(finding.text ?? "").slice(7, 23)}`
          : `reach:${finding.path}:L${finding.line}`;
        named.push({
          id: numbered(key),
          kind: "unreached-line",
          path: finding.path,
          line: finding.line,
        });
      }
    }
    if (kinds.includes("mutation")) {
      for (const finding of reading.mutation) {
        const key = `mutant:${finding.path}:${digestOfBytes(finding.before.trim()).slice(7, 23)}:${finding.operator}`;
        named.push({
          id: numbered(key),
          kind: "accepted-mutant",
          path: finding.path,
          line: finding.line,
        });
      }
    }
    return named;
  };
  return {
    identity: byText ? "line-text" : "line-number",
    before: name(before),
    after: name(after),
  };
}

export const studyProgressSchema = repairProgressSchema
  .omit({ comparedWithStep: true })
  .extend({ comparedWith: z.union([z.literal("fork"), z.number().int().nonnegative()]) });
export type StudyProgress = z.infer<typeof studyProgressSchema>;

/** Two measured readings and two stored patches, as a relation; null where either is unmeasured. */
export function progressBetween(input: {
  readonly comparedWith: "fork" | number;
  readonly kinds: readonly SignalKind[];
  readonly before: {
    readonly patchDigest: string;
    readonly signals: SignalReading;
    readonly files?: readonly PatchFile[] | undefined;
  };
  readonly after: {
    readonly patchDigest: string;
    readonly signals: SignalReading;
    readonly files?: readonly PatchFile[] | undefined;
  };
}): StudyProgress | null {
  if (!input.before.signals.measured || !input.after.signals.measured) return null;
  const named = comparedFindings(input.before.signals, input.after.signals, input.kinds);
  const { comparedWithStep: _step, ...progress } = repairProgress({
    comparedWithStep: 0,
    findingIdentity: named.identity,
    before: {
      patchDigest: input.before.patchDigest,
      findings: named.before,
      files: input.before.files,
    },
    after: {
      patchDigest: input.after.patchDigest,
      findings: named.after,
      files: input.after.files,
    },
  });
  return studyProgressSchema.parse({ ...progress, comparedWith: input.comparedWith });
}

// ---------------------------------------------------------------------------------------------
// What is recorded after every invocation.

const studyMutantSchema = z.object({
  id: z.string(),
  verdict: z.string(),
  path: z.string().optional(),
  line: z.number().int().optional(),
  operator: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  witness: z.string().optional(),
});

export const studyVerdictSchema = z.object({
  regression: z.enum(["pass", "fail", "unmeasured"]),
  task: z.enum(["accepted", "rejected", "unjudged", "vacuous"]),
  oracleReach: z.enum(["reached", "unreached", "unmeasured"]).optional(),
  unreachedByOracle: z
    .array(z.object({ path: z.string(), lines: z.array(z.number().int()) }))
    .optional(),
  setAsideByReach: z.array(z.object({ path: z.string(), reason: z.string() })).optional(),
  oracleBond: z.enum(["held", "vacuous", "unshown", "not-bonded"]).optional(),
  /** Every mutant built, whole, so a finding can be re-derived from the row and not only read. */
  bondedMutants: z.array(studyMutantSchema).optional(),
  verified: z.boolean().optional(),
  applied: z.boolean().optional(),
  refusal: z.string().nullable().optional(),
  judgeFailure: z.string().optional(),
});

const studyObservationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no-change") }),
  z.object({ kind: z.literal("judged"), verdict: studyVerdictSchema }),
]);

export const attributionSchema = z.discriminatedUnion("to", [
  z.object({ to: z.literal("agent") }),
  z.object({
    to: z.literal("infrastructure"),
    reason: z.enum([
      "endpoint-not-generating",
      "no-model-call-answered",
      "invocation-killed-at-deadline",
      "no-session-recorded",
    ]),
    detail: z.string(),
  }),
]);

/**
 * Whether anything the invocation's session holds names a place the held-back half lives: the
 * mined checkouts, whose history holds the pull request's test file, or the driver's own stores
 * outside this workspace. Read from every payload of the session, tool calls and their outputs
 * alike. `checked: false` where the session could not be read, which is not a clean result.
 */
export const blindingAuditSchema = z.object({
  checked: z.boolean(),
  references: z.array(z.string()),
});
export type BlindingAudit = z.infer<typeof blindingAuditSchema>;

export const studyInvocationSchema = invocationSchema.extend({
  blinding: blindingAuditSchema.optional(),
});
export type StudyInvocation = AgentInvocation & { readonly blinding?: BlindingAudit };

export const studyStepSchema = z.object({
  phase: z.enum(["prefix", "repair"]),
  ordinal: z.number().int().positive(),
  promptDigest: z.string().regex(digestPattern),
  feedbackDigest: z.string().regex(digestPattern).nullable(),
  invocation: studyInvocationSchema,
  patch: patchSnapshotSchema,
  observation: studyObservationSchema,
  signals: signalReadingSchema,
  judgeWallMs: z.number().nonnegative(),
  attribution: attributionSchema,
  scope: stepScopeSchema.optional(),
  /**
   * Against the step before it that is read as the agent's, or against the fork for an arm's
   * first step, over the finding kinds the arm is described by. Null where either side is
   * unmeasured, or on a prefix's first step.
   */
  progress: studyProgressSchema.nullable(),
});
export type StudyStep = z.infer<typeof studyStepSchema>;

function recorded(verdict: HalfVerdict): z.infer<typeof studyVerdictSchema> {
  return studyVerdictSchema.parse({
    regression: verdict.regression,
    task: verdict.task,
    oracleReach: verdict.oracleReach,
    unreachedByOracle: verdict.unreachedByOracle,
    setAsideByReach: verdict.setAsideByReach,
    oracleBond: verdict.oracleBond,
    bondedMutants: verdict.bondedMutants?.map((one) => ({
      id: one.id,
      verdict: one.verdict,
      path: one.path,
      line: one.line,
      operator: one.operator,
      before: one.before,
      after: one.after,
      witness: one.witness,
    })),
    verified: verdict.verified,
    applied: verdict.applied,
    refusal: verdict.refusal,
    judgeFailure: verdict.judgeFailure,
  });
}

/** The observation as recorded, read back as the shape the stop rules and prompts read. */
export function observationOf(step: Pick<StudyStep, "observation">): VisibleObservation {
  return step.observation.kind === "judged"
    ? { kind: "judged", verdict: step.observation.verdict as HalfVerdict }
    : { kind: "no-change" };
}

/** Visible acceptance and the repository's own checks both hold, which is where a prefix stops. */
export function visibleHolds(observation: VisibleObservation): boolean {
  return mayStop("control", observation);
}

// ---------------------------------------------------------------------------------------------
// Prompts.

function lostLines(policy: FeedbackStudyPolicyId, observation: VisibleObservation): string[] {
  const text = feedbackStudyPolicies[policy].lost;
  if (observation.kind === "no-change") return [text.lead, text.empty];
  const { verdict } = observation;
  const lines: string[] = [];
  if (verdict.regression === "fail") lines.push(text.regressionFails);
  if (verdict.regression === "unmeasured") lines.push(text.regressionUnmeasured);
  if (verdict.task !== "accepted") lines.push(text.acceptanceFails);
  return lines.length === 0 ? [] : [text.lead, ...lines];
}

function reachLines(findings: readonly ReachFinding[]): string[] {
  const byPath = new Map<string, number[]>();
  for (const finding of findings) {
    byPath.set(finding.path, [...(byPath.get(finding.path) ?? []), finding.line]);
  }
  return [...byPath].map(([path, lines]) => `  ${path}: ${lines.join(", ")}`);
}

function mutantLines(findings: readonly MutantFinding[]): string[] {
  return findings.map((finding) => {
    // A deleted statement is blanked rather than removed, so its after-text is empty.
    const change =
      finding.after.trim().length === 0
        ? `\`${finding.before.trim()}\` was deleted`
        : `\`${finding.before.trim()}\` became \`${finding.after.trim()}\``;
    return `  ${finding.path} line ${finding.line} (${finding.operator}): ${change}`;
  });
}

/**
 * The feedback part of one repair prompt: the neutral review instruction every arm receives, the
 * status lines every arm receives where the last revision lost visible acceptance, and then only
 * the findings this arm is sent, as they stand after the last revision.
 */
export function reviewFeedback(input: {
  readonly policy: FeedbackStudyPolicyId;
  readonly arm: StudyArm;
  readonly observation: VisibleObservation;
  readonly signals: SignalReading;
}): string {
  const text = feedbackStudyPolicies[input.policy];
  const sections: string[] = [text.review];
  const lost = lostLines(input.policy, input.observation);
  if (lost.length > 0) sections.push(lost.join("\n"));
  const received = signalsReceivedBy[input.arm].filter(
    (kind) => input.signals.measured && input.signals[kind].length > 0,
  );
  if (received.length > 0) {
    const blocks: string[] = [text.findings];
    if (received.includes("reach")) {
      blocks.push(
        [
          text.reach.heading,
          text.reach.lead,
          ...reachLines(input.signals.reach),
          text.reach.instruction,
        ].join("\n"),
      );
    }
    if (received.includes("mutation")) {
      blocks.push(
        [
          text.mutation.heading,
          text.mutation.lead,
          ...mutantLines(input.signals.mutation),
          text.mutation.instruction,
        ].join("\n"),
      );
    }
    sections.push(blocks.join("\n\n"));
  }
  return sections.join("\n\n");
}

/** The task statement first and unchanged, then the review, as every repair invocation reads it. */
export function reviewPrompt(taskText: string, feedback: string): string {
  return `${taskText}\n\n${feedback}`;
}

// ---------------------------------------------------------------------------------------------
// Running one prefix and one arm, with every effect injected.

export interface StudyEffects {
  readonly invokeAgent: (prompt: string) => Promise<StudyInvocation>;
  /** The workspace's whole diff against the base, stored by content address. */
  readonly snapshot: () => Promise<TakenSnapshot>;
  /** The visible check and the repository's own checks over one stored patch. */
  readonly judgeVisible: (patch: PatchSnapshot) => Promise<HalfVerdict>;
  /** A bounded completion from the configured model, asked after every invocation. */
  readonly endpointGenerates: () => Promise<GenerationProbe>;
  /**
   * Whether the invocation is a real agent whose process outcome bears on attribution. A scripted
   * stand-in calls no model and leaves no session, and that is not an infrastructure failure.
   */
  readonly realAgent: boolean;
  readonly now: () => number;
}

interface AgentStep {
  readonly index: number;
  readonly snapshot: TakenSnapshot;
  readonly observation: VisibleObservation;
  readonly signals: SignalReading;
}

async function takeStep(input: {
  readonly phase: StudyStep["phase"];
  readonly ordinal: number;
  readonly taskText: string;
  readonly feedback: string | null;
  readonly promptOf: (taskText: string, feedback: string) => string;
  readonly effects: StudyEffects;
  readonly steps: StudyStep[];
  readonly earlier: AgentStep | null;
  readonly comparedWith: "fork" | number | null;
  readonly kinds: readonly SignalKind[];
}): Promise<{ readonly step: AgentStep; readonly stopped: string | null }> {
  const { effects } = input;
  const prompt =
    input.feedback === null ? input.taskText : input.promptOf(input.taskText, input.feedback);
  const invocation = await effects.invokeAgent(prompt);
  const snapshot = await effects.snapshot();
  const judgeStarted = effects.now();
  // Asked after every invocation, whatever it left: a server that died halfway through leaves the
  // earlier patch in place, and reading that as the model's answer is the misattribution to avoid.
  const attribution = attributeInvocation({
    probe: await effects.endpointGenerates(),
    calls: invocation.usage,
    ...(effects.realAgent
      ? { process: { timedOut: invocation.timedOut, runId: invocation.runId } }
      : {}),
  });
  const stopped = attribution.to === "infrastructure" ? attribution.detail : null;
  let observation: VisibleObservation = { kind: "no-change" };
  if (stopped === null && snapshot.digest !== emptyPatchDigest) {
    observation = { kind: "judged", verdict: await effects.judgeVisible(snapshot) };
  }
  const signals = signalsOf(observation, snapshot.lineText);
  const index = input.steps.length;
  const progress =
    stopped === null && input.earlier !== null && input.comparedWith !== null
      ? progressBetween({
          comparedWith: input.comparedWith,
          kinds: input.kinds,
          before: {
            patchDigest: input.earlier.snapshot.digest,
            signals: input.earlier.signals,
            files: input.earlier.snapshot.files,
          },
          after: { patchDigest: snapshot.digest, signals, files: snapshot.files },
        })
      : null;
  input.steps.push(
    studyStepSchema.parse({
      phase: input.phase,
      ordinal: input.ordinal,
      promptDigest: digestOfBytes(prompt),
      feedbackDigest: input.feedback === null ? null : digestOfBytes(input.feedback),
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
      signals,
      judgeWallMs: effects.now() - judgeStarted,
      attribution,
      ...scopeOf(invocation.fileSet, snapshot.files, input.earlier?.snapshot.files),
      progress,
    }),
  );
  return { step: { index, snapshot, observation, signals }, stopped };
}

/** An oracle that gave no verdict, or that accepts the base, judged nothing about this patch. */
function couldNotJudge(observation: VisibleObservation): string | null {
  if (observation.kind !== "judged") return null;
  if (observation.verdict.task === "vacuous") {
    return "the visible check accepts the base commit as well";
  }
  return whyNothingWasJudged(observation.verdict);
}

export const prefixStatuses = [
  "accepted",
  "prefix-not-accepted",
  "unjudgeable",
  "infrastructure-failure",
] as const;

export const eligibilitySchema = z.object({
  eligible: z.boolean(),
  /** Why not, in words, where it is not. */
  reason: z.string().nullable(),
  /** The arms that run, in the order the driver dispatches them. Empty where not eligible. */
  arms: z.array(z.enum(studyArms)),
  dualTrigger: z.boolean(),
});
export type Eligibility = z.infer<typeof eligibilitySchema>;

export const prefixRecordSchema = z.object({
  status: z.enum(prefixStatuses),
  detail: z.string().nullable(),
  steps: z.array(studyStepSchema),
  /** The prefix's frozen state, the parent of every arm. Null unless visibly accepted. */
  frozen: z
    .object({
      step: z.number().int().nonnegative(),
      patchDigest: z.string().regex(digestPattern),
      /** `git write-tree` over everything the workspace holds that the diff does. */
      treeDigest: z.string().min(1),
      runId: z.string().nullable(),
      ledgerDigest: z.string().regex(digestPattern).nullable(),
    })
    .nullable(),
  /** The last patch the prefix left, accepted or not. */
  finalPatchDigest: z.string().regex(digestPattern),
  eligibility: eligibilitySchema,
});
export type PrefixRecord = z.infer<typeof prefixRecordSchema>;

/**
 * Which arms a visibly accepted prefix earns, from facts that exist without any held-back run.
 *
 * Whether the held-back half will produce a verdict is not asked here: asking means running it.
 * That the half exists and its file matches the frozen digest is what the driver checks, and a
 * held-back verdict that turns out unjudgeable removes the pair later, by name.
 */
export function eligibilityOf(input: {
  readonly observation: VisibleObservation;
  readonly signals: SignalReading;
  readonly heldBackAvailable: boolean;
  readonly order: (arms: readonly StudyArm[]) => readonly StudyArm[];
}): Eligibility {
  const none = (reason: string): Eligibility => ({
    eligible: false,
    reason,
    arms: [],
    dualTrigger: false,
  });
  if (!visibleHolds(input.observation)) return none("the prefix is not visibly accepted");
  if (!input.heldBackAvailable) return none("the held-back half is not available");
  if (!input.signals.measured)
    return none("no-eligible-signal: the verifier could not read either finding");
  const reach = input.signals.reach.length > 0;
  const mutation = input.signals.mutation.length > 0;
  if (!reach && !mutation) return none("no-eligible-signal: neither finding is present");
  const arms: StudyArm[] = ["neutral"];
  if (reach) arms.push("reach");
  if (mutation) arms.push("mutation");
  arms.push("combined");
  return {
    eligible: true,
    reason: null,
    arms: [...input.order(arms)],
    dualTrigger: reach && mutation,
  };
}

/**
 * The prefix: from the base commit until visible acceptance or the budget runs out.
 *
 * Its feedback is the reach-pressure run's control feedback and nothing else. A patch can fail
 * the repository's checks while its oracle accepts and leaves lines unreached, and naming those
 * lines here would start a treatment before the fork every arm shares.
 */
export async function runPrefix(input: {
  readonly task: AgentVisibleTask;
  readonly prefixInvocations: number;
  readonly effects: StudyEffects;
  readonly heldBackAvailable: boolean;
  readonly treeDigest: () => Promise<string>;
  readonly order: (arms: readonly StudyArm[]) => readonly StudyArm[];
}): Promise<PrefixRecord> {
  const steps: StudyStep[] = [];
  const notEligible = (reason: string): Eligibility => ({
    eligible: false,
    reason,
    arms: [],
    dualTrigger: false,
  });
  const ended = (
    status: PrefixRecord["status"],
    detail: string | null,
    rest: Pick<PrefixRecord, "frozen" | "eligibility">,
  ): PrefixRecord =>
    prefixRecordSchema.parse({
      status,
      detail,
      steps,
      finalPatchDigest: steps.at(-1)?.patch.digest ?? emptyPatchDigest,
      ...rest,
    });

  let feedback: string | null = null;
  let earlier: AgentStep | null = null;
  for (let ordinal = 1; ordinal <= input.prefixInvocations; ordinal += 1) {
    const { step, stopped } = await takeStep({
      phase: "prefix",
      ordinal,
      taskText: input.task.taskText,
      feedback,
      promptOf: repairPrompt,
      effects: input.effects,
      steps,
      earlier,
      comparedWith: earlier?.index ?? null,
      kinds: ["reach", "mutation"],
    });
    if (stopped !== null) {
      return ended("infrastructure-failure", stopped, {
        frozen: null,
        eligibility: notEligible("the prefix ended on an infrastructure failure"),
      });
    }
    earlier = step;
    const unjudged = couldNotJudge(step.observation);
    if (unjudged !== null) {
      return ended("unjudgeable", unjudged, {
        frozen: null,
        eligibility: notEligible(`unjudgeable: ${unjudged}`),
      });
    }
    if (visibleHolds(step.observation)) {
      const invocation = steps[step.index]?.invocation;
      return ended("accepted", null, {
        frozen: {
          step: step.index,
          patchDigest: step.snapshot.digest,
          treeDigest: await input.treeDigest(),
          runId: invocation?.runId ?? null,
          ledgerDigest: invocation?.ledgerDigest ?? null,
        },
        eligibility: eligibilityOf({
          observation: step.observation,
          signals: step.signals,
          heldBackAvailable: input.heldBackAvailable,
          order: input.order,
        }),
      });
    }
    feedback = refusalFeedback("control", step.observation);
  }
  return ended("prefix-not-accepted", null, {
    frozen: null,
    eligibility: notEligible("the prefix is not visibly accepted"),
  });
}

export const armTerminals = [
  "repaired-signal-cleared",
  /** The finding set came back empty on a byte-identical patch: the verifier moved, not the code. */
  "signal-cleared-without-change",
  "repair-exhausted-no-change",
  "repair-exhausted-same-findings",
  "repair-exhausted-findings-shrank",
  "repair-exhausted-findings-changed",
  "repair-exhausted-findings-expanded",
  /** The final patch no longer passes the visible check or the repository's own checks. */
  "repair-lost-visible-acceptance",
  /** Visible acceptance holds and the verifier could not read the findings on the final patch. */
  "signal-unmeasured-after-repair",
  "unjudgeable",
  "infrastructure-failure",
] as const;
export type ArmTerminal = (typeof armTerminals)[number];

/** The fork every arm starts from, as the prefix recorded it. */
export interface ArmFork {
  readonly patchDigest: string;
  readonly files?: readonly PatchFile[] | undefined;
  readonly observation: VisibleObservation;
  readonly signals: SignalReading;
}

/**
 * What an arm's final state is, against the fork, over the finding kinds it is described by.
 *
 * A byte-identical patch is read first: whatever the verifier says about it the second time, the
 * agent changed nothing, and a finding that vanished from an unchanged patch is the verifier's
 * movement and is named as that. Then whether visible acceptance survived, since a patch the
 * visible check refuses has no findings to read. Then the findings themselves.
 */
export function armTerminal(input: {
  readonly arm: StudyArm;
  readonly fork: ArmFork;
  readonly final: {
    readonly patchDigest: string;
    readonly files?: readonly PatchFile[] | undefined;
    readonly observation: VisibleObservation;
    readonly signals: SignalReading;
  };
}): { readonly status: ArmTerminal; readonly progress: StudyProgress | null } {
  const kinds = signalsClassifiedBy[input.arm];
  const progress = progressBetween({
    comparedWith: "fork",
    kinds,
    before: {
      patchDigest: input.fork.patchDigest,
      signals: input.fork.signals,
      files: input.fork.files,
    },
    after: {
      patchDigest: input.final.patchDigest,
      signals: input.final.signals,
      files: input.final.files,
    },
  });
  const cleared = input.final.signals.measured && findingCount(input.final.signals, kinds) === 0;
  if (input.final.patchDigest === input.fork.patchDigest) {
    return {
      status:
        cleared && visibleHolds(input.final.observation)
          ? "signal-cleared-without-change"
          : "repair-exhausted-no-change",
      progress,
    };
  }
  if (!visibleHolds(input.final.observation))
    return { status: "repair-lost-visible-acceptance", progress };
  if (!input.final.signals.measured || progress === null) {
    return { status: "signal-unmeasured-after-repair", progress };
  }
  if (cleared) return { status: "repaired-signal-cleared", progress };
  const status: ArmTerminal =
    progress.relation === "findings-identical"
      ? "repair-exhausted-same-findings"
      : progress.relation === "findings-shrank"
        ? "repair-exhausted-findings-shrank"
        : progress.relation === "findings-grew"
          ? "repair-exhausted-findings-expanded"
          : "repair-exhausted-findings-changed";
  return { status, progress };
}

/**
 * Whether an arm may stop before its budget is spent: visible acceptance holds, the repository's
 * checks pass, and every finding it is sent is gone. The neutral arm has none and always runs its
 * whole budget, which is the compute a treatment is compared against.
 */
export function armMayStop(
  arm: StudyArm,
  observation: VisibleObservation,
  signals: SignalReading,
): boolean {
  if (signalsReceivedBy[arm].length === 0) return false;
  return (
    visibleHolds(observation) &&
    signals.measured &&
    findingCount(signals, signalsReceivedBy[arm]) === 0
  );
}

/** The metrics field of a synthetic snapshot of the fork, which no comparison reads. */
const emptyMetrics = {
  filesChanged: 0,
  sourceFilesChanged: 0,
  testFilesChanged: 0,
  addedLines: 0,
  deletedLines: 0,
  executableAddedLines: 0,
  executableDeletedLines: 0,
  testAddedLines: 0,
  diffBytes: 0,
};

export const armRecordSchema = z.object({
  arm: z.enum(studyArms),
  status: z.enum(armTerminals),
  detail: z.string().nullable(),
  /** The fork's patch, which the driver verified the arm's workspace held before anything ran. */
  forkPatchDigest: z.string().regex(digestPattern),
  steps: z.array(studyStepSchema),
  /** The patch the arm ended on. Null where it ended on an infrastructure failure or unjudged. */
  final: z
    .object({ patchDigest: z.string().regex(digestPattern), step: z.number().int().nonnegative() })
    .nullable(),
  repairs: z.number().int().nonnegative(),
  /** Fork to final over the arm's own description, and per finding kind for the two-kind arms. */
  outcome: studyProgressSchema.nullable(),
  perKind: z.object({
    reach: studyProgressSchema.nullable(),
    mutation: studyProgressSchema.nullable(),
  }),
});
export type ArmRecord = z.infer<typeof armRecordSchema>;

/**
 * One arm, from the fork to a terminal status. Each invocation is judged exactly as the prefix
 * was, and the next prompt carries the findings this arm is sent as they stand after it.
 */
export async function runArm(input: {
  readonly task: AgentVisibleTask;
  readonly arm: StudyArm;
  readonly policy: FeedbackStudyPolicyId;
  readonly repairInvocations: number;
  readonly fork: ArmFork;
  readonly effects: StudyEffects;
}): Promise<ArmRecord> {
  const { arm, fork } = input;
  const steps: StudyStep[] = [];
  const kinds = signalsClassifiedBy[arm];
  const ended = (
    status: ArmTerminal,
    detail: string | null,
    final: {
      patchDigest: string;
      files?: readonly PatchFile[] | undefined;
      step: number;
      observation: VisibleObservation;
      signals: SignalReading;
    } | null,
    progress: StudyProgress | null,
  ): ArmRecord => {
    const perKind = (kind: SignalKind) =>
      final === null
        ? null
        : progressBetween({
            comparedWith: "fork",
            kinds: [kind],
            before: { patchDigest: fork.patchDigest, signals: fork.signals, files: fork.files },
            after: { patchDigest: final.patchDigest, signals: final.signals, files: final.files },
          });
    return armRecordSchema.parse({
      arm,
      status,
      detail,
      forkPatchDigest: fork.patchDigest,
      steps,
      final: final === null ? null : { patchDigest: final.patchDigest, step: final.step },
      repairs: steps.length,
      outcome: progress,
      perKind: { reach: perKind("reach"), mutation: perKind("mutation") },
    });
  };

  let earlier: AgentStep | null = null;
  let observation = fork.observation;
  let signals = fork.signals;
  for (let ordinal = 1; ordinal <= input.repairInvocations; ordinal += 1) {
    const feedback = reviewFeedback({ policy: input.policy, arm, observation, signals });
    const { step, stopped } = await takeStep({
      phase: "repair",
      ordinal,
      taskText: input.task.taskText,
      feedback,
      promptOf: reviewPrompt,
      effects: input.effects,
      steps,
      earlier:
        earlier ??
        ({
          index: -1,
          snapshot: {
            digest: fork.patchDigest,
            metrics: emptyMetrics,
            ...(fork.files === undefined ? {} : { files: [...fork.files] }),
          },
          observation: fork.observation,
          signals: fork.signals,
        } satisfies AgentStep),
      comparedWith: earlier === null ? "fork" : earlier.index,
      kinds,
    });
    if (stopped !== null) return ended("infrastructure-failure", stopped, null, null);
    const unjudged = couldNotJudge(step.observation);
    if (unjudged !== null) return ended("unjudgeable", unjudged, null, null);
    earlier = step;
    observation = step.observation;
    signals = step.signals;
    if (armMayStop(arm, observation, signals)) break;
  }
  if (earlier === null) throw new Error("an arm with a positive budget ran no invocation");
  const final = {
    patchDigest: earlier.snapshot.digest,
    files: earlier.snapshot.files,
    step: earlier.index,
    observation: earlier.observation,
    signals: earlier.signals,
  };
  const terminal = armTerminal({ arm, fork, final });
  return ended(terminal.status, null, final, terminal.progress);
}

/**
 * The order an eligible pair's arms run in, fixed by a digest of the model, the task and the arm,
 * so it is neither the same for every pair nor chosen by anybody, and a resume reproduces it.
 */
export function armOrder(model: string, taskId: string, arms: readonly StudyArm[]): StudyArm[] {
  return [...arms].sort((left, right) => {
    const one = digestOfBytes(`${model}\n${taskId}\n${left}`);
    const other = digestOfBytes(`${model}\n${taskId}\n${right}`);
    return one < other ? -1 : one > other ? 1 : 0;
  });
}
