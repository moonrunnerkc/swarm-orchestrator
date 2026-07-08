// The claim-differential verdict vocabulary: the verdict union, its human
// reasons, the discrimination-abstain mapping, and the raw pre-discrimination
// verdict table. Split out of claim-differential.ts so that module stays focused
// on orchestration. The raw table (baseSideVerdict / headVerdict /
// classifyClaimDifferential) is the documented pre-discrimination mapping used by
// the Hunt 4 outline diagnostic; runClaimDifferential layers the discrimination
// control on top of the base/head runs instead of calling it.

import type { ReproStatus } from './issue-repro';
import type { DiscriminationAbstain } from './discrimination-control';

export type ClaimDifferentialVerdict =
  | 'claim-delivered'
  | 'claim-falsified-synthesized'
  | 'abstain:no-claim'
  | 'abstain:witness-not-compiled'
  | 'abstain:arbiter-disagreement'
  | 'abstain:witness-not-runnable'
  | 'abstain:flaky-base'
  | 'abstain:closure-unlinked'
  | 'abstain:base-passes'
  | 'abstain:execution-error'
  | 'abstain:setup-error'
  | 'abstain:nondeterministic-classification'
  | 'abstain:failure-identity-divergence'
  | 'abstain:no-pass-capability-evidence';

/**
 * The human reason string for each verdict, shown in the finding and the record.
 *
 * @param verdict the claim-differential verdict.
 * @returns a one-sentence explanation.
 */
export function verdictReason(verdict: ClaimDifferentialVerdict): string {
  switch (verdict) {
    case 'claim-delivered':
      return 'the witness fails on the base and passes on the head: the claim is delivered';
    case 'claim-falsified-synthesized':
      return 'the witness fails on both the base and the head and is shown capable of passing on a correct implementation: the PR does not deliver its claim';
    case 'abstain:no-claim':
      return 'the PR carries no usable claim text to compile a witness from';
    case 'abstain:witness-not-compiled':
      return 'no runnable witness test could be compiled from the claim';
    case 'abstain:arbiter-disagreement':
      return 'the two arbiters did not both agree the witness tests the claim';
    case 'abstain:witness-not-runnable':
      return 'the witness could not run against the base checkout (setup/parse failure)';
    case 'abstain:flaky-base':
      return 'the witness gave different results across two base runs (flaky); no proof';
    case 'abstain:closure-unlinked':
      return "the witness's import closure does not reach a behaviorally-revertable changed source file";
    case 'abstain:base-passes':
      return 'the witness passes on the base: the claimed defect is not present, so the witness is invalid';
    case 'abstain:execution-error':
      return 'the witness execution errored or timed out; no proof';
    case 'abstain:setup-error':
      return 'a witness run was a setup error (crash, missing dependency, or timeout), not a clean assertion; no proof';
    case 'abstain:nondeterministic-classification':
      return 'the K base or head runs did not all produce the same classification and failure identity; no proof';
    case 'abstain:failure-identity-divergence':
      return 'the base and head failures are not the same assertion failing the same way; the witness does not measure one behaviour';
    case 'abstain:no-pass-capability-evidence':
      return 'no evidence the witness can pass on a correct implementation of the claim (the discrimination control); the finding is held back';
  }
}

/**
 * Map a discrimination-control abstain reason to its claim-differential verdict.
 *
 * @param reason the abstain reason the discrimination control raised.
 * @returns the corresponding claim-differential verdict.
 */
export function discriminationAbstainVerdict(reason: DiscriminationAbstain): ClaimDifferentialVerdict {
  switch (reason) {
    case 'setup-error':
      return 'abstain:setup-error';
    case 'nondeterministic-classification':
      return 'abstain:nondeterministic-classification';
    case 'base-passes':
      return 'abstain:base-passes';
    case 'failure-identity-divergence':
      return 'abstain:failure-identity-divergence';
    case 'no-pass-capability-evidence':
      return 'abstain:no-pass-capability-evidence';
  }
}

/**
 * The raw pre-discrimination base-side table. Decides the base outcome from two
 * base runs and the arbiter/closure controls, before any head run. Retained as
 * the documented raw verdict table and used by the Hunt 4 outline diagnostic
 * (`scripts/real-prs/hunt4-diagnose-outline.ts`); `runClaimDifferential` itself
 * routes the base/head runs through the discrimination control. Pure.
 *
 * @param c arbiter agreement, closure link, and the two base run statuses.
 * @returns a terminal abstain verdict or the 'run-head' signal.
 */
export function baseSideVerdict(c: {
  arbiterAgreed: boolean;
  closureLinked: boolean | null;
  baseRun1: ReproStatus;
  baseRun2: ReproStatus;
}): ClaimDifferentialVerdict | 'run-head' {
  if (!c.arbiterAgreed) return 'abstain:arbiter-disagreement';
  if (c.baseRun1 === 'errored' || c.baseRun2 === 'errored') return 'abstain:witness-not-runnable';
  if (c.baseRun1 === 'timeout' || c.baseRun2 === 'timeout') return 'abstain:execution-error';
  const failed1 = c.baseRun1 === 'failed';
  const failed2 = c.baseRun2 === 'failed';
  if (failed1 !== failed2) return 'abstain:flaky-base';
  if (!failed1) return 'abstain:base-passes';
  if (c.closureLinked !== true) return 'abstain:closure-unlinked';
  return 'run-head';
}

/**
 * The raw pre-discrimination head-side map, kept alongside `baseSideVerdict` for
 * the diagnostic path. `runClaimDifferential` uses the discrimination control.
 *
 * @param headStatus the witness status on the head checkout.
 * @returns claim-delivered (head passes), claim-falsified-synthesized (head
 *   fails), or abstain:execution-error (head could not run).
 */
export function headVerdict(
  headStatus: ReproStatus,
): 'claim-delivered' | 'claim-falsified-synthesized' | 'abstain:execution-error' {
  if (headStatus === 'errored' || headStatus === 'timeout') return 'abstain:execution-error';
  if (headStatus === 'passed') return 'claim-delivered';
  return 'claim-falsified-synthesized';
}

/**
 * The full raw verdict table as one pure function (base side then head side), for
 * tests and the diagnostic path. Does NOT include the discrimination control;
 * `runClaimDifferential` layers that on top.
 *
 * @param c arbiter agreement, closure link, both base runs, and the head status.
 * @returns the raw claim-differential verdict.
 */
export function classifyClaimDifferential(c: {
  arbiterAgreed: boolean;
  closureLinked: boolean | null;
  baseRun1: ReproStatus;
  baseRun2: ReproStatus;
  headStatus: ReproStatus;
}): ClaimDifferentialVerdict {
  const base = baseSideVerdict(c);
  return base === 'run-head' ? headVerdict(c.headStatus) : base;
}
