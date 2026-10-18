import { z } from "zod";
import type { GateCapability } from "../gates/gate-capability.ts";
import type { GateCycle } from "../gates/gate-runner.ts";
import type { SignerVerdict } from "./signer-trust.ts";

/**
 * What a run establishes, as more than one answer.
 *
 * A single `green: boolean` has to flatten states that are not the same finding, and the two
 * it flattens worst are "checked and failed" and "nobody checked". Those call for different
 * things from a reader: one is a defect to fix, the other is a gap to close, and reporting a
 * gap as a pass is how a change nothing executed came to read green.
 *
 * So every dimension carries `unmeasured` as a first-class value, and nothing here coerces it
 * in either direction. `acceptable` is the one derived boolean, and it says what it requires.
 */
export type Measured = "pass" | "fail" | "unmeasured";

export interface RunVerdict {
  readonly version: 1;
  /** Whether the chain rehashes and the signature over its head verifies. */
  readonly integrity: "valid" | "invalid" | "unverified";
  /** Who signed it, which a bundle cannot establish about itself. */
  readonly signer: SignerVerdict;
  /** What stood between a command and the machine, measured by the containment self-test. */
  readonly executionTrust: "isolated" | "restricted" | "unsafe" | "unknown";
  /** Secrets, placeholders, the declared file set, the diff budget. */
  readonly policy: Measured;
  /** The source parses and type-checks. Never evidence that any of it ran. */
  readonly mechanical: Measured;
  /** Something executed the changed code and it passed. */
  readonly behavioral: Measured;
  /** Whether the change means what the task asked for. Nothing here can measure this. */
  readonly semantic: Measured;
  /** Whether a trusted task oracle accepted it. Nothing assembles one today. */
  readonly task: "accepted" | "rejected" | "unjudged";
  readonly humanApproval: "approved" | "rejected" | "required" | "not-required";
  readonly reasons: Readonly<Record<string, string>>;
  /**
   * The one derived boolean, and it is derived rather than reported: no blocking gate failed,
   * no policy gate failed, and the change was executed by something. It is deliberately not
   * called "green": it does not mean the change is right, and no number here could.
   */
  readonly acceptable: boolean;
}

export const runVerdictSchema = z.strictObject({
  version: z.literal(1),
  integrity: z.enum(["valid", "invalid", "unverified"]),
  signer: z.enum(["trusted", "untrusted", "invalid", "unverified"]),
  executionTrust: z.enum(["isolated", "restricted", "unsafe", "unknown"]),
  policy: z.enum(["pass", "fail", "unmeasured"]),
  mechanical: z.enum(["pass", "fail", "unmeasured"]),
  behavioral: z.enum(["pass", "fail", "unmeasured"]),
  semantic: z.enum(["pass", "fail", "unmeasured"]),
  task: z.enum(["accepted", "rejected", "unjudged"]),
  humanApproval: z.enum(["approved", "rejected", "required", "not-required"]),
  reasons: z.record(z.string(), z.string()),
  acceptable: z.boolean(),
});

interface VerdictInput {
  readonly cycle: GateCycle;
  readonly assessment?: {
    readonly requiredChecks?: readonly string[] | undefined;
    readonly lifecycle: string;
    readonly cancelled: boolean;
    readonly settled: string;
    readonly baseRatchetAccepted: boolean;
    readonly vacuousBlockingBonds: readonly string[];
    readonly changedFiles: number;
    /** Advisory demands answered by a verified worker claim: the gate record and the claim. */
    readonly justifications?:
      | readonly { readonly gateRecord: string; readonly claimRecord: string }[]
      | undefined;
  };
  /** Approvals the run's spec said it would need, and whether they were given. */
  readonly approvals?: {
    readonly required: readonly string[];
    readonly granted: readonly string[];
  };
  readonly integrity: RunVerdict["integrity"];
  readonly signer: SignerVerdict;
  readonly executionTrust: RunVerdict["executionTrust"];
  readonly task?: RunVerdict["task"];
  readonly humanApproval?: RunVerdict["humanApproval"];
}

interface CapabilityRun {
  readonly gateId: string;
  readonly capability: GateCapability;
  readonly status: "passed" | "failed" | "not-applicable";
  readonly severity: "blocking" | "advisory";
  readonly detail: string;
  readonly record: string;
  readonly measures: Readonly<Record<string, number>>;
}

/** What an accepted worker assessment says. A final verification may still refuse the work. */
export const acceptedAssessmentReason =
  "every acceptance condition held: the blocking gates, policy, execution, final ratchet and bonds";
/** The same, in the words assessments recorded before the conditions were listed together. */
const legacyAcceptedAssessmentReason = "final ratchet and bonds accepted the completed work";

/**
 * The reason a refused verdict should be read for. Where the worker's own assessment accepted
 * the work and something after it (the final verification) refused, the assessment reason is
 * an acceptance, so the task reason names the blocker instead.
 */
