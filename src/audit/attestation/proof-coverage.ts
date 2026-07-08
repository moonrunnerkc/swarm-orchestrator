// Proof-coverage attestation: the machine-readable statement of WHAT the audit's
// execution-grounded proof engines proved, exonerated, or abstained on. A merge
// policy that reads a "no findings" audit needs to know what that silence covers:
// which proofs executed, which abstained and precisely why (the sandbox never
// provisioned, a control clause held the verdict back, or the proof was
// structurally inapplicable to this diff), and how many control clauses were
// actually evaluated. This is a pure projection of `ExecutionGroundedOutcome`, so
// two audits of the same PR head produce byte-identical attestations; it carries
// no timestamps and no per-run identifiers.
//
// It reports; it never judges. There is no pass/block/merge language here. The
// consumption contract (which attestation states a cautious auto-merge policy may
// key on) lives in `docs/attestation.md`. The per-engine projectors live in
// engine-projection.ts; this file is the public surface and the roll-up.

import type { ExecutionGroundedOutcome } from '../execution-grounded';
import {
  claimDifferentialEngine,
  corroborationEngine,
  deriveProvisioning,
  reproEngine,
  restorationEngine,
} from './engine-projection';

/** Normalized outcome of one proof-engine record. `signal` is a corroboration
 *  run (mutation, coverage, non-terminal repro) that informs but never itself
 *  becomes a finding. */
export type ProofOutcome = 'finding' | 'exonerated' | 'abstain' | 'signal';

/** Coarse bucket over the precise verdict, answering "why did this abstain".
 *  The precise reason is the `verdict` string; this classifies it. */
export type AbstainClass =
  | 'not-provisioned'
  | 'control-clause'
  | 'structurally-inapplicable'
  | 'execution-error';

export interface ProofRecordCoverage {
  /** The finding file, witness hash, package dir, or issue ref this record is about. */
  readonly subject: string;
  /** The engine's own verdict union member (the precise machine reason). */
  readonly verdict: string;
  readonly outcome: ProofOutcome;
  /** Present only when `outcome === 'abstain'`. */
  readonly abstainClass?: AbstainClass;
  /** How many control clauses actually ran (non-null) for this record. */
  readonly controlsEvaluated: number;
  /** The command that reproduces the record in a fresh checkout, where one exists. */
  readonly replayCommand?: string;
}

export interface ProofEngineCoverage {
  readonly engine: string;
  /** At least one candidate reached this engine. */
  readonly applicable: boolean;
  /** At least one record ran a real sandbox execution (a control evaluated or a
   *  terminal verdict reached), as opposed to bailing before any run. */
  readonly executed: boolean;
  readonly records: ReadonlyArray<ProofRecordCoverage>;
}

export interface ProvisioningStatus {
  /** Whether the execution-grounded layer ran at all (enabled + a --pr audit). */
  readonly attempted: boolean;
  readonly provisioned: boolean;
  /** When not provisioned, the sandbox's own reason. */
  readonly reason?: string;
}

export interface ProofCoverageSummary {
  readonly enginesApplicable: number;
  readonly enginesExecuted: number;
  readonly findings: number;
  readonly abstains: number;
  readonly controlsEvaluated: number;
}

export interface ProofCoverageAttestation {
  readonly schema: 'swarm-proof-coverage/v1';
  readonly provisioning: ProvisioningStatus;
  readonly engines: ReadonlyArray<ProofEngineCoverage>;
  readonly summary: ProofCoverageSummary;
}

function summarize(engines: ReadonlyArray<ProofEngineCoverage>): ProofCoverageSummary {
  let findings = 0;
  let abstains = 0;
  let controlsEvaluated = 0;
  let enginesApplicable = 0;
  let enginesExecuted = 0;
  for (const engine of engines) {
    if (engine.applicable) enginesApplicable += 1;
    if (engine.executed) enginesExecuted += 1;
    for (const record of engine.records) {
      if (record.outcome === 'finding') findings += 1;
      if (record.outcome === 'abstain') abstains += 1;
      controlsEvaluated += record.controlsEvaluated;
    }
  }
  return { enginesApplicable, enginesExecuted, findings, abstains, controlsEvaluated };
}

const EMPTY_ATTESTATION: ProofCoverageAttestation = {
  schema: 'swarm-proof-coverage/v1',
  provisioning: { attempted: false, provisioned: false },
  engines: [],
  summary: {
    enginesApplicable: 0,
    enginesExecuted: 0,
    findings: 0,
    abstains: 0,
    controlsEvaluated: 0,
  },
};

/**
 * Build the proof-coverage attestation from an execution-grounded outcome.
 *
 * @param outcome the aggregated proof-engine outcome, or undefined when the
 *   execution-grounded layer did not run (disabled, or not a --pr audit).
 * @returns a deterministic attestation: per-engine coverage, provisioning status,
 *   and a roll-up summary. Never throws.
 */
