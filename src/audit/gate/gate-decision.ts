// The runtime block decision for `swarm audit --mode gate`. A block fires only
// when a block-eligible trigger fired on the PR; every other finding stays
// advisory and never affects the exit code. `--mode advise` (the default) never
// blocks.
//
// The eligible set is pinned in source here, the same way detector-precision.ts
// pins the measured-precision table: a consumer's audit must not read a
// benchmark JSON out of the installed package, and pinning makes the gate's
// honest status auditable from git log. The set is empty until a trigger clears
// the bar in benchmarks/real-corpus/block-eligibility.json (Wilson 95% lower
// >= 0.90 with >= 5 confirmed reverted true positives); when one does, this set
// and the calibration are bumped in the same commit.

import type { AuditMode } from '../types';
import type { BlockTrigger, BlockTriggerKind } from './block-trigger-types';

/** The triggers currently allowed to gate, pinned from the committed
 *  block-eligibility policy. Empty: no trigger has yet cleared the revert
 *  calibration bar. */
export const BLOCK_ELIGIBLE_TRIGGERS: readonly BlockTriggerKind[] = [];

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
 * least one block-eligible trigger fired. A trigger that fired but is not
 * eligible is advisory and does not block.
 *
 * @param triggers every block-trigger candidate the run produced
 * @param mode the audit mode (advise never blocks)
 * @param structuralPass the AuditResult.pass flag (false when a detector blocked)
 * @param eligible the currently block-eligible trigger kinds (injectable for tests)
 * @returns the eligible-fired triggers and whether to exit 1
 */
export function decideBlock(
  triggers: readonly BlockTrigger[],
  mode: AuditMode,
  structuralPass: boolean,
  eligible: readonly BlockTriggerKind[] = BLOCK_ELIGIBLE_TRIGGERS,
): GateDecision {
  const blockingTriggers = triggers.filter((t) => isBlockEligible(t.kind, eligible));
  if (mode === 'advise') return { blockingTriggers, blocked: false };
  return { blockingTriggers, blocked: !structuralPass || blockingTriggers.length > 0 };
}
