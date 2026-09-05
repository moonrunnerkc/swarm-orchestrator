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

interface VerdictInput {
  readonly cycle: GateCycle;
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
}

export function runVerdict(input: VerdictInput): RunVerdict {
  const runs = input.cycle.runs as unknown as readonly CapabilityRun[];
  const changed = input.cycle.measures.changedFiles ?? 0;

  const mechanical = judge(runs, "static");
  const policy = judge(runs, "policy");
  const behavioral = judge(runs, "dynamic");

  const executed = changed === 0 || behavioral.answer === "pass";
  const blockingFailed = input.cycle.blockingFailures.length > 0;

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
    humanApproval: input.humanApproval ?? "not-required",
    reasons: {
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
      signer:
        input.signer === "trusted"
          ? "the bundle was signed by a key the trust policy names"
          : "no expected signer was matched, so the signature shows the bundle is unchanged " +
            "since it was written and not who wrote it",
    },
    acceptable: !blockingFailed && policy.answer !== "fail" && executed,
  };
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
