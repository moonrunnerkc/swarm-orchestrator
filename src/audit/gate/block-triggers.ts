// Verifiable-evidence block triggers. A structural detector cannot earn a
// block in this repo: scored against the AI-labeled real corpus its precision
// is 0, and human labeling is out of scope, so the label road is closed (see
// benchmarks/real-corpus/promotions.json). The block decision therefore comes
// from self-certifying runtime facts, not from a detector's opinion: a fix
// claim execution contradicts, a structural finding a surviving mutant or
// coverage gap corroborates on the same line, or a declared obligation that
// fails on the patched workspace. Each candidate carries a JSON-serializable
// evidence object and the exact command to reproduce it, so a blocked author
// can re-run the proof and see the same result.
//
// This module is the typed-candidate layer only. It produces candidates and
// their evidence; whether a candidate is allowed to gate is decided by the
// revert-calibrated eligibility policy (benchmarks/real-corpus/
// block-eligibility.json), and the gate-mode wiring lives in the audit CLI.

import * as crypto from 'crypto';
import { canonicalJson } from '../../ledger/ledger';
import type { CheatCategory } from '../types';
import type { PrIntent } from '../cheat-detector/pr-intent';
import type { ReproComparison } from '../execution-grounded';
import { renderReproCommand, type IssueRef } from '../execution-grounded/issue-repro';
import type { TestRunner } from '../execution-grounded/sandbox';

/** The three verifiable-evidence triggers. Each is self-certifying and
 *  label-free: its truth comes from running the change, not from a label. */
export type BlockTriggerKind =
  | 'claim-falsified'
  | 'corroborated-under-constraint'
  | 'obligation-failure';

/**
 * The PR claims a fix (a close-keyword issue link or a fix-claim title/body),
 * and the linked issue's repro, executed against the patched checkout, still
 * fails. Execution contradicts the claim. Evidence is the repro command and
 * its failing output.
 */
export interface ClaimFalsifiedEvidence {
  kind: 'claim-falsified';
  /** Issue whose repro contradicts the fix claim, e.g. `owner/repo#123`. */
  issueRef: string;
  /** The PR's own fix-claim text, quoted back so the contradiction is plain. */
  claim: string;
  /** The command that ran the repro against the patched checkout. */
  reproCommand: string;
  /** Repro status before the PR (expected `failed`: the repro reproduces). */
  preStatus: string;
  /** Repro status after the PR (`failed`: the claimed fix did not land). */
  postStatus: string;
  /** Captured failing output from the post-PR repro run. */
  postOutput: string;
}

/**
 * A structural finding in a category an execution signal can corroborate
 * (coverage-erosion, assertion-strip, test-relaxation, fake-refactor) lands on
 * a changed line where a mutant survived or no test ran. Neither half blocks
 * alone; the conjunction is the signal. Evidence is the finding plus the mutant
 * ids or the uncovered lines on that same line.
 */
export interface CorroboratedUnderConstraintEvidence {
  kind: 'corroborated-under-constraint';
  category: CheatCategory;
  file: string;
  line: number;
  endLine?: number;
  /** The runtime constraint backing the structural finding on this line. */
  signal: 'surviving-mutant' | 'coverage-gap';
  /** Surviving mutant ids on the line, set when `signal` is surviving-mutant. */
  mutants?: string[];
  /** Uncovered changed lines, set when `signal` is coverage-gap. */
  uncoveredLines?: number[];
  /** The structural finding's own evidence snippet. */
  findingEvidence: string;
}

/**
 * A declared contract obligation (build, test, property, falsifier) failed on
 * the patched workspace. This is the orchestrator's existing hard signal,
 * reused as a block trigger. Evidence is the obligation command and its
 * captured output.
 */
export interface ObligationFailureEvidence {
  kind: 'obligation-failure';
  obligationType: string;
  obligationIndex?: number;
  /** The obligation command that failed. */
  command: string;
  /** Captured failure output / detail from the verifier. */
  output: string;
}

export type BlockTriggerEvidence =
  | ClaimFalsifiedEvidence
  | CorroboratedUnderConstraintEvidence
  | ObligationFailureEvidence;

/**
 * A block-trigger candidate. `reproduce` is the exact command the author runs
 * to regenerate `evidence` and see the same result; `summary` is the one-line
 * human framing. A candidate is not a block on its own: the eligibility policy
 * decides whether its kind is allowed to gate.
 */
export interface BlockTrigger {
  kind: BlockTriggerKind;
  summary: string;
  reproduce: string;
  evidence: BlockTriggerEvidence;
}

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
    const claim = input.prIntent.evidence.length > 0 ? input.prIntent.evidence : `closes ${issueRef}`;
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
