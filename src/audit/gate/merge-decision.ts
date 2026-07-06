// The two-sided merge decision. AUTO-MERGE is emitted only when the negative
// (cheat) gate is clean AND the positive (merge-safety) gate is all-green with
// no null controls AND the PR is on an execution-groundable language.
// Anything else routes to HUMAN with a recorded reason. The decision is
// fail-closed: an unavailable control (a control that could not run, e.g. a
// falsifier with no configured adapter) is "not proven", never a pass.
//
// This composer is pure: it consumes already-computed control results and the
// negative-gate verdict, and returns the decision. Provisioning, obligation
// execution, and falsifier dispatch happen upstream in the positive-gate
// runner; extracting `negativeGateClean` from the cheat gate happens in the
// CLI wiring. Keeping the composer pure is what makes the AUTO-MERGE / HUMAN
// decision deterministically testable with no LLM and no network.

/** Status of a single positive-gate control. `unavailable` is a null control: not proven. */
export type ControlStatus = 'pass' | 'fail' | 'unavailable';

/** What a control checks, for grouping and reason messages. */
export type ControlKind = 'build' | 'test' | 'obligation' | 'falsifier';

/** One positive-gate control result. */
export interface MergeControl {
  /** Stable id, e.g. "build-must-pass", "test-must-pass", "obligation[2]", "falsifier". */
  readonly id: string;
  readonly kind: ControlKind;
  readonly status: ControlStatus;
  /** Human detail: a verifier `detail` string, a counter-example summary, or why it could not run. */
  readonly detail: string;
}

export type MergeVerdict = 'auto-merge' | 'human';

/** Stable reason codes so tests and downstream tooling assert on codes, not prose. */
export type HumanReasonCode =
  | 'not-execution-groundable'
  | 'negative-gate-blocked'
  | 'positive-control-failed'
  | 'positive-control-unavailable'
  | 'no-controls-ran';

/** A single reason the decision routed to HUMAN. */
export interface HumanReason {
  readonly code: HumanReasonCode;
  readonly detail: string;
}

/** Everything the composer needs to reach a verdict. */
export interface MergeDecisionInput {
  /** Whether the PR's language provisions and runs under the execution-grounded sandbox. */
  readonly egViable: boolean;
  /** Why the PR is not execution-groundable (used only when egViable is false). */
  readonly egViabilityReason: string;
  /** Whether the negative (cheat) gate blocked nothing. */
  readonly negativeGateClean: boolean;
  /** What the cheat gate blocked (used only when negativeGateClean is false). */
  readonly negativeGateDetail: string;
  /**
   * The positive-gate controls (build, test, declared obligations, and the
   * falsifier when adapters are configured). Empty when the gate could not run
   * the controls (e.g. not execution-groundable); the composer treats an empty
   * set on a viable PR as "no controls ran", never a vacuous pass.
   */
  readonly controls: readonly MergeControl[];
}

/** The composed decision. `reasons` is empty iff the verdict is auto-merge. */
export interface MergeDecision {
  readonly verdict: MergeVerdict;
  readonly reasons: readonly HumanReason[];
  readonly egViable: boolean;
  readonly negativeGateClean: boolean;
  readonly controls: readonly MergeControl[];
}

/**
 * Compose the two-sided merge decision from the negative-gate verdict, the
 * execution-groundability of the PR, and the positive-gate controls.
 *
 * AUTO-MERGE requires all of: the negative gate is clean, the PR is
 * execution-groundable, at least one control ran, and every control passed
 * (no `fail`, no `unavailable`). Every blocking condition is reported, so the
 * HUMAN reviewer sees the full picture rather than the first failure.
 *
 * @param input the negative verdict, viability, and positive-gate controls.
 * @returns the AUTO-MERGE / HUMAN decision with all blocking reasons.
 */
export function composeMergeDecision(input: MergeDecisionInput): MergeDecision {
  const reasons: HumanReason[] = [];

  if (!input.egViable) {
    reasons.push({ code: 'not-execution-groundable', detail: input.egViabilityReason });
  }

  if (!input.negativeGateClean) {
    reasons.push({ code: 'negative-gate-blocked', detail: input.negativeGateDetail });
  }

  // A viable PR with no controls is not a proof of anything; refuse to
  // auto-merge on an empty positive gate. A non-viable PR already has its
  // reason above and legitimately ran no controls.
  if (input.egViable && input.controls.length === 0) {
    reasons.push({
      code: 'no-controls-ran',
      detail:
        'the positive gate produced no controls on an execution-groundable PR; ' +
        'nothing was proven, so the merge is not admissible',
    });
  }

  for (const control of input.controls) {
    if (control.status === 'fail') {
      reasons.push({
        code: 'positive-control-failed',
        detail: `${control.id}: ${control.detail}`,
      });
    } else if (control.status === 'unavailable') {
      reasons.push({
        code: 'positive-control-unavailable',
        detail: `${control.id} could not run (not proven): ${control.detail}`,
      });
    }
  }

  return {
    verdict: reasons.length === 0 ? 'auto-merge' : 'human',
    reasons,
    egViable: input.egViable,
    negativeGateClean: input.negativeGateClean,
    controls: input.controls,
  };
}

/**
 * One-line human summary of a decision, for the PR comment and logs.
 *
 * @param decision a composed merge decision.
 * @returns e.g. "AUTO-MERGE" or "HUMAN: not-execution-groundable; positive-control-failed".
 */
export function summarizeMergeDecision(decision: MergeDecision): string {
  if (decision.verdict === 'auto-merge') {
    return 'AUTO-MERGE';
  }
  const codes = decision.reasons.map((r) => r.code).join('; ');
  return `HUMAN: ${codes}`;
}
