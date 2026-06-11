// The runtime block decision for `swarm audit --mode gate`. A block fires only
// when a block-eligible trigger fired on the PR; every other finding stays
// advisory and never affects the exit code. `--mode advise` (the default) never
// blocks.
//
// The eligible set is pinned in source here, the same way detector-precision.ts
// pins the measured-precision table: a consumer's audit must not read a
// benchmark JSON out of the installed package, and pinning makes the gate's
// honest status auditable from git log.
//
// Block eligibility is two-tier (see block-eligibility.ts and self-certifying.ts).
// Circumstantial triggers (corroborated-under-constraint) become eligible only
// when their Wilson 95% lower bound clears 0.90 with >= 5 confirmed reverted true
// positives in benchmarks/real-corpus/block-eligibility.json. Self-certifying
// triggers (test-tamper-proven, claim-falsified, obligation-failure) are eligible
// by tier in that calibration and gate only on a firing whose per-instance
// controls are all green, not on the Wilson bar.
//
// The runtime set is the self-certifying tier: those kinds are allowed to gate,
// but a firing blocks only when controlsAllGreen holds for it (the second filter
// in decideBlock). No circumstantial trigger has cleared the Wilson bar, so none
// is listed here. When one does, this set and the calibration are bumped in the
// same commit.

import type { AuditMode } from '../types';
import type { BlockTrigger, BlockTriggerKind } from './block-trigger-types';
import { controlsAllGreen, isSelfCertifying, SELF_CERTIFYING_TRIGGERS } from './self-certifying';

/** The triggers the runtime gate acts on, pinned from the committed
 *  block-eligibility policy. The self-certifying tier is eligible by kind; a
 *  self-certifying firing still blocks only when its per-instance controls are
 *  all green (enforced in decideBlock). No circumstantial trigger has cleared
 *  the Wilson bar, so none is added here. */
export const BLOCK_ELIGIBLE_TRIGGERS: readonly BlockTriggerKind[] = SELF_CERTIFYING_TRIGGERS;

/** Whether a trigger kind is currently allowed to gate a merge. */
export function isBlockEligible(
  kind: BlockTriggerKind,
  eligible: readonly BlockTriggerKind[] = BLOCK_ELIGIBLE_TRIGGERS,
): boolean {
  return eligible.includes(kind);
}

export interface GateDecision {
  /** Eligible triggers that fired. These carry the evidence shown to the
   *  author; in gate mode they are why the merge is blocked. */
  blockingTriggers: BlockTrigger[];
  /** Whether the gate should exit 1 (block). Always false in advise mode. */
  blocked: boolean;
}

/**
 * Decide whether a run blocks. In advise mode, never. In gate mode, block when
 * the structural result already failed (a detector earned a block) or when at
 * least one blocking trigger fired. A trigger is blocking only when its kind is
 * block-eligible AND, for a self-certifying kind, its per-instance controls are
 * all green: a self-certifying firing with a missing, false, or unevaluated
 * control surfaces in the comment but never gates. A circumstantial kind that
 * has been promoted to the eligible set blocks on eligibility alone (the Wilson
 * calibration already vouched for it).
 *
 * @param triggers every block-trigger candidate the run produced
 * @param mode the audit mode (advise never blocks)
 * @param structuralPass the AuditResult.pass flag (false when a detector blocked)
 * @param eligible the currently block-eligible trigger kinds (injectable for tests)
 * @returns the blocking triggers and whether to exit 1
 */
export function decideBlock(
  triggers: readonly BlockTrigger[],
  mode: AuditMode,
  structuralPass: boolean,
  eligible: readonly BlockTriggerKind[] = BLOCK_ELIGIBLE_TRIGGERS,
): GateDecision {
  const blockingTriggers = triggers.filter(
    (t) =>
      isBlockEligible(t.kind, eligible) && (!isSelfCertifying(t.kind) || controlsAllGreen(t)),
  );
  if (mode === 'advise') return { blockingTriggers, blocked: false };
  return { blockingTriggers, blocked: !structuralPass || blockingTriggers.length > 0 };
}