export function blockingReason(verdict: RunVerdict): string {
  const assessment = verdict.reasons.assessment;
  const accepted =
    assessment === acceptedAssessmentReason || assessment === legacyAcceptedAssessmentReason;
  return (
    (accepted ? verdict.reasons.task : assessment) ??
    verdict.reasons.task ??
    "no blocking reason was recorded"
  );
}

export function runVerdict(input: VerdictInput): RunVerdict {
  const runs = input.cycle.runs as unknown as readonly CapabilityRun[];
  const changed = input.cycle.measures.changedFiles ?? 0;
  const justified = new Map(
    (input.assessment?.justifications ?? []).map((one) => [one.gateRecord, one.claimRecord]),
  );

  const mechanical = judge(runs, "static");
  const policy = judgePolicy(runs, justified);
  const behavioral = judge(runs, "dynamic");

  const executed = changed === 0 || behavioral.answer === "pass";
  const approval = input.humanApproval ?? approvalStateOf(input.approvals);
  const complete = input.assessment;
  const unmetChecks = (complete?.requiredChecks ?? []).filter(
    (id) => !runs.some((run) => run.gateId === id && run.status === "passed"),
  );
  // One list of what stands between the work and acceptance. `acceptable` is its emptiness and
  // the assessment reason is its text, so a refusal always names the condition that refused:
  // the two were computed apart, and an advisory budget refused a run whose stated reason was
  // that everything had been accepted.
  const refusals = [
    ...(complete === undefined ? [] : assessmentRefusals(complete, unmetChecks)),
    ...(input.cycle.blockingFailures.length === 0
      ? []
      : [
          `blocking gate(s) failed: ${input.cycle.blockingFailures.map((run) => run.gateId).join(", ")}`,
        ]),
    ...policy.refusals,
    // A dynamic gate that failed executed the change: "nothing executed the change: tests
    // failed" told a reader, and a JSON consumer, the opposite of what happened.
    ...(executed
      ? []
      : behavioral.answer === "fail"
        ? [`the change was executed and failed: ${behavioral.reason}`]
        : [`nothing executed the change: ${behavioral.reason}`]),
    ...(input.task === "rejected" ? ["the task oracle rejected the change"] : []),
    ...(approval === "required"
      ? [`approval still required: ${describeApprovals(input.approvals)}`]
      : []),
    ...(approval === "rejected" ? ["a person rejected the change"] : []),
  ];
  return {
    version: 1,
    integrity: input.integrity,
    signer: input.signer,
    executionTrust: input.executionTrust,
    policy: policy.answer,
    mechanical: mechanical.answer,
    behavioral: behavioral.answer,
    // A judgement about meaning. The build guide's non-goals rule out an LLM judge as an
    // authority, and no number tells doing the whole task from doing the minimum that passes
    // its own tests, so this abstains by construction rather than by accident.
    semantic: "unmeasured",
    task: input.task ?? "unjudged",
    humanApproval: approval,
    reasons: {
      assessment:
        refusals.length > 0
          ? refusals.join("; ")
          : complete === undefined
            ? "legacy cycle-only assessment"
            : acceptedAssessmentReason,
      mechanical: mechanical.reason,
      policy: policy.reason,
      behavioral: behavioral.reason,
      semantic:
        "no check here judges whether the change means what the task asked for, and nothing " +
        "in this system is allowed to: a model's opinion is not a verdict",
      task: "no trusted task oracle was configured for this run",
      executionTrust:
        input.executionTrust === "isolated"
          ? "a containment self-test refused every escape it tried"
          : "commands ran under a lexical path and program policy, which is not containment",
      humanApproval: describeApprovals(input.approvals),
      signer:
        input.signer === "trusted"
          ? "the bundle was signed by a key the trust policy names"
          : "no expected signer was matched, so the signature shows the bundle is unchanged " +
            "since it was written and not who wrote it",
    },
    acceptable: refusals.length === 0,
  };
}

/**
 * Policy, with the one way an advisory failure is answered: a gate that demanded a
 * justification and has a verified claim answering it. Every other failed policy gate, blocking
 * or advisory, still fails policy, so a justification never stands in for the secret scan or the
 * declared file set.
 */
function judgePolicy(
  runs: readonly CapabilityRun[],
  justified: ReadonlyMap<string, string>,
): { readonly answer: Measured; readonly reason: string; readonly refusals: readonly string[] } {
  const judged = judge(runs, "policy");
  const failed = runs.filter((run) => run.capability === "policy" && run.status === "failed");
  const answerable = (run: CapabilityRun) =>
    run.severity === "advisory" && run.measures.justificationRequired === 1;
  const answered = failed.filter((run) => answerable(run) && justified.has(run.record));
  const unanswered = failed.filter((run) => answerable(run) && !justified.has(run.record));
  const refused = failed.filter((run) => !answerable(run));
  const refusals = [
    ...unanswered.map(
      (run) =>
        `${run.gateId} asked for a justification and no verified claim cites its record ` +
        `${run.record} (${run.detail})`,
    ),
    ...(refused.length === 0
      ? []
      : [`policy gate(s) failed: ${refused.map((run) => run.gateId).join(", ")}`]),
  ];
  if (failed.length === 0 || failed.length !== answered.length)
    return { answer: judged.answer, reason: judged.reason, refusals };
  const passed = runs.filter((run) => run.capability === "policy" && run.status === "passed");
  return {
    answer: "pass",
    reason:
      `${answered.map((run) => `${run.gateId} over budget, justified by claim ${justified.get(run.record)}`).join("; ")}` +
      (passed.length === 0 ? "" : `; ${passed.map((run) => run.gateId).join(", ")} passed`),
    refusals,
  };
}

