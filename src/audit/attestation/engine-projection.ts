// Per-engine projection for the proof-coverage attestation. Each execution-
// grounded proof engine records its outcome in a different record shape; this
// module normalizes each into the uniform `ProofEngineCoverage` the attestation
// exposes. Kept separate from proof-coverage.ts (the public surface) so the
// builder there reads as a flat list of engines, not a wall of projectors.

import type {
  PackagedMutationRun,
  PackagedCoverageRun,
  ReproComparison,
} from '../execution-grounded';
import type { ClaimDifferentialResult } from '../execution-grounded/claim-differential';
import type {
  AbstainClass,
  ProofEngineCoverage,
  ProofOutcome,
  ProofRecordCoverage,
  ProvisioningStatus,
} from './proof-coverage';

/** Control-state and quorum reasons: the proof ran but a per-instance control
 *  clause (or the discrimination control) held the verdict back. Everything not
 *  listed here, not a provisioning failure, and not an execution error is a
 *  structural precondition the diff did not meet. */
const CONTROL_CLAUSE_VERDICTS: ReadonlySet<string> = new Set([
  'not-proven:suite-already-failing',
  'not-proven:pre-existing-failure',
  'not-proven:flaky',
  'not-proven:already-failing',
  'not-proven:file-drifted',
  'not-proven:re-specified',
  'not-proven:subject-removed',
  'not-proven:changed-lines-uncovered',
  'not-proven:coverage-unavailable',
  'not-proven:control-not-reached',
  'not-proven:no-affected-tests',
  'not-proven:test-not-closure-linked',
  'not-proven:closure-capped',
  'abstain:no-pass-capability-evidence',
  'abstain:nondeterministic-classification',
  'abstain:failure-identity-divergence',
  'abstain:setup-error',
  'abstain:flaky-base',
  'abstain:base-passes',
  'abstain:closure-unlinked',
  'abstain:witness-not-runnable',
  'abstain:arbiter-disagreement',
]);

/** Classify an abstaining verdict into its coarse bucket. The precise reason is
 *  the verdict string itself; this answers "which kind of abstain". */
export function classifyAbstain(verdict: string): AbstainClass {
  if (verdict.includes('no-workspace')) return 'not-provisioned';
  if (verdict.includes('execution-error')) return 'execution-error';
  if (CONTROL_CLAUSE_VERDICTS.has(verdict)) return 'control-clause';
  return 'structurally-inapplicable';
}

function restorationOutcome(verdict: string): ProofOutcome {
  if (verdict === 'proven') return 'finding';
  if (verdict === 'refuted') return 'exonerated';
  return 'abstain';
}

function projectRecord(
  subject: string,
  verdict: string,
  outcome: ProofOutcome,
  controlsEvaluated: number,
  replay: string | undefined,
): ProofRecordCoverage {
  return {
    subject,
    verdict,
    outcome,
    ...(outcome === 'abstain' ? { abstainClass: classifyAbstain(verdict) } : {}),
    controlsEvaluated,
    ...(replay !== undefined && replay.length > 0 ? { replayCommand: replay } : {}),
  };
}

interface RestorationLike {
  readonly verdict: string;
  readonly findingFile: string;
  readonly reproduceCommand: string;
}

/** Project one restoration-family engine (test/mock/no-op/type/refactor/branch)
 *  into uniform coverage. `controlsOf` extracts the record's boolean|null control
 *  values so the count of executed controls is exact. */
export function restorationEngine<R extends RestorationLike>(
  engine: string,
  records: ReadonlyArray<R>,
  controlsOf: (r: R) => ReadonlyArray<boolean | null>,
): ProofEngineCoverage {
  const projected = records.map((r) => {
    const controlsEvaluated = controlsOf(r).filter((v) => v !== null).length;
    return projectRecord(
      r.findingFile,
      r.verdict,
      restorationOutcome(r.verdict),
      controlsEvaluated,
      r.reproduceCommand,
    );
  });
  return {
    engine,
    applicable: projected.length > 0,
    executed: projected.some((p) => p.outcome !== 'abstain' || p.controlsEvaluated > 0),
    records: projected,
  };
}

export function claimDifferentialEngine(
  records: ReadonlyArray<ClaimDifferentialResult>,
): ProofEngineCoverage {
  const projected = records.map((r) => {
    const outcome: ProofOutcome =
      r.verdict === 'claim-falsified-synthesized'
        ? 'finding'
        : r.verdict === 'claim-delivered'
          ? 'exonerated'
          : 'abstain';
    const controlsEvaluated = (r.baseRuns?.length ?? 0) + (r.headRuns?.length ?? 0);
    return projectRecord(
      r.witness?.witnessHash ?? 'claim-witness',
      r.verdict,
      outcome,
      controlsEvaluated,
      r.reproduceCommand,
    );
  });
  return {
    engine: 'claim-differential',
    applicable: projected.length > 0,
    executed: projected.some((p) => p.controlsEvaluated > 0),
    records: projected,
  };
}

export function reproEngine(records: ReadonlyArray<ReproComparison>): ProofEngineCoverage {
  const projected = records.map((r) => {
    const outcome: ProofOutcome =
      r.verdict === 'fix-not-delivered'
        ? 'finding'
        : r.verdict === 'fix-delivered'
          ? 'exonerated'
          : r.verdict === 'unevaluable'
            ? 'abstain'
            : 'signal';
    const controlsEvaluated = (r.preRuns?.length ?? 1) + (r.postRuns?.length ?? 1);
    // Unevaluable is an errored/timed-out run, not a structural miss.
    const verdict = r.verdict === 'unevaluable' ? 'execution-error' : r.verdict;
    return projectRecord(
      `${r.issue.owner}/${r.issue.repo}#${r.issue.number}`,
      verdict,
      outcome,
      controlsEvaluated,
      undefined,
    );
  });
  return {
    engine: 'issue-repro',
    applicable: projected.length > 0,
    executed: projected.length > 0,
    records: projected,
  };
}

/** Project the corroboration engines (mutation, coverage). These produce a
 *  `signal` when they ran and an `abstain` (with the skip reason) when they did
 *  not; neither becomes a finding on its own. */
export function corroborationEngine(
  engine: string,
  runs: ReadonlyArray<PackagedMutationRun | PackagedCoverageRun>,
): ProofEngineCoverage {
  const projected = runs.map((run) => {
    const ran = run.outcome.ran;
    const verdict = ran ? 'ran' : `not-run:${run.outcome.skipReason ?? 'unknown'}`;
    return projectRecord(run.packageDir, verdict, ran ? 'signal' : 'abstain', ran ? 1 : 0, undefined);
  });
  return {
    engine,
    applicable: projected.length > 0,
    executed: projected.some((p) => p.outcome === 'signal'),
    records: projected,
  };
}

/** Derive the sandbox provisioning status from the outcome's skip log: a
 *  `provision:`-prefixed skip means the sandbox never provisioned. */
export function deriveProvisioning(skipped: ReadonlyArray<string>): ProvisioningStatus {
  const provisionSkip = skipped.find((s) => s.startsWith('provision:'));
  if (provisionSkip !== undefined) {
    const reason = provisionSkip.slice('provision:'.length).trim();
    return { attempted: true, provisioned: false, ...(reason.length > 0 ? { reason } : {}) };
  }
  return { attempted: true, provisioned: true };
}
