// The positive-gate orchestrator: given a provisioned merged tree and the
// negative-gate verdict, decide AUTO-MERGE or HUMAN. This is the deterministic
// core the CLI wiring calls once it has provisioned the PR head. It composes
// the modules landed earlier in Phase 1 (viability -> obligations -> controls
// -> decision) and adds two fail-closed rules:
//
//   - a not-viable tree never runs controls; it routes to HUMAN with the
//     specific viability reason.
//   - a present-but-malformed .swarm/merge-obligations.yaml becomes an
//     unavailable control (the consumer's declared checks could not be
//     applied), never a silent pass.
//
// Operating on a local workspace path keeps this offline-testable end to end;
// the network provisioning of the merged tree is the CLI's job, not this
// function's.

import { assessViability } from '../execution-grounded/viability';
import { composeMergeDecision, type MergeControl, type MergeDecision } from './merge-decision';
import { loadMergeObligations } from './merge-obligations-config';
import { runPositiveGate, type FalsifierProbe } from './positive-gate';

export interface MergeGateInput {
  /** The provisioned merged tree: a real checkout of the PR head. */
  readonly workspacePath: string;
  /** Whether the negative (cheat) gate blocked nothing. */
  readonly negativeGateClean: boolean;
  /** What the cheat gate blocked, used only when not clean. */
  readonly negativeGateDetail: string;
  /** Per-command wall-clock cap. Falls through to verifyObligation's default. */
  readonly commandTimeoutMs?: number;
  /** Optional falsifier control probe; omit for no adversarial control (disclosed absence). */
  readonly falsifierProbe?: FalsifierProbe;
}

export interface MergeGateOutcome {
  readonly decision: MergeDecision;
  readonly viable: boolean;
  readonly viabilityReason: string;
  /** Number of obligations that ran (default plus consumer-declared). */
  readonly obligationCount: number;
  /** merge-obligations.yaml parse/schema errors, if any (already folded into the decision). */
  readonly configErrors: readonly string[];
}

/**
 * Run the positive merge-safety gate against a provisioned workspace and
 * compose the final AUTO-MERGE / HUMAN decision.
 *
 * @param input the provisioned tree, the negative-gate verdict, and options.
 * @returns the composed decision plus viability and obligation context.
 */
export function runMergeGate(input: MergeGateInput): MergeGateOutcome {
  const viability = assessViability(input.workspacePath);
  // packageManager is legitimately null for pytest and Go; viability plus a
  // detected runner is what gates whether the controls can run.
  if (!viability.viable || viability.testRunner === null) {
    const decision = composeMergeDecision({
      egViable: false,
      egViabilityReason: viability.reason,
      negativeGateClean: input.negativeGateClean,
      negativeGateDetail: input.negativeGateDetail,
      controls: [],
    });
    return {
      decision,
      viable: false,
      viabilityReason: viability.reason,
      obligationCount: 0,
      configErrors: [],
    };
  }

  const config = loadMergeObligations(input.workspacePath);
  const gate = runPositiveGate({
    workspacePath: input.workspacePath,
    packageManager: viability.packageManager,
    testRunner: viability.testRunner,
    extraObligations: config.obligations,
    ...(input.commandTimeoutMs !== undefined ? { commandTimeoutMs: input.commandTimeoutMs } : {}),
    ...(input.falsifierProbe !== undefined ? { falsifierProbe: input.falsifierProbe } : {}),
  });

  const controls: MergeControl[] = [...gate.controls];
  if (config.errors.length > 0) {
    controls.push({
      id: 'merge-obligations-config',
      kind: 'obligation',
      status: 'unavailable',
      detail: `.swarm/merge-obligations.yaml could not be applied: ${config.errors.join('; ')}`,
    });
  }

  const decision = composeMergeDecision({
    egViable: true,
    egViabilityReason: '',
    negativeGateClean: input.negativeGateClean,
    negativeGateDetail: input.negativeGateDetail,
    controls,
  });
  return {
    decision,
    viable: true,
    viabilityReason: '',
    obligationCount: gate.obligations.length,
    configErrors: config.errors,
  };
}
