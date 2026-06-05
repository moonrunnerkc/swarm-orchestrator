// The typed shapes for verifiable-evidence block triggers. Kept separate from
// the detector logic (block-triggers.ts) so the evidence contract reads on its
// own: each trigger carries a JSON-serializable evidence object and the exact
// command to reproduce it, so a blocked author can re-run the proof and see the
// same result. The detectors and the ledger writer import from here; callers
// import the re-export from block-triggers.ts.

import type { CheatCategory } from '../types';

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