export function buildProofCoverage(
  outcome: ExecutionGroundedOutcome | undefined,
): ProofCoverageAttestation {
  if (outcome === undefined) return EMPTY_ATTESTATION;
  const engines: ProofEngineCoverage[] = [
    restorationEngine('test-restoration', outcome.restorations, (r) => [
      r.controls.baseTestPasses,
      r.controls.tamperedSuitePasses,
      r.controls.restoredFailsTwiceSameIdentity,
    ]),
    restorationEngine('mock-restoration', outcome.mockRestorations, (r) => [
      r.controls.tamperedSuitePasses,
      r.controls.restoredFailsTwiceSameIdentity,
      r.controls.mockReturnsAssertedValue,
    ]),
    restorationEngine('no-op-fix-restoration', outcome.noOpRestorations, (r) => [
      r.controls.prClaimsFix,
      r.controls.suitePassesAsSubmitted,
      r.controls.affectedTestsCoverRevertedLines,
      r.controls.revertedSuiteStillPassesTwice,
    ]),
    restorationEngine('type-suppression-restoration', outcome.typeSuppressionRestorations, (r) => [
      r.controls.directiveRemoved,
      r.controls.fileCleanAsSubmitted,
      r.controls.diagnosticSurfacesWhenRemoved,
    ]),
    restorationEngine('fake-refactor-restoration', outcome.fakeRefactorRestorations, (r) => [
      r.controls.oldSymbolResolved,
      r.controls.oldSymbolDeclarationRemoved,
      r.controls.oldSymbolStillReferenced,
    ]),
    restorationEngine('dead-branch-restoration', outcome.deadBranchRestorations, (r) => [
      r.controls.branchResolved,
      r.controls.suitePassesAsSubmitted,
      r.controls.branchNeverExecuted,
    ]),
    reproEngine(outcome.repros),
    corroborationEngine('mutation-check', outcome.mutationRuns),
    corroborationEngine('coverage-delta', outcome.coverageRuns),
    claimDifferentialEngine(outcome.claimDifferentials),
  ];
  return {
    schema: 'swarm-proof-coverage/v1',
    provisioning: deriveProvisioning(outcome.skipped),
    engines,
    summary: summarize(engines),
  };
}

/** Serialize an attestation to stable, newline-terminated JSON. */
export function serializeProofCoverage(attestation: ProofCoverageAttestation): string {
  return JSON.stringify(attestation, null, 2) + '\n';
}

function tallyAbstainClasses(
  engines: ReadonlyArray<ProofEngineCoverage>,
): ReadonlyArray<[AbstainClass, number]> {
  const order: AbstainClass[] = [
    'not-provisioned',
    'control-clause',
    'structurally-inapplicable',
    'execution-error',
  ];
  const counts = new Map<AbstainClass, number>();
  for (const engine of engines) {
    for (const record of engine.records) {
      if (record.abstainClass !== undefined) {
        counts.set(record.abstainClass, (counts.get(record.abstainClass) ?? 0) + 1);
      }
    }
  }
  return order.filter((c) => counts.has(c)).map((c) => [c, counts.get(c) ?? 0]);
}

/**
 * Render the attestation as a compact, judgment-free coverage summary for the
 * GitHub Action check output.
 *
 * @param attestation the built proof-coverage attestation.
 * @returns a newline-terminated block: a one-line roll-up plus one line per
 *   applicable engine. No pass/block/merge language; a policy decides.
 */
export function renderProofCoverageSummary(attestation: ProofCoverageAttestation): string {
  const s = attestation.summary;
  const prov = attestation.provisioning.attempted
    ? attestation.provisioning.provisioned
      ? 'provisioned'
      : `not-provisioned (${attestation.provisioning.reason ?? 'unknown'})`
    : 'not-attempted';
  const abstainDetail = tallyAbstainClasses(attestation.engines)
    .map(([cls, n]) => `${n} ${cls}`)
    .join(', ');
  const lines = [
    `Proof coverage (${prov}): proofs executed ${s.enginesExecuted}/${s.enginesApplicable} applicable; ` +
      `${s.controlsEvaluated} controls evaluated; findings ${s.findings}; abstains ${s.abstains}` +
      (abstainDetail.length > 0 ? ` (${abstainDetail})` : '') +
      '.',
  ];
  for (const engine of attestation.engines) {
    if (!engine.applicable) continue;
    const parts = engine.records
      .map((r) => `${r.outcome}${r.abstainClass !== undefined ? `:${r.abstainClass}` : ''}`)
      .join(', ');
    lines.push(`- ${engine.engine}: ${engine.executed ? 'executed' : 'not-executed'} [${parts}]`);
  }
  return lines.join('\n') + '\n';
}
