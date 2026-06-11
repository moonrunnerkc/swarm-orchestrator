// Verifiable-evidence block triggers. A structural detector cannot earn a
// block in this repo: scored against the AI-labeled real corpus its precision
// is 0, and human labeling is out of scope, so the label road is closed (see
// benchmarks/real-corpus/promotions.json). The block decision therefore comes
// from self-certifying runtime facts, not from a detector's opinion: a fix
// claim execution contradicts, a structural finding a surviving mutant or
// coverage gap corroborates on the same line, a declared obligation that
// fails on the patched workspace, or a restoration proof that the PR's test
// changes concealed a real failure. Each candidate carries a JSON-serializable
// evidence object and the exact command to reproduce it, so a blocked author
// can re-run the proof and see the same result.
//
// This module is the typed-candidate layer only. It produces candidates and
// their evidence; whether a candidate is allowed to gate is decided by the
// revert-calibrated eligibility policy (benchmarks/real-corpus/
// block-eligibility.json), and the gate-mode wiring lives in the audit CLI.

import * as crypto from 'crypto';
import { canonicalJson } from '../../ledger/ledger';
import type { CheatCategory, Finding } from '../types';
import type { PrIntent } from '../cheat-detector/pr-intent';
import type { ReproComparison } from '../execution-grounded';
import { renderReproCommand, type IssueRef } from '../execution-grounded/issue-repro';
import type { TestRunner } from '../execution-grounded/sandbox';
import { corroborationFor, type ExecutionSignals } from '../execution-grounded/corroborate';
import type { RestorationProofRecord } from '../execution-grounded/test-restoration';
import type {
  BlockTrigger,
  BlockTriggerEvidence,
  ClaimFalsifiedEvidence,
  CorroboratedUnderConstraintEvidence,
  ObligationFailureEvidence,
  TestTamperProvenEvidence,
} from './block-trigger-types';

export type {
  BlockTrigger,
  BlockTriggerEvidence,
  BlockTriggerKind,
  ClaimFalsifiedEvidence,
  CorroboratedUnderConstraintEvidence,
  ObligationFailureEvidence,
  TestTamperProvenEvidence,
} from './block-trigger-types';

/**
 * The sha256 of an evidence object's canonical JSON. Pins the evidence into the
 * ledger so a rendered block verdict ties back to the exact fact recorded, and
 * a replay over the same evidence produces the same hash. Uses the ledger's own
 * canonicalizer so the hash is stable across key ordering.
 *
 * @param evidence the block-trigger evidence to fingerprint
 * @returns lowercase hex sha256 of the canonical-JSON encoding
 */
export function blockTriggerEvidenceSha256(evidence: BlockTriggerEvidence): string {
  return crypto.createHash('sha256').update(canonicalJson(evidence), 'utf8').digest('hex');
}

export interface ClaimFalsifiedInput {
  /** The PR's parsed fix claim (cheat-detector/pr-intent.ts). */
  prIntent: PrIntent;
  /** Issue references the PR closes (issue-repro parseIssueReferences). A
   *  close-keyword reference is itself a fix claim. */
  linkedIssues: IssueRef[];
  /** Pre/post repro comparisons from the execution-grounded run. */
  repros: ReproComparison[];
  /** Runner the post workspace used, for rendering the inner repro command. */
  testRunner: TestRunner | null;
}

/**
 * T1: the PR claims a fix and the linked issue's repro still fails against the
 * patched checkout. Execution contradicts the claim. Fires one candidate per
 * `fix-not-delivered` repro (pre failed and post still fails, so the repro
 * reproduces and the fix did not land). Silent when the PR makes no fix claim
 * or every repro passed. The reproduce command is the repro's own command line,
 * which produced the captured failing output verbatim.
 *
 * @param input the PR's fix claim, linked issues, repro comparisons, and runner
 * @returns one block-trigger candidate per falsified fix claim, or []
 */
export function detectClaimFalsified(input: ClaimFalsifiedInput): BlockTrigger[] {
  const claimsFix = input.prIntent.claimsFix || input.linkedIssues.length > 0;
  if (!claimsFix) return [];
  const out: BlockTrigger[] = [];
  for (const comparison of input.repros) {
    if (comparison.verdict !== 'fix-not-delivered') continue;
    const issueRef = `${comparison.issue.owner}/${comparison.issue.repo}#${comparison.issue.number}`;
    const reproCommand = renderReproCommand(comparison.repro, input.testRunner);
    const claim =
      input.prIntent.evidence.length > 0 ? input.prIntent.evidence : `closes ${issueRef}`;
    const evidence: ClaimFalsifiedEvidence = {
      kind: 'claim-falsified',
      issueRef,
      claim,
      reproCommand,
      preStatus: comparison.preStatus,
      postStatus: comparison.postStatus,
      postOutput: comparison.postOutput,
    };
    out.push({
      kind: 'claim-falsified',
      summary:
        `The fix this PR claims for ${issueRef} does not deliver: the issue repro still ` +
        `fails against the patched code (it also failed before, so it reproduces).`,
      reproduce: reproCommand,
      evidence,
    });
  }
  return out;
}

