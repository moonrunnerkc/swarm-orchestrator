// The typed shapes for verifiable-evidence block triggers. Kept separate from
// the detector logic (block-triggers.ts) so the evidence contract reads on its
// own: each trigger carries a JSON-serializable evidence object and the exact
// command to reproduce it, so a blocked author can re-run the proof and see the
// same result. The detectors and the ledger writer import from here; callers
// import the re-export from block-triggers.ts.

import type { CheatCategory } from '../types';
import type { RestorationControls } from '../execution-grounded/test-restoration';

/** The four verifiable-evidence triggers. Each is self-certifying and
 *  label-free: its truth comes from running the change, not from a label. */
export type BlockTriggerKind =
  | 'claim-falsified'
  | 'corroborated-under-constraint'
  | 'obligation-failure'
  | 'test-tamper-proven';

/** Every trigger kind, in a fixed order, for callers that iterate over all of
 *  them (the calibrator and the eligibility policy). */
export const ALL_BLOCK_TRIGGER_KINDS: readonly BlockTriggerKind[] = [
  'claim-falsified',
  'corroborated-under-constraint',
  'obligation-failure',
  'test-tamper-proven',
];

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
  /** Per-side repro statuses across the re-run controls, in run order. The
   *  claim is only control-confirmed (and so able to gate) when both pre runs
   *  and both post runs failed: the repro reproduces on the base and on the
   *  patched code, twice. A single-entry array is a firing that was not re-run
   *  (advisory only, never green). */
  preRuns: string[];
  postRuns: string[];
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
  /** Pass status of each run, in run order. A confirmed failure ran twice and
   *  failed both times (`[false, false]`); a single run records `[false]`. The
   *  trigger is only control-confirmed (able to gate) when it failed twice. */
  runsPassed: boolean[];
}

/**
 * A differential test-restoration proof: the PR's test changes were reverted
 * in a sandbox, the restored tests failed twice with identical identity
 * against the PR's source, the same tests passed on the base checkout, and the
 * tampered suite passed as submitted. Execution proves the PR weakened a test
 * that was guarding a real failure. Evidence is the proof record's published
 * facts; the controls must all be true for the trigger to ever gate.
 */
export interface TestTamperProvenEvidence {
  kind: 'test-tamper-proven';
  /** Pinned to `proven`: only a proven restoration record becomes evidence. */
  verdict: 'proven';
  /** The structural finding's cheat category the proof backs. */
  category: CheatCategory;
  /** Test files whose PR hunks were reverted to restore the original tests. */
  testFiles: string[];
  /** Failing-test identities from the restored runs (identical across both). */
  failingTests: string[];
  /** The proof's three internal controls, published as recorded. A candidate
   *  is only emitted when all three are true; null means a run never executed. */
  controls: RestorationControls;
  /** Exact command a human runs in a fresh checkout to see the restored test fail. */
  reproduceCommand: string;
}

export type BlockTriggerEvidence =
  | ClaimFalsifiedEvidence
  | CorroboratedUnderConstraintEvidence
  | ObligationFailureEvidence
  | TestTamperProvenEvidence;

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
