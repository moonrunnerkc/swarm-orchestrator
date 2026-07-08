// Claim-differential proof. Restoration proofs falsify the diff; this falsifies
// the CLAIM. It compiles the PR's stated claim into one executable witness test,
// requires two independent models to agree the witness tests the claim, then runs
// the witness against the base and head checkouts under the discrimination
// control (discrimination-control.ts):
//
//   base fails, head passes -> claim-delivered   (exonerating record)
//   base fails, head fails   -> claim-falsified-synthesized  ONLY when the witness
//                               is shown capable of passing on a correct
//                               implementation (pass-capability, clause 4);
//                               otherwise an abstain, because a witness that fails
//                               identically everywhere for its own setup reasons
//                               provides no differential signal (the Hunt 4
//                               outline false positive).
//   base passes              -> witness invalid, abstain
//   any control not green    -> abstain, with the reason recorded
//
// Fail-closed everywhere. The witness must fail deterministically on the base
// (K-run determinism quorum), its import closure must reach a
// behaviorally-revertable source file the PR changed, it must actually run (only
// assertion failures count; a setup error abstains), and the base and head must
// fail the same assertion the same way. In production no reference implementation
// exists and no bounded proxy certifies pass-capability, so the finding abstains
// there; on twins the honest twin supplies pass-capability directly. This targets
// the misses the restoration proofs cannot reach: goal-not-fixed and no-test-edit
// cheats.
//
// The verdict vocabulary and raw pre-discrimination table live in
// claim-differential-verdict.ts (re-exported here so callers keep one import
// surface); the discrimination logic lives in discrimination-control.ts.

import { getLogger } from '../../logger';
import type { DockerContext } from './docker-runner';
import { renderReproCommand, type ReproStatus } from './issue-repro';
import type { TestRunner } from './sandbox';
import { extractChangedUnits } from './claim-changed-units';
import { behaviorallyRevertableSourceFiles } from './test-restoration';
import {
  arbiterPairAgrees,
  buildClaimText,
  compileWitness,
  establishPassCapabilityOnTwin,
  evaluateClosureControl,
  runWitnessQuorum,
  type ClaimWitness,
  type Completer,
  type ClosureControl,
  type WitnessArbiter,
} from './claim-witness';
import {
  assessDiscrimination,
  DISCRIMINATION_QUORUM_K,
  type DiscriminationVerdict,
  type PassCapabilityEvidence,
  type WitnessRunOutcome,
} from './discrimination-control';
import {
  discriminationAbstainVerdict,
  verdictReason,
  type ClaimDifferentialVerdict,
} from './claim-differential-verdict';

export {
  baseSideVerdict,
  classifyClaimDifferential,
  headVerdict,
  type ClaimDifferentialVerdict,
} from './claim-differential-verdict';

const log = getLogger('audit:execution-grounded:claim-differential');

/** The witness provenance recorded on the result (always defined once compiled). */
type WitnessMeta = NonNullable<ClaimDifferentialResult['witness']>;

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
    samplingPolicy?: string;
    retried?: boolean;
    regeneratedForClosure?: boolean;
  };
  readonly arbiter?: {
    agreed: boolean;
    a: { yes: boolean; model: string };
    b: { yes: boolean; model: string };
  };
  readonly closure?: ClosureControl;
  /** The K base run statuses (the discrimination quorum). */
  readonly baseRuns?: ReproStatus[];
  /** The K head run statuses; absent when the base side abstained before head. */
  readonly headRuns?: ReproStatus[];
  /** The representative head status (first head run), kept for readers that
   *  expect a single value; absent when no head run happened. */
  readonly headStatus?: ReproStatus;
  /** The discrimination control's decision and evidence, recorded into the
   *  ledger so a reader can see which clause held back or let through a verdict. */
  readonly discrimination?: {
    outcome: 'fire' | 'claim-delivered' | 'abstain';
    reason?: string;
    detail: string;
    identity?: string;
    passCapability: PassCapabilityEvidence;
    quorumK: number;
  };
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
  /** The honest-twin (correct-implementation) checkout for the pass-capability
   *  control (clause 4). Supplied only by the twin measurement harness; absent
   *  in production, where the finding therefore abstains. */
  readonly honestTwinWorkspacePath?: string;
  readonly testRunner: TestRunner | null;
  readonly complete: Completer;
  readonly arbiterA: WitnessArbiter;
  readonly arbiterB: WitnessArbiter;
  readonly docker?: DockerContext;
}

function terminal(
  verdict: ClaimDifferentialVerdict,
  extra: Partial<ClaimDifferentialResult> = {},
): ClaimDifferentialResult {
  return { verdict, isFinding: verdict === 'claim-falsified-synthesized', reason: verdictReason(verdict), ...extra };
}

/** Establish pass-capability from the honest twin when the harness supplied one;
 *  otherwise the production `none` evidence, which abstains the finding. */
function resolvePassCapability(
  input: ClaimDifferentialInput,
  witness: ClaimWitness,
): PassCapabilityEvidence {
  if (input.honestTwinWorkspacePath === undefined) {
    return {
      kind: 'none',
      reason:
        'no reference implementation is available in production, and no bounded runtime proxy is sound enough to certify pass-capability (see the discrimination-control production semantics); the finding abstains',
    };
  }
  return establishPassCapabilityOnTwin(
    input.honestTwinWorkspacePath,
    witness,
    input.testRunner,
    input.docker,
  );
}