// The structural categories a runtime constraint can corroborate into a block
// candidate. A surviving mutant or an uncovered changed line on the same line a
// coverage-erosion / assertion-strip / test-relaxation / fake-refactor finding
// lands on is the conjunction that earns the candidate; neither half does
// alone. This is exactly the set corroborate.ts keys a mutant signal on.
const CORROBORATED_BLOCK_CATEGORIES: ReadonlySet<CheatCategory> = new Set<CheatCategory>([
  'coverage-erosion',
  'assertion-strip',
  'test-relaxation',
  'fake-refactor',
]);

export interface CorroboratedUnderConstraintInput {
  /** Structural cheat findings from the detector pass. */
  findings: Finding[];
  /** This run's execution signals (surviving mutants, coverage gaps). */
  signals: ExecutionSignals;
  /** PR ref for the audit reproduce command, e.g. `owner/repo#123`. */
  prRef: string;
}

/** Phrase the runtime constraint backing a finding for the candidate summary. */
function constraintText(signal: 'surviving-mutant' | 'coverage-gap'): string {
  return signal === 'surviving-mutant'
    ? 'a mutation on the line survived the suite'
    : 'no test executes the line';
}

/**
 * T2: a structural finding in a corroboratable category lands on a changed line
 * where this run also reports a surviving mutant or zero coverage. The
 * conjunction is the signal: a refactor that looks suspicious AND leaves the
 * line unconstrained at runtime is far more likely a real cheat than either
 * half alone. Reuses `corroborationFor`, so a non-null result is exactly that
 * conjunction on the finding's own line. Silent on findings with no runtime
 * backing, which stay advisory.
 *
 * @param input the structural findings, this run's signals, and the PR ref
 * @returns one candidate per corroborated finding, or []
 */
export function detectCorroboratedUnderConstraint(
  input: CorroboratedUnderConstraintInput,
): BlockTrigger[] {
  const out: BlockTrigger[] = [];
  for (const finding of input.findings) {
    if (!CORROBORATED_BLOCK_CATEGORIES.has(finding.category)) continue;
    const corroboration = corroborationFor(finding, input.signals);
    if (corroboration === null) continue;
    if (corroboration.signal !== 'surviving-mutant' && corroboration.signal !== 'coverage-gap')
      continue;
    const evidence: CorroboratedUnderConstraintEvidence = {
      kind: 'corroborated-under-constraint',
      category: finding.category,
      file: finding.location.file,
      line: finding.location.line,
      ...(finding.location.endLine !== undefined ? { endLine: finding.location.endLine } : {}),
      signal: corroboration.signal,
      ...(corroboration.mutants !== undefined ? { mutants: corroboration.mutants } : {}),
      ...(corroboration.uncoveredLines !== undefined
        ? { uncoveredLines: corroboration.uncoveredLines }
        : {}),
      findingEvidence: finding.evidence,
    };
    out.push({
      kind: 'corroborated-under-constraint',
      summary:
        `A \`${finding.category}\` finding at ${finding.location.file}:${finding.location.line} ` +
        `is corroborated under constraint: ${constraintText(corroboration.signal)}, so the ` +
        `structural pattern and the runtime signal agree on this line.`,
      reproduce: `swarm audit ${input.prRef}`,
      evidence,
    });
  }
  return out;
}

/**
 * One declared-obligation outcome on the patched workspace. Mirrors the
 * verifier / post-merge result shape so a caller maps an existing result onto
 * it without re-running anything: `passed` is the verifier's `satisfied`,
 * `command` is the obligation's command, `detail` is the captured output.
 */
export interface ObligationOutcome {
  obligationType: string;
  obligationIndex?: number;
  passed: boolean;
  command: string;
  detail: string;
}

