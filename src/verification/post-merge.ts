/**
 * Phase 6: post-merge integration verification.
 *
 * After every obligation has been processed, run the full contract
 * suite end-to-end against the workspace. Per-obligation verification
 * runs against the world *as the manager understood it* at apply-time;
 * post-merge verification re-checks every obligation against the
 * world *as it actually is* once everyone has committed. This catches
 * the impl guide §9 example: "two obligations that individually pass
 * but together produce a broken build".
 *
 * Failure semantics: when post-merge fails, the entire run is marked
 * failed by the manager. Phase 6 does NOT auto-rollback workspace
 * changes (the architecture-deviations doc captures why); the run's
 * exit code is 2, the ledger entry captures every per-obligation
 * outcome, and the user diagnoses or re-runs.
 */

import type { FinalContract, ObligationV1 } from '../contract/types';
import { verifyObligation, type VerifyOptions } from './run-verifier';

/** Per-obligation post-merge re-check outcome. */
export interface PostMergeOutcome {
  obligationIndex: number;
  obligation: ObligationV1;
  passed: boolean;
  detail: string;
}

/** Aggregate post-merge result. */
export interface PostMergeResult {
  passed: boolean;
  obligationCount: number;
  failedCount: number;
  outcomes: PostMergeOutcome[];
}

export interface PostMergeOptions {
  contract: FinalContract;
  verifyOptions: VerifyOptions;
}

/**
 * Re-verify every obligation in the contract end-to-end. Walk order is
 * the contract's canonical order so the audit trail is deterministic.
 * Build-must-pass and test-must-pass obligations re-execute their
 * commands; this is the "integration check across all merged contracts
 * together" described in impl guide §9.
 */
export function postMergeVerify(options: PostMergeOptions): PostMergeResult {
  const { contract, verifyOptions } = options;
  const outcomes: PostMergeOutcome[] = [];
  let failedCount = 0;
  for (let i = 0; i < contract.obligations.length; i += 1) {
    const o = contract.obligations[i];
    if (!o) continue;
    const r = verifyObligation(o, verifyOptions);
    outcomes.push({
      obligationIndex: i,
      obligation: o,
      passed: r.satisfied,
      detail: r.detail,
    });
    if (!r.satisfied) failedCount += 1;
  }
  return {
    passed: failedCount === 0,
    obligationCount: outcomes.length,
    failedCount,
    outcomes,
  };
}