/**
 * Outstanding is `required`, not `rejected`: nobody said no, nobody has said yes yet, and
 * flattening the two would let a run that never asked read as one that was refused.
 */
function approvalStateOf(approvals: VerdictInput["approvals"]): RunVerdict["humanApproval"] {
  if (approvals === undefined || approvals.required.length === 0) {
    return "not-required";
  }
  return approvals.required.every((subject) => approvals.granted.includes(subject))
    ? "approved"
    : "required";
}

function describeApprovals(approvals: VerdictInput["approvals"]): string {
  if (approvals === undefined || approvals.required.length === 0) {
    return "this run did nothing that needs a person's decision";
  }
  const outstanding = approvals.required.filter((subject) => !approvals.granted.includes(subject));
  return outstanding.length === 0
    ? `every approval this run needed was given: ${approvals.required.join(", ")}`
    : `still waiting on: ${outstanding.join(", ")}`;
}

function judge(
  runs: readonly CapabilityRun[],
  capability: GateCapability,
): { readonly answer: Measured; readonly reason: string } {
  const mine = runs.filter((run) => run.capability === capability);
  if (mine.length === 0) {
    return { answer: "unmeasured", reason: `no ${capability} gate was assembled for this run` };
  }

  const failed = mine.filter((run) => run.status === "failed");
  if (failed.length > 0) {
    return {
      answer: "fail",
      reason: `${failed.map((run) => run.gateId).join(", ")} failed`,
    };
  }

  const passed = mine.filter((run) => run.status === "passed");
  if (passed.length === 0) {
    return {
      answer: "unmeasured",
      reason:
        capability === "dynamic"
          ? `no dynamic gate ran, so nothing executed the change (${mine
              .map((run) => run.gateId)
              .join(", ")} stood down)`
          : `every ${capability} gate stood down (${mine.map((run) => run.gateId).join(", ")})`,
    };
  }

  return { answer: "pass", reason: `${passed.map((run) => run.gateId).join(", ")} passed` };
}

/** Each dimension with its reason beside it, because a bare word is what this replaces. */
export function describeVerdict(verdict: RunVerdict): readonly string[] {
  const row = (name: string, value: string) => {
    const reason = verdict.reasons[name];
    return `  ${name.padEnd(15)} ${value}${reason === undefined ? "" : `\n${" ".repeat(18)}${reason}`}`;
  };
  return [
    "verdict:",
    row("assessment", verdict.acceptable ? "accepted" : "refused"),
    row("integrity", verdict.integrity),
    row("signer", verdict.signer),
    row("executionTrust", verdict.executionTrust),
    row("policy", verdict.policy),
    row("mechanical", verdict.mechanical),
    row("behavioral", verdict.behavioral),
    row("semantic", verdict.semantic),
    row("task", verdict.task),
    row("humanApproval", verdict.humanApproval),
    "",
    verdict.acceptable
      ? "acceptable: yes (no blocking gate failed, no policy gate failed, and something executed the change)"
      : "acceptable: no",
  ];
}

/**
 * The worker assessment's own conditions, each in the words a person reads and only where it
 * refused. A lifecycle is named only where it is one that refuses: a loop that stopped at its
 * step limit and left green work is not refused for it.
 */
function assessmentRefusals(
  complete: NonNullable<VerdictInput["assessment"]>,
  unmetChecks: readonly string[],
): readonly string[] {
  const refusingLifecycle = ["interrupted", "max-wall-time", "max-tokens"].includes(
    complete.lifecycle,
  );
  return [
    unmetChecks.length > 0 ? `required checks unmet: ${unmetChecks.join(", ")}` : null,
    complete.settled === "green" ? null : `the gates settled ${complete.settled}`,
    refusingLifecycle ? `the run stopped as ${complete.lifecycle}` : null,
    complete.baseRatchetAccepted ? null : "the base ratchet rejected the final state",
    complete.vacuousBlockingBonds.length > 0
      ? `vacuous blocking bonds: ${complete.vacuousBlockingBonds.join(", ")}`
      : null,
    complete.cancelled ? "the run was cancelled" : null,
    complete.changedFiles === 0 && complete.lifecycle !== "completed"
      ? `nothing changed and the run stopped as ${complete.lifecycle}`
      : null,
  ].filter((reason): reason is string => reason !== null);
}