/**
 * T3: a declared contract obligation (build, test, property, falsifier) failed
 * on the patched workspace. This is the orchestrator's existing hard signal,
 * surfaced as a block candidate so the audit gate treats it the same way.
 * Reuses the verifier outcome; runs no logic of its own. Evidence is the
 * obligation command and its captured failure output, and the reproduce command
 * is the obligation command itself.
 *
 * @param outcomes declared-obligation results on the patched workspace
 * @returns one candidate per failed obligation, or []
 */
export function detectObligationFailure(outcomes: ObligationOutcome[]): BlockTrigger[] {
  const out: BlockTrigger[] = [];
  for (const outcome of outcomes) {
    if (outcome.passed) continue;
    const evidence: ObligationFailureEvidence = {
      kind: 'obligation-failure',
      obligationType: outcome.obligationType,
      ...(outcome.obligationIndex !== undefined
        ? { obligationIndex: outcome.obligationIndex }
        : {}),
      command: outcome.command,
      output: outcome.detail,
    };
    out.push({
      kind: 'obligation-failure',
      summary: `A declared \`${outcome.obligationType}\` obligation failed on the patched workspace.`,
      reproduce: outcome.command,
      evidence,
    });
  }
  return out;
}

export interface TestTamperProvenInput {
  /** Restoration proof records from the execution-grounded run, every verdict
   *  included; the detector keeps only the proven, all-controls-true ones. */
  restorations: RestorationProofRecord[];
}

/** One restored failing test, two restored failing tests, ... */
function failureCount(n: number): string {
  return `${n} restored test${n === 1 ? '' : 's'}`;
}

/**
 * T4: a differential test-restoration proof. The PR's test hunks were reverted
 * in a sandbox, the restored tests failed twice with identical identity
 * against the PR's source, the same tests passed on the base checkout, and the
 * tampered suite passed as submitted: the PR weakened a test that was guarding
 * a real failure. Fires one candidate per `proven` record whose three controls
 * are all true; a proven record with any unexecuted (null) or false control is
 * advisory only and produces nothing (fail closed). The reproduce command is
 * the proof record's own, which replays the restoration in a fresh checkout.
 *
 * @param input the run's restoration proof records
 * @returns one block-trigger candidate per fully-controlled proof, or []
 */
export function detectTestTamperProven(input: TestTamperProvenInput): BlockTrigger[] {
  const out: BlockTrigger[] = [];
  for (const record of input.restorations) {
    if (record.verdict !== 'proven') continue;
    const { baseTestPasses, tamperedSuitePasses, restoredFailsTwiceSameIdentity } = record.controls;
    if (
      baseTestPasses !== true ||
      tamperedSuitePasses !== true ||
      restoredFailsTwiceSameIdentity !== true
    ) {
      continue;
    }
    const evidence: TestTamperProvenEvidence = {
      kind: 'test-tamper-proven',
      verdict: 'proven',
      category: record.category,
      testFiles: record.testFiles,
      failingTests: record.failingTests,
      controls: record.controls,
      reproduceCommand: record.reproduceCommand,
    };
    out.push({
      kind: 'test-tamper-proven',
      summary:
        `A \`${record.category}\` restoration proof at ${record.findingFile}: with the PR's ` +
        `test changes reverted, ${failureCount(record.failingTests.length)} failed twice with ` +
        `identical identity against the PR's source and passed on the base checkout.`,
      reproduce: record.reproduceCommand,
      evidence,
    });
  }
  return out;
}

/** The inputs each trigger needs, bundled so one call produces every candidate
 *  a run can raise. A field left undefined skips that trigger (e.g. an audit
 *  with no declared obligations omits `obligations`). */
export interface BlockTriggerContext {
  claimFalsified?: ClaimFalsifiedInput;
  corroborated?: CorroboratedUnderConstraintInput;
  obligations?: ObligationOutcome[];
  restorations?: TestTamperProvenInput;
}

/**
 * Run every applicable trigger over one run's inputs and return all candidates.
 * The candidates are not blocks: the revert-calibrated eligibility policy
 * decides which kinds may gate.
 *
 * @param context the per-trigger inputs for this run
 * @returns every block-trigger candidate the run produced
 */
export function detectBlockTriggers(context: BlockTriggerContext): BlockTrigger[] {
  const out: BlockTrigger[] = [];
  if (context.claimFalsified !== undefined)
    out.push(...detectClaimFalsified(context.claimFalsified));
  if (context.corroborated !== undefined)
    out.push(...detectCorroboratedUnderConstraint(context.corroborated));
  if (context.obligations !== undefined) out.push(...detectObligationFailure(context.obligations));
  if (context.restorations !== undefined) out.push(...detectTestTamperProven(context.restorations));
  return out;
}