/** Turn the discrimination verdict into a claim-differential result, threading
 *  the run provenance and (on a finding) the reproduce command. */
function fromDiscrimination(
  verdict: DiscriminationVerdict,
  ctx: {
    witnessMeta: WitnessMeta;
    arbiter: ClaimDifferentialResult['arbiter'];
    closure: ClosureControl;
    baseStatuses: ReproStatus[];
    headStatuses: ReproStatus[];
    passCapability: PassCapabilityEvidence;
    witness: ClaimWitness;
    testRunner: TestRunner | null;
  },
): ClaimDifferentialResult {
  const base: Partial<ClaimDifferentialResult> = {
    witness: ctx.witnessMeta,
    ...(ctx.arbiter !== undefined ? { arbiter: ctx.arbiter } : {}),
    closure: ctx.closure,
    baseRuns: ctx.baseStatuses,
    headRuns: ctx.headStatuses,
    ...(ctx.headStatuses[0] !== undefined ? { headStatus: ctx.headStatuses[0] } : {}),
    discrimination: {
      outcome: verdict.outcome,
      ...(verdict.outcome === 'abstain' ? { reason: verdict.reason } : {}),
      detail: verdict.outcome === 'abstain' ? verdict.detail : `matched identity: ${verdict.identity}`,
      ...(verdict.outcome !== 'abstain' ? { identity: verdict.identity } : {}),
      passCapability: ctx.passCapability,
      quorumK: DISCRIMINATION_QUORUM_K,
    },
  };
  if (verdict.outcome === 'fire') {
    return {
      ...terminal('claim-falsified-synthesized', base),
      reproduceCommand: renderReproCommand(ctx.witness.repro, ctx.testRunner),
    };
  }
  if (verdict.outcome === 'claim-delivered') return terminal('claim-delivered', base);
  return terminal(discriminationAbstainVerdict(verdict.reason), base);
}

/**
 * Run the claim-differential proof end to end against a provisioned PR pair. The
 * base and head witness runs go through the discrimination control: only an
 * assertion failure that reproduces deterministically on both checkouts, with the
 * same failure identity, and with affirmative evidence the witness can pass on a
 * correct implementation, becomes `claim-falsified-synthesized`. In production
 * (no honest twin) the finding always abstains at the pass-capability clause.
 *
 * @param input the PR text, both workspaces, the runner, the injected LLM deps,
 *   and (twin harness only) the honest-twin checkout.
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

  // Feed the compiler the behaviorally-revertable changed files (and their
  // exported symbols) so a witness can import the real revertable unit instead of
  // being synthesized from claim text alone; the closure control is unchanged.
  const revertableFiles = behaviorallyRevertableSourceFiles(input.prDiff);
  const changedUnits = extractChangedUnits(revertableFiles, input.postWorkspacePath);

  let witness: ClaimWitness | null;
  try {
    witness = await compileWitness(claim, input.complete, {
      changedUnits,
      headWorkspace: input.postWorkspacePath,
      revertableFiles,
    });
  } catch (err) {
    log.warn(`witness compilation failed: ${String(err)}`);
    return terminal('abstain:witness-not-compiled');
  }
  if (witness === null) return terminal('abstain:witness-not-compiled');
  const witnessMeta: WitnessMeta = {
    model: witness.model,
    promptVersion: witness.promptVersion,
    promptHash: witness.promptHash,
    witnessHash: witness.witnessHash,
    ...(witness.samplingPolicy !== undefined ? { samplingPolicy: witness.samplingPolicy } : {}),
    ...(witness.retried !== undefined ? { retried: witness.retried } : {}),
    ...(witness.regeneratedForClosure !== undefined
      ? { regeneratedForClosure: witness.regeneratedForClosure }
      : {}),
  };

  let arbiter;
  try {
    arbiter = await arbiterPairAgrees(claim, witness.repro.code, input.arbiterA, input.arbiterB);
  } catch (err) {
    log.warn(`arbiter gate failed: ${String(err)}`);
    return terminal('abstain:arbiter-disagreement', { witness: witnessMeta });
  }
  if (!arbiter.agreed) return terminal('abstain:arbiter-disagreement', { witness: witnessMeta, arbiter });

  const closure = evaluateClosureControl(input.postWorkspacePath, witness, input.prDiff);
  if (closure.linked !== true) {
    return terminal('abstain:closure-unlinked', { witness: witnessMeta, arbiter, closure });
  }

  // The determinism quorum: K runs on the base and K on the head. The witness
  // execution is a model-free sandbox run, so the cost is wall-clock only.
  const baseRuns = runWitnessQuorum(input.preWorkspacePath, witness, input.testRunner, input.docker);
  const headRuns = runWitnessQuorum(input.postWorkspacePath, witness, input.testRunner, input.docker);
  const passCapability = resolvePassCapability(input, witness);

  const verdict = assessDiscrimination({ baseRuns, headRuns, passCapability });
  return fromDiscrimination(verdict, {
    witnessMeta,
    arbiter,
    closure,
    baseStatuses: statusesOf(baseRuns),
    headStatuses: statusesOf(headRuns),
    passCapability,
    witness,
    testRunner: input.testRunner,
  });
}

/** Project the captured run outcomes down to their statuses for the record. */
function statusesOf(runs: readonly WitnessRunOutcome[]): ReproStatus[] {
  return runs.map((r) => r.status);
}
