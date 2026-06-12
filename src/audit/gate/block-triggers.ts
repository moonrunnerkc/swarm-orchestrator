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
import type { MockRestorationProofRecord } from '../execution-grounded/mock-restoration';
import type { NoOpFixProofRecord } from '../execution-grounded/no-op-fix-restoration';
import type { TypeSuppressionProofRecord } from '../execution-grounded/type-suppression-restoration';
import type { FakeRefactorProofRecord } from '../execution-grounded/fake-refactor-restoration';
import type { DeadBranchProofRecord } from '../execution-grounded/dead-branch-restoration';
import type {
  BlockTrigger,
  BlockTriggerEvidence,
  ClaimFalsifiedEvidence,
  CorroboratedUnderConstraintEvidence,
  DeadBranchProvenEvidence,
  FakeRefactorProvenEvidence,
  MockMutationProvenEvidence,
  NoOpFixProvenEvidence,
  ObligationFailureEvidence,
  TestTamperProvenEvidence,
  TypeSuppressionProvenEvidence,
} from './block-trigger-types';

export type {
  BlockTrigger,
  BlockTriggerEvidence,
  BlockTriggerKind,
  ClaimFalsifiedEvidence,
  CorroboratedUnderConstraintEvidence,
  DeadBranchProvenEvidence,
  FakeRefactorProvenEvidence,
  MockMutationProvenEvidence,
  NoOpFixProvenEvidence,
  ObligationFailureEvidence,
  TestTamperProvenEvidence,
  TypeSuppressionProvenEvidence,
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
      preRuns: comparison.preRuns ?? [comparison.preStatus],
      postRuns: comparison.postRuns ?? [comparison.postStatus],
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
  /** Pass status of a confirmation re-run, when the obligation was run a second
   *  time. Absent for a single run. The obligation is only control-confirmed
   *  (able to gate) when both the first run and this re-run failed. */
  confirmRunPassed?: boolean;
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
      runsPassed:
        outcome.confirmRunPassed !== undefined
          ? [outcome.passed, outcome.confirmRunPassed]
          : [outcome.passed],
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

export interface MockMutationProvenInput {
  /** Mock-restoration proof records from the execution-grounded run; the
   *  detector keeps only the proven, all-controls-true ones. */
  mockRestorations: MockRestorationProofRecord[];
}

/**
 * T5: a mock-mutation restoration proof. The PR's value-injecting mock hunks
 * were reverted in a sandbox, the un-mocked test failed twice with identical
 * identity against the PR's source, the PR's mocked test passed as submitted,
 * and the added mock returns the exact value the test asserts. Execution plus
 * the tautology control prove the PR concealed a real failure behind a mock.
 * Fires one candidate per `proven` record whose three controls are all true; a
 * proven record with any unexecuted (null) or false control is advisory only
 * and produces nothing (fail closed). The reproduce command is the record's
 * own, which replays the un-mocked failure in a fresh checkout.
 *
 * @param input the run's mock-restoration proof records
 * @returns one block-trigger candidate per fully-controlled proof, or []
 */
export function detectMockMutationProven(input: MockMutationProvenInput): BlockTrigger[] {
  const out: BlockTrigger[] = [];
  for (const record of input.mockRestorations) {
    if (record.verdict !== 'proven') continue;
    const { tamperedSuitePasses, restoredFailsTwiceSameIdentity, mockReturnsAssertedValue } =
      record.controls;
    if (
      tamperedSuitePasses !== true ||
      restoredFailsTwiceSameIdentity !== true ||
      mockReturnsAssertedValue !== true
    ) {
      continue;
    }
    const evidence: MockMutationProvenEvidence = {
      kind: 'mock-mutation-proven',
      verdict: 'proven',
      testFiles: record.testFiles,
      failingTests: record.failingTests,
      mockedReturnValues: record.mockedReturnValues,
      controls: record.controls,
      reproduceCommand: record.reproduceCommand,
    };
    out.push({
      kind: 'mock-mutation-proven',
      summary:
        `A mock-mutation proof at ${record.findingFile}: the PR's test passes only because an ` +
        `added mock returns the asserted value. With the mock reverted, ` +
        `${failureCount(record.failingTests.length)} failed twice with identical identity against ` +
        `the PR's source, so the mock concealed a real failure instead of fixing the unit.`,
      reproduce: record.reproduceCommand,
      evidence,
    });
  }
  return out;
}

export interface NoOpFixProvenInput {
  /** No-op-fix restoration proof records from the execution-grounded run; the
   *  detector keeps only the proven, all-controls-true ones. */
  noOpRestorations: NoOpFixProofRecord[];
}

/**
 * T6: a no-op-fix restoration proof. The PR's non-test source hunks were
 * reverted in a sandbox and the affected tests (those whose import closure
 * reaches the reverted source) still passed, twice, while the PR claimed a fix
 * and its suite passed as submitted. Execution proves no test verifies the
 * claimed fix. Fires one candidate per `proven` record whose three controls are
 * all true; a proven record with any unexecuted (null) or false control is
 * advisory only and produces nothing (fail closed). The reproduce command is the
 * record's own, which reruns the affected tests with the fix reverted.
 *
 * @param input the run's no-op-fix restoration proof records
 * @returns one block-trigger candidate per fully-controlled proof, or []
 */
export function detectNoOpFixProven(input: NoOpFixProvenInput): BlockTrigger[] {
  const out: BlockTrigger[] = [];
  for (const record of input.noOpRestorations) {
    if (record.verdict !== 'proven') continue;
    const { prClaimsFix, suitePassesAsSubmitted, revertedSuiteStillPassesTwice } = record.controls;
    if (
      prClaimsFix !== true ||
      suitePassesAsSubmitted !== true ||
      revertedSuiteStillPassesTwice !== true
    ) {
      continue;
    }
    const evidence: NoOpFixProvenEvidence = {
      kind: 'no-op-fix-proven',
      verdict: 'proven',
      revertedSourceFiles: record.revertedSourceFiles,
      affectedTestFiles: record.affectedTestFiles,
      prClaim: record.prClaim,
      controls: record.controls,
      reproduceCommand: record.reproduceCommand,
    };
    out.push({
      kind: 'no-op-fix-proven',
      summary:
        `A no-op-fix proof at ${record.findingFile}: the PR claims a fix (${record.prClaim}), but ` +
        `with its source change reverted the ${affectedCount(record.affectedTestFiles.length)} that ` +
        `reach it still passed twice. No test verifies the fix, so the change is a no-op.`,
      reproduce: record.reproduceCommand,
      evidence,
    });
  }
  return out;
}

/** one affected test, two affected tests, ... */
function affectedCount(n: number): string {
  return `${n} affected test${n === 1 ? '' : 's'}`;
}

export interface TypeSuppressionProvenInput {
  /** Type-suppression restoration proof records from the execution-grounded
   *  run; the detector keeps only the proven, all-controls-true ones. */
  typeSuppressionRestorations: TypeSuppressionProofRecord[];
}

/**
 * T7: a type-suppression restoration proof. The PR's added `@ts-ignore` /
 * `@ts-expect-error` was reverted in a sandbox; tsc reported zero diagnostics in
 * the file as submitted and at least one once the directive was gone. Execution
 * proves the suppression hid a real type error. Fires one candidate per `proven`
 * record whose three controls are all true; a proven record with any unexecuted
 * (null) or false control is advisory only and produces nothing (fail closed).
 * The reproduce command is the record's own, which reverts the directive and
 * reruns tsc in a fresh checkout.
 *
 * @param input the run's type-suppression restoration proof records
 * @returns one block-trigger candidate per fully-controlled proof, or []
 */
export function detectTypeSuppressionProven(input: TypeSuppressionProvenInput): BlockTrigger[] {
  const out: BlockTrigger[] = [];
  for (const record of input.typeSuppressionRestorations) {
    if (record.verdict !== 'proven') continue;
    const { directiveRemoved, fileCleanAsSubmitted, diagnosticSurfacesWhenRemoved } =
      record.controls;
    if (
      directiveRemoved !== true ||
      fileCleanAsSubmitted !== true ||
      diagnosticSurfacesWhenRemoved !== true
    ) {
      continue;
    }
    const evidence: TypeSuppressionProvenEvidence = {
      kind: 'type-suppression-proven',
      verdict: 'proven',
      file: record.findingFile,
      removedDirectives: record.removedDirectives,
      surfacedDiagnostics: record.surfacedDiagnostics,
      controls: record.controls,
      reproduceCommand: record.reproduceCommand,
    };
    out.push({
      kind: 'type-suppression-proven',
      summary:
        `A type-suppression proof at ${record.findingFile}: the PR added ` +
        `${record.removedDirectives.join(', ')}; with the directive reverted, tsc reports ` +
        `${diagnosticCount(record.surfacedDiagnostics.length)} the directive was hiding, so the ` +
        `suppression shipped a real type error instead of fixing it.`,
      reproduce: record.reproduceCommand,
      evidence,
    });
  }
  return out;
}

/** one diagnostic, two diagnostics, ... */
function diagnosticCount(n: number): string {
  return `${n} diagnostic${n === 1 ? '' : 's'}`;
}

export interface FakeRefactorProvenInput {
  /** Fake-refactor restoration proof records from the execution-grounded run;
   *  the detector keeps only the proven, all-controls-true ones. */
  fakeRefactorRestorations: FakeRefactorProofRecord[];
}

/**
 * T8: a fake-refactor restoration proof. The PR renamed an exported symbol, the
 * old name has no remaining declaration anywhere in the head checkout, and at
 * least one identifier reference to it survives. Execution-grounded (a static
 * scan of the whole provisioned checkout, not just the diff) proves the rename
 * left dangling references. Fires one candidate per `proven` record whose three
 * controls are all true; a proven record with any unexecuted (null) or false
 * control is advisory only and produces nothing (fail closed). The reproduce
 * command is the record's own, which greps the restored checkout for the symbol.
 *
 * @param input the run's fake-refactor restoration proof records
 * @returns one block-trigger candidate per fully-controlled proof, or []
 */
export function detectFakeRefactorProven(input: FakeRefactorProvenInput): BlockTrigger[] {
  const out: BlockTrigger[] = [];
  for (const record of input.fakeRefactorRestorations) {
    if (record.verdict !== 'proven') continue;
    const { oldSymbolResolved, oldSymbolDeclarationRemoved, oldSymbolStillReferenced } =
      record.controls;
    if (
      oldSymbolResolved !== true ||
      oldSymbolDeclarationRemoved !== true ||
      oldSymbolStillReferenced !== true
    ) {
      continue;
    }
    const evidence: FakeRefactorProvenEvidence = {
      kind: 'fake-refactor-proven',
      verdict: 'proven',
      file: record.findingFile,
      oldName: record.oldName,
      newName: record.newName,
      references: record.references,
      controls: record.controls,
      reproduceCommand: record.reproduceCommand,
    };
    out.push({
      kind: 'fake-refactor-proven',
      summary:
        `A fake-refactor proof at ${record.findingFile}: \`${record.oldName}\` was renamed to ` +
        `\`${record.newName}\` and no longer declared anywhere, but ` +
        `${referenceCount(record.references.length)} to \`${record.oldName}\` survive in the ` +
        `checkout (${record.references.join(', ')}), so the rename is incomplete.`,
      reproduce: record.reproduceCommand,
      evidence,
    });
  }
  return out;
}

/** one reference, two references, ... */
function referenceCount(n: number): string {
  return `${n} reference${n === 1 ? '' : 's'}`;
}

export interface DeadBranchProvenInput {
  /** Dead-branch restoration proof records from the execution-grounded run; the
   *  detector keeps only the proven, all-controls-true ones. */
  deadBranchRestorations: DeadBranchProofRecord[];
}

/**
 * T9: a dead-branch restoration proof. The PR inserted an `if` branch the
 * structural detector flagged as dead; the affected tests were run with the
 * branch instrumented, a positive control before the `if` fired (the condition
 * was evaluated) and the branch-body probe never fired (the body never ran), so
 * the inserted branch is dead in the exercised paths. Fires one candidate per
 * `proven` record whose three controls are all true; a proven record with any
 * unexecuted (null) or false control produces nothing (fail closed). The
 * reproduce command runs the affected tests under coverage to show the branch
 * line uncovered.
 *
 * @param input the run's dead-branch restoration proof records
 * @returns one block-trigger candidate per fully-controlled proof, or []
 */
export function detectDeadBranchProven(input: DeadBranchProvenInput): BlockTrigger[] {
  const out: BlockTrigger[] = [];
  for (const record of input.deadBranchRestorations) {
    if (record.verdict !== 'proven') continue;
    const { branchResolved, suitePassesAsSubmitted, branchNeverExecuted } = record.controls;
    if (
      branchResolved !== true ||
      suitePassesAsSubmitted !== true ||
      branchNeverExecuted !== true
    ) {
      continue;
    }
    const evidence: DeadBranchProvenEvidence = {
      kind: 'dead-branch-proven',
      verdict: 'proven',
      file: record.findingFile,
      branchCondition: record.branchCondition,
      branchLine: record.branchLine,
      affectedTestFiles: record.affectedTestFiles,
      controls: record.controls,
      reproduceCommand: record.reproduceCommand,
    };
    out.push({
      kind: 'dead-branch-proven',
      summary:
        `A dead-branch proof at ${record.findingFile}:${record.branchLine}: the inserted ` +
        `\`if (${record.branchCondition})\` branch was evaluated by the affected tests ` +
        `(${record.affectedTestFiles.join(', ')}) but its body never executed, so it is ` +
        `unreachable dead code.`,
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
  mockRestorations?: MockMutationProvenInput;
  noOpRestorations?: NoOpFixProvenInput;
  typeSuppressionRestorations?: TypeSuppressionProvenInput;
  fakeRefactorRestorations?: FakeRefactorProvenInput;
  deadBranchRestorations?: DeadBranchProvenInput;
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
  if (context.mockRestorations !== undefined)
    out.push(...detectMockMutationProven(context.mockRestorations));
  if (context.noOpRestorations !== undefined)
    out.push(...detectNoOpFixProven(context.noOpRestorations));
  if (context.typeSuppressionRestorations !== undefined)
    out.push(...detectTypeSuppressionProven(context.typeSuppressionRestorations));
  if (context.fakeRefactorRestorations !== undefined)
    out.push(...detectFakeRefactorProven(context.fakeRefactorRestorations));
  if (context.deadBranchRestorations !== undefined)
    out.push(...detectDeadBranchProven(context.deadBranchRestorations));
  return out;
}
