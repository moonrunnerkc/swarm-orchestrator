// Claim-differential proof. Restoration proofs falsify the diff; this falsifies
// the CLAIM. It compiles the PR's stated claim into one executable witness test,
// requires two independent models to agree the witness tests the claim, then runs
// the witness against the base and head checkouts:
//
//   base fails, head passes -> claim-delivered   (exonerating record)
//   base fails, head fails   -> claim-falsified-synthesized  (a finding)
//   base passes              -> witness invalid, abstain
//   any control not green    -> abstain, with the reason recorded
//
// Fail-closed everywhere. The witness must fail deterministically on the base
// (flake quorum, two runs), its import closure must reach a behaviorally-revertable
// source file the PR changed, and it must actually run. This targets the misses
// the restoration proofs cannot reach: goal-not-fixed and no-test-edit cheats.

import { getLogger } from '../../logger';
import type { DockerContext } from './docker-runner';
import { renderReproCommand, type ReproStatus } from './issue-repro';
import type { TestRunner } from './sandbox';
import {
  arbiterPairAgrees,
  buildClaimText,
  compileWitness,
  evaluateClosureControl,
  runWitness,
  type ClaimWitness,
  type Completer,
  type ClosureControl,
  type WitnessArbiter,
} from './claim-witness';

const log = getLogger('audit:execution-grounded:claim-differential');

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
  | 'abstain:execution-error';

/**
 * Decide the base-side outcome from the two base runs and the controls, before
 * any head run. Returns a terminal abstain verdict, or 'run-head' when the base
 * side is clean (arbiter agreed, closure linked, witness failed on the base
 * twice) and the head run is what decides delivered vs falsified. Pure.
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
 * Decide the final verdict from the head run, given the base side was clean.
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
 * The full verdict table as one pure function (base side then head side), for
 * tests and for a caller that already has every input.
 *
 * @param c arbiter agreement, closure link, both base runs, and the head status.
 * @returns the claim-differential verdict.
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

export interface ClaimDifferentialResult {
  readonly verdict: ClaimDifferentialVerdict;
  /** True only for claim-falsified-synthesized: the one finding verdict. */
  readonly isFinding: boolean;
  readonly reason: string;
  readonly witness?: {
    model: string;
    promptVersion: string;
    promptHash: string;
    witnessHash: string;
  };
  readonly arbiter?: {
    agreed: boolean;
    a: { yes: boolean; model: string };
    b: { yes: boolean; model: string };
  };
  readonly closure?: ClosureControl;
  readonly baseRuns?: [ReproStatus, ReproStatus];
  readonly headStatus?: ReproStatus;
  /** The exact command that runs the witness, published on a finding. */
  readonly reproduceCommand?: string;
}

export interface ClaimDifferentialInput {
  readonly prDiff: string;
  readonly prTitle: string;
  readonly prBody: string;
  readonly issueTitle?: string;
  readonly issueBody?: string;
  readonly preWorkspacePath: string;
  readonly postWorkspacePath: string;
  readonly testRunner: TestRunner | null;
  readonly complete: Completer;
  readonly arbiterA: WitnessArbiter;
  readonly arbiterB: WitnessArbiter;
  readonly docker?: DockerContext;
}

function reason(verdict: ClaimDifferentialVerdict): string {
  switch (verdict) {
    case 'claim-delivered':
      return 'the witness fails on the base and passes on the head: the claim is delivered';
    case 'claim-falsified-synthesized':
      return 'the witness fails on both the base and the head: the PR does not deliver its claim';
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
  }
}

function terminal(
  verdict: ClaimDifferentialVerdict,
  extra: Partial<ClaimDifferentialResult> = {},
): ClaimDifferentialResult {
  return { verdict, isFinding: verdict === 'claim-falsified-synthesized', reason: reason(verdict), ...extra };
}

/**
 * Run the claim-differential proof end to end against a provisioned PR pair.
 * Short-circuits: the head witness runs only when the base side is clean, so an
 * abstaining PR spends no head execution.
 *
 * @param input the PR text, both workspaces, the runner, and the injected LLM deps.
 * @returns the verdict with its controls, provenance, and (on a finding) the
 *   reproduce command. Never throws; an execution error becomes an abstain.
 */
export async function runClaimDifferential(
  input: ClaimDifferentialInput,
): Promise<ClaimDifferentialResult> {
  const claim = buildClaimText({
    prTitle: input.prTitle,
    prBody: input.prBody,
    ...(input.issueTitle !== undefined ? { issueTitle: input.issueTitle } : {}),
    ...(input.issueBody !== undefined ? { issueBody: input.issueBody } : {}),
  });
  if (claim.trim().length === 0) return terminal('abstain:no-claim');

  let witness: ClaimWitness | null;
  try {
    witness = await compileWitness(claim, input.complete);
  } catch (err) {
    log.warn(`witness compilation failed: ${String(err)}`);
    return terminal('abstain:witness-not-compiled');
  }
  if (witness === null) return terminal('abstain:witness-not-compiled');
  const witnessMeta = {
    model: witness.model,
    promptVersion: witness.promptVersion,
    promptHash: witness.promptHash,
    witnessHash: witness.witnessHash,
  };

  let arbiter;
  try {
    arbiter = await arbiterPairAgrees(claim, witness.repro.code, input.arbiterA, input.arbiterB);
  } catch (err) {
    log.warn(`arbiter gate failed: ${String(err)}`);
    return terminal('abstain:arbiter-disagreement', { witness: witnessMeta });
  }

  const closure = evaluateClosureControl(input.postWorkspacePath, witness, input.prDiff);

  const baseRun1 = runWitness(input.preWorkspacePath, witness, input.testRunner, input.docker).status;
  const baseRun2 = runWitness(input.preWorkspacePath, witness, input.testRunner, input.docker).status;
  const baseRuns: [ReproStatus, ReproStatus] = [baseRun1, baseRun2];

  const base = baseSideVerdict({
    arbiterAgreed: arbiter.agreed,
    closureLinked: closure.linked,
    baseRun1,
    baseRun2,
  });
  if (base !== 'run-head') {
    return terminal(base, { witness: witnessMeta, arbiter, closure, baseRuns });
  }

  const headStatus = runWitness(input.postWorkspacePath, witness, input.testRunner, input.docker).status;
  const verdict = headVerdict(headStatus);
  const result = terminal(verdict, { witness: witnessMeta, arbiter, closure, baseRuns, headStatus });
  if (verdict === 'claim-falsified-synthesized') {
    return { ...result, reproduceCommand: renderReproCommand(witness.repro, input.testRunner) };
  }
  return result;
}
