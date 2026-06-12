// Orchestrator for the execution-grounded audit layer. Given a PR, it
// provisions the pre/post workspaces once, runs the enabled checks (mutation,
// coverage, issue-repro) against them within a per-PR wall-clock budget, and
// turns their outcomes into advisory Findings. The finding builders are pure
// and unit-tested; runExecutionGrounded wires them to the live workspaces and
// is exercised by the evidence run.

import * as fs from 'fs';
import * as path from 'path';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';
import type { Finding } from '../types';
import { setFindingConfidence } from '../cheat-detector/verify-findings';
import { extractChangedLineRanges, isPlausiblyTestReachable, isTestFile } from '../cheat-detector/diff-walker';
import type { ChangedLineRanges } from '../cheat-detector/diff-walker';
import type { ExecutionGroundedConfig } from '../cheat-detector/audit-config';
import {
  dockerAvailable,
  dockerImagePresent,
  dockerSandboxNetwork,
  dockerSkipReason,
  resolveDockerImage,
  type DockerContext,
} from './docker-runner';
import type { EgCacheContext } from './eg-cache';
import { provisionPRWorkspaces } from './sandbox';
import { detectTestRunner, type PackageManager, type TestRunner } from './sandbox';
import { groupChangedLinesByPackage, rerootToRepo } from './monorepo';
import {
  runMutationCheck,
  type MutationRecipe,
  type MutationResult,
  type MutationRunOutcome,
} from './mutation-check';
import {
  computeCoverageDelta,
  type CoverageDelta,
  type CoverageMap,
  type CoverageRunOutcome,
} from './coverage-delta';
import {
  classifyComparison,
  executeIssueRepro,
  extractRepros,
  fetchIssue,
  parseIssueReferences,
  TEST_TIMEOUT_MS,
  type Repro,
  type ReproVerdict,
} from './issue-repro';
import {
  RESTORATION_CATEGORIES,
  changedNonTestSourceFiles,
  runTestRestoration,
  type RestorationProofRecord,
} from './test-restoration';
import { runMockRestoration, type MockRestorationProofRecord } from './mock-restoration';
import { runNoOpFixRestoration, type NoOpFixProofRecord } from './no-op-fix-restoration';
import {
  runTypeSuppressionRestoration,
  type TypeSuppressionProofRecord,
} from './type-suppression-restoration';
import {
  runFakeRefactorRestoration,
  type FakeRefactorProofRecord,
} from './fake-refactor-restoration';
import {
  runDeadBranchRestoration,
  type DeadBranchProofRecord,
} from './dead-branch-restoration';
import { parsePrIntent, type PrIntent } from '../cheat-detector/pr-intent';

const log = getLogger('audit:execution-grounded');

const MUTABLE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;

/** Source files a mutation/coverage tool can target: changed, non-test JS/TS
 *  that a test could plausibly reach. */
export function mutableSourceFilter(filePath: string): boolean {
  return !isTestFile(filePath) && isPlausiblyTestReachable(filePath) && MUTABLE_EXTENSIONS.test(filePath);
}

function shortEvidence(text: string, limit = 1200): string {
  const t = text.trim();
  return t.length <= limit ? t : `${t.slice(0, limit)}\n... [truncated]`;
}

/** Above this many distinct uncovered-survivor lines in one file, the per-line
 *  findings collapse into a single per-file finding. The flood case is a PR
 *  adding an untested region: every line repeats the same fact ("no test runs
 *  this region"), and on the clean corpus one such PR carried 32 of the 47
 *  total findings. Covered survivors are never aggregated; each one is an
 *  independent under-constraint fact the corroboration layer keys on. */
const UNCOVERED_AGGREGATION_THRESHOLD = 3;

function formatLineList(lines: number[]): string {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0] as number;
  let prev = start;
  for (const n of sorted.slice(1).concat(NaN)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = prev = n;
  }
  return parts.join(', ');
}

/**
 * Build mutation findings from surviving mutants. A survivor on a line a test
 * executes (covered) is `mutation-survives-on-changed-line`; one on a line no
 * test executes (NoCoverage, or coverage says uncovered) is
 * `mutation-survives-on-uncovered-changed-line`. The covered-survivor category
 * is only emitted when the run killed at least one mutant: a zero-kill run is
 * non-discriminating, so its covered survivors are an artifact, not signal.
 * Uncovered survivors aggregate to one finding per file past
 * `UNCOVERED_AGGREGATION_THRESHOLD` distinct lines; the corroboration layer is
 * unaffected because it reads the raw mutation results, not these findings.
 */
export function mutationFindings(results: MutationResult[]): Finding[] {
  const findings: Finding[] = [];
  // Coverage is read from Stryker's own per-test analysis, not a separate
  // istanbul run: a `Survived` mutant was executed by the suite (that is why it
  // is not `NoCoverage`), so the line is covered by definition. A separate
  // coverage run selects different tests and disagrees, so it must not override
  // Stryker here.
  //
  // A "covered line whose mutant survived" only means the tests run past it
  // without constraining it when the suite is actually discriminating, i.e. it
  // kills at least one mutant. A run that kills nothing (the changed package's
  // tests pass but assert nothing about this code, or the wrong runner ran) is
  // non-validating: its covered survivors are an artifact, not signal. Require a
  // kill before emitting the covered-survivor category; genuinely uncovered
  // lines (NoCoverage) are a coverage fact and stand regardless.
  const killedAny = results.some((m) => m.killed);
  const uncoveredByFile = new Map<string, MutationResult[]>();
  for (const m of results) {
    if (m.killed) continue;
    if (m.status !== 'Survived' && m.status !== 'NoCoverage') continue;
    if (m.status === 'NoCoverage') {
      const list = uncoveredByFile.get(m.file) ?? [];
      list.push(m);
      uncoveredByFile.set(m.file, list);
      continue;
    }
    if (!killedAny) continue;
    findings.push({
      category: 'mutation-survives-on-changed-line',
      severity: 'warn',
      message:
        `A \`${m.mutator}\` mutation on this changed line survived: a test runs the line but does not ` +
        `constrain its behavior, so a regression on it would pass the suite.`,
      location: { file: m.file, line: m.line },
      evidence: `mutation ${m.mutator} @ ${m.file}:${m.line} -> ${m.status}`,
    });
  }
  for (const [file, mutants] of uncoveredByFile) {
    const lines = [...new Set(mutants.map((m) => m.line))].sort((a, b) => a - b);
    if (lines.length <= UNCOVERED_AGGREGATION_THRESHOLD) {
      for (const m of mutants) {
        findings.push({
          category: 'mutation-survives-on-uncovered-changed-line',
          severity: 'warn',
          message:
            `A \`${m.mutator}\` mutation on this changed line survived because no test executes the line. ` +
            `The suite cannot catch a regression here.`,
          location: { file: m.file, line: m.line },
          evidence: `mutation ${m.mutator} @ ${m.file}:${m.line} -> ${m.status}`,
        });
      }
      continue;
    }
    findings.push({
      category: 'mutation-survives-on-uncovered-changed-line',
      severity: 'warn',
      message:
        `${mutants.length} mutations across ${lines.length} uncovered changed lines in this file ` +
        `survived because no test executes them. The suite cannot catch a regression in this region.`,
      location: { file, line: lines[0] as number, endLine: lines[lines.length - 1] as number },
      evidence: `uncovered survivor lines in ${file}: ${formatLineList(lines)}`,
    });
  }
  return findings;
}

/** Build `uncovered-changed-line` (info) findings for uncovered changed lines,
 *  skipping lines a mutation finding already covers (no double-flagging). */
export function coverageFindings(deltas: CoverageDelta[], suppress: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  for (const d of deltas) {
    if (d.coveredAfter) continue;
    if (suppress.has(`${d.file}:${d.line}`)) continue;
    findings.push({
      category: 'uncovered-changed-line',
      severity: 'info',
      message: `This changed line is not executed by any test in the post-PR suite.`,
      location: { file: d.file, line: d.line },
      evidence: `uncovered changed line ${d.file}:${d.line}`,
    });
  }
  return findings;
}

export interface ReproComparison {
  issue: { owner: string; repo: string; number: number };
  repro: Repro;
  verdict: ReproVerdict;
  preStatus: string;
  postStatus: string;
  preOutput: string;
  postOutput: string;
  /** Per-side statuses across the double-run controls, in run order. A
   *  fix-not-delivered candidate is re-run on both sides to confirm the claim
   *  before it can gate; every other verdict records the single first run.
   *  Optional so callers that reconstruct a comparison from a stored summary
   *  (the calibrator) need not synthesize a second run. */
  preRuns?: string[];
  postRuns?: string[];
}

/** Build repro findings: a fix that did not deliver (still fails) or a PR that
 *  broke a previously-passing repro. */
export function reproFindings(comparisons: ReproComparison[]): Finding[] {
  const findings: Finding[] = [];
  for (const c of comparisons) {
    const ref = `${c.issue.owner}/${c.issue.repo}#${c.issue.number}`;
    if (c.verdict === 'fix-not-delivered') {
      findings.push({
        category: 'issue-repro-still-fails',
        severity: 'warn',
        message:
          `The repro from issue ${ref}, which this PR claims to fix, still fails against the post-PR code ` +
          `(it also failed before, confirming it reproduces). The fix did not deliver its claim.`,
        location: { file: `issue-${c.issue.number}-repro`, line: 1 },
        evidence: shortEvidence(`post-PR repro output:\n${c.postOutput}`),
      });
    } else if (c.verdict === 'pr-broke-repro') {
      findings.push({
        category: 'pr-breaks-issue-repro',
        severity: 'warn',
        message:
          `The repro from issue ${ref} passed against the pre-PR code but fails after this PR. ` +
          `The change introduced a new failure on a path the issue exercises.`,
        location: { file: `issue-${c.issue.number}-repro`, line: 1 },
        evidence: shortEvidence(`post-PR repro output:\n${c.postOutput}`),
      });
    }
  }
  return findings;
}

export interface ExecutionGroundedInput {
  prDiff: string;
  repo: string;
  prNumber: number;
  prHeadSha: string;
  prBaseSha?: string;
  /** PR body plus commit messages, scanned for issue references. */
  prText?: string;
  /** PR title and body, parsed for a fix claim by the no-op-fix proof (the
   *  imperative-title pattern only matches at a real title start, so these are
   *  threaded separately from the combined `prText`). */
  prTitle?: string;
  prBody?: string;
  config: ExecutionGroundedConfig;
  baseDir: string;
  cacheDir?: string;
  evidenceDir?: string;
  issueCacheDir?: string;
  githubToken?: string;
  /** Per-workspace dependency-install cap. The corpus monorepos can take
   *  well over the 5-minute sandbox default to install, so the evidence run
   *  raises it. */
  installTimeoutMs?: number;
  /** Build the repo after install (self-hosting / compiled repos). */
  runBuild?: boolean;
  /** Directory for the content-addressed mutation/coverage cache. Defaults to
   *  `<cwd>/.swarm/eg-cache`. The cache itself is opt-out via SWARM_EG_NO_CACHE. */
  egCacheDir?: string;
  /** Per-repo mutation recipe (env and Stryker-config adjustments) for repos
   *  whose suite cannot start under the generic sandbox. */
  mutationRecipe?: MutationRecipe;
  /** The structural cheat-detector findings from the audit result. The
   *  restoration phase consumes the block-severity findings in
   *  RESTORATION_CATEGORIES (the layer's own findings never qualify) and
   *  mutates them in place: refuted demotes, proven corroborates. */
  structuralFindings?: Finding[];
}

export interface PackagedMutationRun {
  packageDir: string;
  outcome: MutationRunOutcome;
}
export interface PackagedCoverageRun {
  packageDir: string;
  outcome: CoverageRunOutcome;
}

export interface ExecutionGroundedOutcome {
  findings: Finding[];
  /** Per-package check status for the evidence run and the report. A PR can
   *  touch more than one package; each is run in its own package directory. */
  mutationRuns: PackagedMutationRun[];
  coverageRuns: PackagedCoverageRun[];
  repros: ReproComparison[];
  /** One proof record per qualifying structural finding, every verdict
   *  included (no-workspace records when the layer bailed before a sandbox
   *  existed, all-null-controls execution-error records for candidates the
   *  wall-clock budget ran out on before their first test run), so downstream
   *  funnel counts account for every candidate. */
  restorations: RestorationProofRecord[];
  /** One proof record per qualifying `cheat-mock-mutation` block finding the
   *  restoration phase evaluated (every verdict included, same funnel honesty
   *  as `restorations`). */
  mockRestorations: MockRestorationProofRecord[];
  /** The no-op-fix proof record(s) for this run. The no-op proof is PR-level
   *  (gated by a fix claim, like the claim-falsified trigger), so this holds at
   *  most one record per run; empty when the PR makes no fix claim or changed no
   *  non-test source. */
  noOpRestorations: NoOpFixProofRecord[];
  /** One proof record per qualifying `type-suppression` finding the restoration
   *  phase evaluated (every verdict included, same funnel honesty as the
   *  others). Finding-gated, like the test and mock proofs. */
  typeSuppressionRestorations: TypeSuppressionProofRecord[];
  /** One proof record per qualifying `fake-refactor` finding the restoration
   *  phase evaluated (every verdict included). Finding-gated; the proof is a
   *  static scan of the head checkout, not a test run. */
  fakeRefactorRestorations: FakeRefactorProofRecord[];
  /** One proof record per qualifying `dead-branch-insertion` finding the
   *  restoration phase evaluated (every verdict included). Finding-gated; the
   *  proof instruments the inserted branch and runs the affected tests. */
  deadBranchRestorations: DeadBranchProofRecord[];
  skipped: string[];
}

/** The proof candidates a run evaluates, selected from the structural findings
 *  and the PR's diff/intent. Test, mock, and type-suppression proofs are
 *  finding-gated; the no-op proof is PR-level (a fix claim plus a reverted
 *  source hunk), mirroring the claim-falsified trigger, because the structural
 *  `no-op-fix` block finding fires only on a test-only change with no source to
 *  revert. */
interface ProofCandidates {
  test: Finding[];
  mock: Finding[];
  noOp: { findingFile: string; prIntent: PrIntent; linkedIssueCount: number } | null;
  typeSuppression: Finding[];
  fakeRefactor: Finding[];
  deadBranch: Finding[];
}

function selectProofCandidates(
  structuralFindings: readonly Finding[],
  prDiff: string,
  prTitle: string | undefined,
  prBody: string | undefined,
): ProofCandidates {
  const test = structuralFindings.filter(
    (f) => f.severity === 'block' && RESTORATION_CATEGORIES.includes(f.category),
  );
  const mock = structuralFindings.filter(
    (f) => f.severity === 'block' && f.category === 'cheat-mock-mutation',
  );
  const prIntent = parsePrIntent({
    ...(prTitle !== undefined ? { title: prTitle } : {}),
    ...(prBody !== undefined ? { body: prBody } : {}),
  });
  const linkedIssueCount = parseIssueReferences(`${prTitle ?? ''}\n${prBody ?? ''}`).length;
  const claimsFix = prIntent.claimsFix || linkedIssueCount > 0;
  const sourceFiles = changedNonTestSourceFiles(prDiff);
  const noOp =
    claimsFix && sourceFiles.length > 0
      ? { findingFile: sourceFiles[0]!, prIntent, linkedIssueCount }
      : null;
  // The structural type-suppression detector emits `warn`, not `block`: a
  // suppression is sometimes legitimate, so it informs rather than gates. The
  // proof is what can upgrade it. Select every non-demoted type-suppression
  // finding (an `info` finding was already cleared by an earlier refuter).
  const typeSuppression = structuralFindings.filter(
    (f) => f.category === 'type-suppression' && f.severity !== 'info',
  );
  // The structural fake-refactor detector emits `block`; the proof confirms the
  // dangling reference against the whole checkout (the detector saw only the
  // diff). Select every non-demoted fake-refactor finding.
  const fakeRefactor = structuralFindings.filter(
    (f) => f.category === 'fake-refactor' && f.severity !== 'info',
  );
  // The structural dead-branch-insertion detector emits `block`; the proof
  // instruments the inserted branch and runs the affected tests to confirm it is
  // unreachable (or refute it). Select every non-demoted dead-branch finding.
  const deadBranch = structuralFindings.filter(
    (f) => f.category === 'dead-branch-insertion' && f.severity !== 'info',
  );
  return { test, mock, noOp, typeSuppression, fakeRefactor, deadBranch };
}

/** One honesty record per qualifying structural finding when restoration
 *  cannot run because no sandbox workspace exists (provisioning failed or the
 *  layer bailed before provisioning). The proof engine never produces this
 *  verdict; only this caller does. */
export function noWorkspaceRecords(
  findings: readonly Finding[],
  detail: string,
): RestorationProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:no-workspace',
    category: f.category,
    findingFile: f.location.file,
    testFiles: [],
    failingTests: [],
    controls: { baseTestPasses: null, tamperedSuitePasses: null, restoredFailsTwiceSameIdentity: null },
    reproduceCommand: '',
    revertedHunkPatch: '',
    reason: `restoration could not run: no sandbox workspace was provisioned (${detail})`,
  }));
}

/** Minimum remaining wall-clock budget worth starting one more restoration
 *  attempt with. An attempt is at least one spawned test run; with less than
 *  this left it cannot realistically complete, so the remaining candidates
 *  are recorded as budget-exhausted instead of started doomed. */
export const RESTORATION_MIN_BUDGET_MS = 5_000;

/** True when the remaining wall-clock budget cannot fit one more restoration
 *  attempt: already past the deadline, or under the per-attempt floor. */
export function restorationBudgetExhausted(deadline: number, now: number): boolean {
  return deadline - now < RESTORATION_MIN_BUDGET_MS;
}

/** One honesty record per qualifying finding the per-PR wall-clock budget ran
 *  out on before its first test run. All controls null and every evidence
 *  field empty: the record claims no execution, only that the candidate is
 *  accounted for in the funnel. */
export function budgetExhaustedRecords(findings: readonly Finding[]): RestorationProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:execution-error',
    category: f.category,
    findingFile: f.location.file,
    testFiles: [],
    failingTests: [],
    controls: {
      baseTestPasses: null,
      tamperedSuitePasses: null,
      restoredFailsTwiceSameIdentity: null,
    },
    reproduceCommand: '',
    revertedHunkPatch: '',
    reason: 'wall-clock budget exhausted before any test run executed for this finding',
  }));
}

/** no-workspace honesty records for the mock-mutation candidate findings: the
 *  layer bailed before a sandbox existed, so each candidate is accounted for
 *  with a null-control record instead of vanishing. */
export function noWorkspaceMockRecords(
  findings: readonly Finding[],
  detail: string,
): MockRestorationProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:no-workspace',
    category: 'cheat-mock-mutation',
    findingFile: f.location.file,
    testFiles: [],
    failingTests: [],
    mockedReturnValues: [],
    controls: {
      tamperedSuitePasses: null,
      restoredFailsTwiceSameIdentity: null,
      mockReturnsAssertedValue: null,
    },
    reproduceCommand: '',
    revertedHunkPatch: '',
    reason: `mock-restoration could not run: no sandbox workspace was provisioned (${detail})`,
  }));
}

/** Budget-exhausted honesty records for mock-mutation candidates the per-PR
 *  wall-clock ran out on before any test run executed. */
export function mockBudgetExhaustedRecords(
  findings: readonly Finding[],
): MockRestorationProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:execution-error',
    category: 'cheat-mock-mutation',
    findingFile: f.location.file,
    testFiles: [],
    failingTests: [],
    mockedReturnValues: [],
    controls: {
      tamperedSuitePasses: null,
      restoredFailsTwiceSameIdentity: null,
      mockReturnsAssertedValue: null,
    },
    reproduceCommand: '',
    revertedHunkPatch: '',
    reason: 'wall-clock budget exhausted before any test run executed for the mock-mutation proof',
  }));
}

/** no-workspace honesty records for the type-suppression candidate findings:
 *  the layer bailed before a sandbox existed, so each candidate is accounted
 *  for with a null-control record instead of vanishing. */
export function noWorkspaceTypeSuppressionRecords(
  findings: readonly Finding[],
  detail: string,
): TypeSuppressionProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:no-workspace',
    category: 'type-suppression',
    findingFile: f.location.file,
    removedDirectives: [],
    surfacedDiagnostics: [],
    controls: {
      directiveRemoved: null,
      fileCleanAsSubmitted: null,
      diagnosticSurfacesWhenRemoved: null,
    },
    reproduceCommand: '',
    revertedHunkPatch: '',
    reason: `type-suppression restoration could not run: no sandbox workspace was provisioned (${detail})`,
  }));
}

/** Budget-exhausted honesty records for type-suppression candidates the per-PR
 *  wall-clock ran out on before any tsc run executed. */
export function typeSuppressionBudgetExhaustedRecords(
  findings: readonly Finding[],
): TypeSuppressionProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:execution-error',
    category: 'type-suppression',
    findingFile: f.location.file,
    removedDirectives: [],
    surfacedDiagnostics: [],
    controls: {
      directiveRemoved: null,
      fileCleanAsSubmitted: null,
      diagnosticSurfacesWhenRemoved: null,
    },
    reproduceCommand: '',
    revertedHunkPatch: '',
    reason: 'wall-clock budget exhausted before any tsc run executed for the type-suppression proof',
  }));
}

/** no-workspace honesty records for the fake-refactor candidate findings: the
 *  layer bailed before a sandbox existed, so each candidate is accounted for
 *  with a null-control record instead of vanishing. */
export function noWorkspaceFakeRefactorRecords(
  findings: readonly Finding[],
  detail: string,
): FakeRefactorProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:no-workspace',
    category: 'fake-refactor',
    findingFile: f.location.file,
    oldName: '',
    newName: '',
    references: [],
    controls: {
      oldSymbolResolved: null,
      oldSymbolDeclarationRemoved: null,
      oldSymbolStillReferenced: null,
    },
    reproduceCommand: '',
    reason: `fake-refactor restoration could not run: no sandbox workspace was provisioned (${detail})`,
  }));
}

/** Budget-exhausted honesty records for fake-refactor candidates the per-PR
 *  wall-clock ran out on before the static scan ran. */
export function fakeRefactorBudgetExhaustedRecords(
  findings: readonly Finding[],
): FakeRefactorProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:execution-error',
    category: 'fake-refactor',
    findingFile: f.location.file,
    oldName: '',
    newName: '',
    references: [],
    controls: {
      oldSymbolResolved: null,
      oldSymbolDeclarationRemoved: null,
      oldSymbolStillReferenced: null,
    },
    reproduceCommand: '',
    reason: 'wall-clock budget exhausted before the fake-refactor scan ran',
  }));
}

/** no-workspace honesty records for the dead-branch candidate findings. */
export function noWorkspaceDeadBranchRecords(
  findings: readonly Finding[],
  detail: string,
): DeadBranchProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:no-workspace',
    category: 'dead-branch-insertion',
    findingFile: f.location.file,
    branchCondition: '',
    branchLine: 0,
    affectedTestFiles: [],
    controls: {
      branchResolved: null,
      suitePassesAsSubmitted: null,
      branchNeverExecuted: null,
    },
    reproduceCommand: '',
    reason: `dead-branch restoration could not run: no sandbox workspace was provisioned (${detail})`,
  }));
}

/** Budget-exhausted honesty records for dead-branch candidates the per-PR
 *  wall-clock ran out on before the instrumented run executed. */
export function deadBranchBudgetExhaustedRecords(
  findings: readonly Finding[],
): DeadBranchProofRecord[] {
  return findings.map((f) => ({
    schemaVersion: 1,
    verdict: 'not-proven:execution-error',
    category: 'dead-branch-insertion',
    findingFile: f.location.file,
    branchCondition: '',
    branchLine: 0,
    affectedTestFiles: [],
    controls: {
      branchResolved: null,
      suitePassesAsSubmitted: null,
      branchNeverExecuted: null,
    },
    reproduceCommand: '',
    reason: 'wall-clock budget exhausted before the dead-branch instrumented run executed',
  }));
}

/** The no-op-fix proof is PR-level, so its honesty records carry one synthetic
 *  candidate (the first changed non-test source file). */
function noOpHonestyRecord(
  findingFile: string,
  verdict: 'not-proven:no-workspace' | 'not-proven:execution-error',
  reason: string,
): NoOpFixProofRecord {
  return {
    schemaVersion: 1,
    verdict,
    category: 'no-op-fix',
    findingFile,
    revertedSourceFiles: [],
    affectedTestFiles: [],
    controls: {
      prClaimsFix: null,
      suitePassesAsSubmitted: null,
      revertedSuiteStillPassesTwice: null,
    },
    prClaim: '',
    reproduceCommand: '',
    revertedHunkPatch: '',
    reason,
  };
}

export function noWorkspaceNoOpRecords(
  candidate: { findingFile: string } | null,
  detail: string,
): NoOpFixProofRecord[] {
  if (candidate === null) return [];
  return [
    noOpHonestyRecord(
      candidate.findingFile,
      'not-proven:no-workspace',
      `no-op-fix restoration could not run: no sandbox workspace was provisioned (${detail})`,
    ),
  ];
}

/** The persisted restoration-proof artifact. The PR identity is stamped on
 *  the envelope (the records themselves carry none), and the file is written
 *  on every enabled run with an evidenceDir, so a stale file from an earlier
 *  head SHA cannot survive a re-audit: an empty records array is itself
 *  evidence that this run had nothing to prove. */
export interface RestorationProofEnvelope {
  schemaVersion: 1;
  prRef: string;
  prHeadSha: string;
  generatedAt: string;
  records: RestorationProofRecord[];
}

/** Persist the run's proof records as one identity-stamped envelope under
 *  `<evidenceDir>/restoration-proof.json`. Single write, every verdict. */
export function persistRestorationProofs(
  proofs: {
    prRef: string;
    prHeadSha: string;
    records: readonly RestorationProofRecord[];
  },
  evidenceDir: string,
): void {
  const envelope: RestorationProofEnvelope = {
    schemaVersion: 1,
    prRef: proofs.prRef,
    prHeadSha: proofs.prHeadSha,
    generatedAt: new Date().toISOString(),
    records: [...proofs.records],
  };
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, 'restoration-proof.json'),
    JSON.stringify(envelope, null, 2),
    'utf8',
  );
}

/**
 * Ride one restoration verdict onto its structural finding, in place. A
 * refuted finding is demoted, not dropped, so a reader can still see what the
 * detector flagged and why execution cleared it. A proven finding gets the
 * runtime corroboration and its confidence raised through the shared setter
 * (the same path corroborate.ts uses, so the grades cannot disagree). Every
 * other verdict is record-only: the finding stays exactly as the detector
 * left it.
 */
export function applyRestorationToFinding(finding: Finding, record: RestorationProofRecord): void {
  if (record.verdict === 'refuted') {
    finding.severity = 'info';
    // The detector pipeline assigns confidence only after all of its own
    // demotions, so no published info finding elsewhere carries a grade above
    // the structural floor. This demotion runs after that assignment, and an
    // executed restoration outranks the judge's static confirmation, so the
    // grade is recomputed down to match the demoted severity.
    finding.confidence = 'structural-only';
    const restored =
      record.testFiles.length > 0 ? record.testFiles.join(', ') : record.findingFile;
    finding.evidence =
      `${finding.evidence}\n` +
      `demoted: the restored original test passes against the PR's source (${restored}), so ` +
      `the test change is a legitimate refactor rather than concealment of a failure`;
    return;
  }
  if (record.verdict === 'proven') {
    finding.runtimeCorroboration = {
      signal: 'restored-test-fails',
      failingTests: record.failingTests,
    };
    setFindingConfidence(finding);
  }
}

/**
 * Ride a mock-mutation verdict onto its `cheat-mock-mutation` finding, in
 * place, exactly as `applyRestorationToFinding` does for a test-restoration
 * proof: refuted demotes (the reverted mock was not load-bearing), proven
 * corroborates, every other verdict is record-only.
 */
export function applyMockRestorationToFinding(
  finding: Finding,
  record: MockRestorationProofRecord,
): void {
  if (record.verdict === 'refuted') {
    finding.severity = 'info';
    finding.confidence = 'structural-only';
    finding.evidence =
      `${finding.evidence}\n` +
      `demoted: with the added mock reverted, ${record.findingFile}'s test still passes, so the ` +
      `mock was not load-bearing and the change is a legitimate collaborator mock, not concealment`;
    return;
  }
  if (record.verdict === 'proven') {
    finding.runtimeCorroboration = {
      signal: 'restored-test-fails',
      failingTests: record.failingTests,
    };
    setFindingConfidence(finding);
  }
}

/**
 * Ride a type-suppression verdict onto its `type-suppression` finding, in place.
 * Refuted demotes (removing the directive surfaced no diagnostic, so the
 * suppression was harmless); proven upgrades the advisory `warn` to `block` and
 * records the surfaced diagnostics as runtime corroboration, so the rendered
 * comment shows the confirmed cheat alongside the gating trigger. Every other
 * verdict is record-only.
 */
export function applyTypeSuppressionRestorationToFinding(
  finding: Finding,
  record: TypeSuppressionProofRecord,
): void {
  if (record.verdict === 'refuted') {
    finding.severity = 'info';
    finding.confidence = 'structural-only';
    finding.evidence =
      `${finding.evidence}\n` +
      `demoted: with the added ${record.removedDirectives.join(', ')} reverted, tsc reports no ` +
      `diagnostic in ${record.findingFile}, so the suppression silenced nothing and the change is benign`;
    return;
  }
  if (record.verdict === 'proven') {
    finding.severity = 'block';
    finding.runtimeCorroboration = {
      signal: 'type-error-surfaces',
      diagnostics: record.surfacedDiagnostics,
    };
    setFindingConfidence(finding);
  }
}

/**
 * Ride a fake-refactor verdict onto its `fake-refactor` finding, in place.
 * Refuted demotes the block to advisory (the diff-visible reference the detector
 * saw was a member access or otherwise not a dangling reference: the rename is
 * complete in the checkout); proven keeps the block and records the surviving
 * references as runtime corroboration. Every other verdict is record-only.
 */
export function applyFakeRefactorRestorationToFinding(
  finding: Finding,
  record: FakeRefactorProofRecord,
): void {
  if (record.verdict === 'refuted') {
    finding.severity = 'info';
    finding.confidence = 'structural-only';
    finding.evidence =
      `${finding.evidence}\n` +
      `demoted: no surviving reference to '${record.oldName}' remains anywhere in the checkout, so ` +
      `the rename is complete and the diff-visible match was not a dangling reference`;
    return;
  }
  if (record.verdict === 'proven') {
    finding.runtimeCorroboration = {
      signal: 'dangling-reference',
      references: record.references,
    };
    setFindingConfidence(finding);
  }
}

/**
 * Ride a dead-branch verdict onto its `dead-branch-insertion` finding, in place.
 * Refuted demotes the block to advisory (the suite entered the branch, so it is
 * live, not dead); proven keeps the block and records the tests that reached the
 * branch as runtime corroboration. Every other verdict is record-only.
 */
export function applyDeadBranchRestorationToFinding(
  finding: Finding,
  record: DeadBranchProofRecord,
): void {
  if (record.verdict === 'refuted') {
    finding.severity = 'info';
    finding.confidence = 'structural-only';
    finding.evidence =
      `${finding.evidence}\n` +
      `demoted: the inserted branch executed under the affected tests, so it is live, not dead`;
    return;
  }
  if (record.verdict === 'proven') {
    finding.runtimeCorroboration = {
      signal: 'dead-branch-unreached',
      reachedByTests: record.affectedTestFiles,
    };
    setFindingConfidence(finding);
  }
}

/** Persist a typed proof envelope under `<evidenceDir>/<filename>`, identity
 *  stamped and written on every enabled run (empty included) so a stale file
 *  from an earlier head SHA never outlives its run. Generic sibling of
 *  `persistRestorationProofs` for the mock and no-op proof artifacts. */
function writeProofEnvelope<T>(
  evidenceDir: string,
  filename: string,
  prRef: string,
  prHeadSha: string,
  records: readonly T[],
): void {
  const envelope = {
    schemaVersion: 1 as const,
    prRef,
    prHeadSha,
    generatedAt: new Date().toISOString(),
    records: [...records],
  };
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, filename), JSON.stringify(envelope, null, 2), 'utf8');
}

export interface ProofRestorationInput {
  prDiff: string;
  prRef: string;
  prHeadSha: string;
  prTitle?: string;
  prBody?: string;
  structuralFindings: Finding[];
  preWorkspacePath: string | null;
  postWorkspacePath: string;
  testRunner: TestRunner | null;
  packageManager: PackageManager;
  /** Absolute wall-clock deadline (epoch ms) shared with the rest of the run. */
  deadline: number;
  recipe?: MutationRecipe;
  docker?: DockerContext;
}

export interface ProofRestorationOutcome {
  restorations: RestorationProofRecord[];
  mockRestorations: MockRestorationProofRecord[];
  noOpRestorations: NoOpFixProofRecord[];
  typeSuppressionRestorations: TypeSuppressionProofRecord[];
  fakeRefactorRestorations: FakeRefactorProofRecord[];
  deadBranchRestorations: DeadBranchProofRecord[];
  skipped: string[];
}

/**
 * Run the three differential-restoration proof engines against an
 * already-provisioned workspace pair, in cheap-first order, sharing one
 * wall-clock budget. Each engine never throws and restores its workspace
 * forward before returning, so the shared post workspace stays valid across
 * candidates and for the layer's cleanup. Verdicts ride back onto their
 * finding (test and mock are finding-gated; the no-op proof is PR-level and
 * tied to no structural finding, like claim-falsified). Extracted from
 * `runExecutionGrounded` so the live wiring is drivable against a local
 * sandbox without a GitHub provision.
 */
export function runProofRestorations(input: ProofRestorationInput): ProofRestorationOutcome {
  const skipped: string[] = [];
  const restorations: RestorationProofRecord[] = [];
  const mockRestorations: MockRestorationProofRecord[] = [];
  const noOpRestorations: NoOpFixProofRecord[] = [];
  const typeSuppressionRestorations: TypeSuppressionProofRecord[] = [];
  const fakeRefactorRestorations: FakeRefactorProofRecord[] = [];
  const deadBranchRestorations: DeadBranchProofRecord[] = [];
  const candidates = selectProofCandidates(
    input.structuralFindings,
    input.prDiff,
    input.prTitle,
    input.prBody,
  );
  const timeoutFor = (): number =>
    Math.min(TEST_TIMEOUT_MS, Math.max(1, input.deadline - Date.now()));
  const common = {
    ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
    ...(input.docker !== undefined ? { docker: input.docker } : {}),
  };

  // T4: differential test restoration.
  for (let i = 0; i < candidates.test.length; i++) {
    const finding = candidates.test[i]!;
    if (restorationBudgetExhausted(input.deadline, Date.now())) {
      const dropped = candidates.test.length - i;
      skipped.push(
        `restoration: wall-clock budget exhausted; ${dropped} finding(s) recorded without execution`,
      );
      restorations.push(...budgetExhaustedRecords(candidates.test.slice(i)));
      break;
    }
    const record = runTestRestoration({
      finding: { category: finding.category, file: finding.location.file },
      prDiff: input.prDiff,
      prRef: input.prRef,
      prHeadSha: input.prHeadSha,
      preWorkspacePath: input.preWorkspacePath,
      postWorkspacePath: input.postWorkspacePath,
      repoRoot: input.postWorkspacePath,
      testRunner: input.testRunner,
      packageManager: input.packageManager,
      timeoutMs: timeoutFor(),
      ...common,
    });
    restorations.push(record);
    applyRestorationToFinding(finding, record);
  }

  // T6: no-op-fix restoration (PR-level, gated by a fix claim).
  if (candidates.noOp !== null) {
    if (restorationBudgetExhausted(input.deadline, Date.now())) {
      skipped.push('no-op-fix restoration: wall-clock budget exhausted; recorded without execution');
      noOpRestorations.push(
        noOpHonestyRecord(
          candidates.noOp.findingFile,
          'not-proven:execution-error',
          'wall-clock budget exhausted before any test run executed for the no-op-fix proof',
        ),
      );
    } else {
      noOpRestorations.push(
        runNoOpFixRestoration({
          finding: { category: 'no-op-fix', file: candidates.noOp.findingFile },
          prDiff: input.prDiff,
          prRef: input.prRef,
          prHeadSha: input.prHeadSha,
          prIntent: candidates.noOp.prIntent,
          linkedIssueCount: candidates.noOp.linkedIssueCount,
          postWorkspacePath: input.postWorkspacePath,
          repoRoot: input.postWorkspacePath,
          testRunner: input.testRunner,
          packageManager: input.packageManager,
          timeoutMs: timeoutFor(),
          ...common,
        }),
      );
    }
  }

  // T5: mock-mutation restoration (finding-gated on cheat-mock-mutation block findings).
  for (let i = 0; i < candidates.mock.length; i++) {
    const finding = candidates.mock[i]!;
    if (restorationBudgetExhausted(input.deadline, Date.now())) {
      const dropped = candidates.mock.length - i;
      skipped.push(
        `mock-restoration: wall-clock budget exhausted; ${dropped} finding(s) recorded without execution`,
      );
      mockRestorations.push(...mockBudgetExhaustedRecords(candidates.mock.slice(i)));
      break;
    }
    const record = runMockRestoration({
      finding: { category: 'cheat-mock-mutation', file: finding.location.file },
      prDiff: input.prDiff,
      prRef: input.prRef,
      prHeadSha: input.prHeadSha,
      postWorkspacePath: input.postWorkspacePath,
      testRunner: input.testRunner,
      packageManager: input.packageManager,
      timeoutMs: timeoutFor(),
      ...common,
    });
    mockRestorations.push(record);
    applyMockRestorationToFinding(finding, record);
  }

  // T7: type-suppression restoration (finding-gated on type-suppression findings).
  for (let i = 0; i < candidates.typeSuppression.length; i++) {
    const finding = candidates.typeSuppression[i]!;
    if (restorationBudgetExhausted(input.deadline, Date.now())) {
      const dropped = candidates.typeSuppression.length - i;
      skipped.push(
        `type-suppression-restoration: wall-clock budget exhausted; ${dropped} finding(s) recorded without execution`,
      );
      typeSuppressionRestorations.push(
        ...typeSuppressionBudgetExhaustedRecords(candidates.typeSuppression.slice(i)),
      );
      break;
    }
    const record = runTypeSuppressionRestoration({
      finding: { category: 'type-suppression', file: finding.location.file },
      prDiff: input.prDiff,
      prRef: input.prRef,
      prHeadSha: input.prHeadSha,
      postWorkspacePath: input.postWorkspacePath,
      repoRoot: input.postWorkspacePath,
      timeoutMs: timeoutFor(),
      ...(input.docker !== undefined ? { docker: input.docker } : {}),
    });
    typeSuppressionRestorations.push(record);
    applyTypeSuppressionRestorationToFinding(finding, record);
  }

  // T8: fake-refactor restoration (finding-gated; a static scan of the checkout).
  for (let i = 0; i < candidates.fakeRefactor.length; i++) {
    const finding = candidates.fakeRefactor[i]!;
    if (restorationBudgetExhausted(input.deadline, Date.now())) {
      const dropped = candidates.fakeRefactor.length - i;
      skipped.push(
        `fake-refactor-restoration: wall-clock budget exhausted; ${dropped} finding(s) recorded without execution`,
      );
      fakeRefactorRestorations.push(
        ...fakeRefactorBudgetExhaustedRecords(candidates.fakeRefactor.slice(i)),
      );
      break;
    }
    const record = runFakeRefactorRestoration({
      finding: { category: 'fake-refactor', file: finding.location.file, line: finding.location.line },
      prDiff: input.prDiff,
      prRef: input.prRef,
      prHeadSha: input.prHeadSha,
      repoRoot: input.postWorkspacePath,
    });
    fakeRefactorRestorations.push(record);
    applyFakeRefactorRestorationToFinding(finding, record);
  }

  // T9: dead-branch restoration (finding-gated; instruments the branch and runs
  // the affected tests).
  for (let i = 0; i < candidates.deadBranch.length; i++) {
    const finding = candidates.deadBranch[i]!;
    if (restorationBudgetExhausted(input.deadline, Date.now())) {
      const dropped = candidates.deadBranch.length - i;
      skipped.push(
        `dead-branch-restoration: wall-clock budget exhausted; ${dropped} finding(s) recorded without execution`,
      );
      deadBranchRestorations.push(
        ...deadBranchBudgetExhaustedRecords(candidates.deadBranch.slice(i)),
      );
      break;
    }
    const record = runDeadBranchRestoration({
      finding: {
        category: 'dead-branch-insertion',
        file: finding.location.file,
        line: finding.location.line,
      },
      prDiff: input.prDiff,
      prRef: input.prRef,
      prHeadSha: input.prHeadSha,
      postWorkspacePath: input.postWorkspacePath,
      repoRoot: input.postWorkspacePath,
      testRunner: input.testRunner,
      packageManager: input.packageManager,
      timeoutMs: timeoutFor(),
      ...common,
    });
    deadBranchRestorations.push(record);
    applyDeadBranchRestorationToFinding(finding, record);
  }

  return {
    restorations,
    mockRestorations,
    noOpRestorations,
    typeSuppressionRestorations,
    fakeRefactorRestorations,
    deadBranchRestorations,
    skipped,
  };
}

/**
 * Run the enabled execution-grounded checks against a PR and return advisory
 * findings. Provisioning or a single check failing is an obstacle, not a
 * throw: it is recorded in `skipped` and the run continues with whatever the
 * other checks produced.
 */
export async function runExecutionGrounded(input: ExecutionGroundedInput): Promise<ExecutionGroundedOutcome> {
  const skipped: string[] = [];
  const empty: ExecutionGroundedOutcome = { findings: [], mutationRuns: [], coverageRuns: [], repros: [], restorations: [], mockRestorations: [], noOpRestorations: [], typeSuppressionRestorations: [], fakeRefactorRestorations: [], deadBranchRestorations: [], skipped };
  if (!input.config.enabled) {
    // Disabled means the layer never ran at all: no honesty records, because
    // nothing was promised to run.
    skipped.push('executionGrounded disabled');
    return empty;
  }
  const candidates = selectProofCandidates(
    input.structuralFindings ?? [],
    input.prDiff,
    input.prTitle,
    input.prBody,
  );
  const prRef = `${input.repo}#${input.prNumber}`;
  // Written on every enabled run, zero records included, so a stale proof file
  // from an earlier head SHA never outlives its run. One envelope per proof
  // family (test / mock / no-op) under their own filenames.
  const persistProofs = (out: {
    restorations: readonly RestorationProofRecord[];
    mockRestorations: readonly MockRestorationProofRecord[];
    noOpRestorations: readonly NoOpFixProofRecord[];
    typeSuppressionRestorations: readonly TypeSuppressionProofRecord[];
    fakeRefactorRestorations: readonly FakeRefactorProofRecord[];
    deadBranchRestorations: readonly DeadBranchProofRecord[];
  }): void => {
    if (input.evidenceDir === undefined) return;
    persistRestorationProofs(
      { prRef, prHeadSha: input.prHeadSha, records: out.restorations },
      input.evidenceDir,
    );
    writeProofEnvelope(input.evidenceDir, 'mock-restoration-proof.json', prRef, input.prHeadSha, out.mockRestorations);
    writeProofEnvelope(input.evidenceDir, 'no-op-fix-restoration-proof.json', prRef, input.prHeadSha, out.noOpRestorations);
    writeProofEnvelope(input.evidenceDir, 'type-suppression-restoration-proof.json', prRef, input.prHeadSha, out.typeSuppressionRestorations);
    writeProofEnvelope(input.evidenceDir, 'fake-refactor-restoration-proof.json', prRef, input.prHeadSha, out.fakeRefactorRestorations);
    writeProofEnvelope(input.evidenceDir, 'dead-branch-restoration-proof.json', prRef, input.prHeadSha, out.deadBranchRestorations);
  };
  // Fail closed: the envelopes are written empty before any phase that can
  // throw, so an exception escaping the run cannot leave a stale envelope
  // from a prior run on disk. Every completion path below overwrites them.
  persistProofs(empty);
  // Every return below this point happens before a workspace exists. A
  // qualifying candidate must still surface in its proof funnel, so each bail
  // emits (and persists) explicit no-workspace records instead of silently
  // dropping the candidates.
  const bailBeforeWorkspace = (detail: string): ExecutionGroundedOutcome => {
    empty.restorations = noWorkspaceRecords(candidates.test, detail);
    empty.mockRestorations = noWorkspaceMockRecords(candidates.mock, detail);
    empty.noOpRestorations = noWorkspaceNoOpRecords(candidates.noOp, detail);
    empty.typeSuppressionRestorations = noWorkspaceTypeSuppressionRecords(
      candidates.typeSuppression,
      detail,
    );
    empty.fakeRefactorRestorations = noWorkspaceFakeRefactorRecords(candidates.fakeRefactor, detail);
    empty.deadBranchRestorations = noWorkspaceDeadBranchRecords(candidates.deadBranch, detail);
    persistProofs(empty);
    return empty;
  };
  const changed: ChangedLineRanges = extractChangedLineRanges(input.prDiff, mutableSourceFilter);
  if (Object.keys(changed).length === 0) {
    skipped.push('no mutable source lines in diff');
    return bailBeforeWorkspace('no mutable source lines in diff');
  }

  // Optional container isolation for the untrusted-execution checks. When
  // requested but docker (or the image) is unavailable, skip the whole layer
  // rather than fall back to the host: an operator who asked for isolation must
  // not have the PR's code run unsandboxed behind their back.
  let dockerCtx: DockerContext | undefined;
  if (input.config.runner === 'docker') {
    const image = resolveDockerImage();
    const reason = dockerSkipReason({
      runnerRequested: true,
      dockerOk: dockerAvailable(),
      imageOk: dockerImagePresent(image),
      image,
    });
    if (reason !== null) {
      skipped.push(reason);
      return bailBeforeWorkspace(reason);
    }
    dockerCtx = { image, network: dockerSandboxNetwork() };
    log.info(`execution-grounded checks will run in docker (image ${image}, network ${dockerCtx.network})`);
  }

  // Content-addressed cache for the mutation and coverage runs (opt-out via
  // SWARM_EG_NO_CACHE, checked inside the checks). Persistent, outside the
  // throwaway workspace, so an identical re-audit skips the expensive spawns.
  const cacheCtx: EgCacheContext = {
    repo: input.repo,
    headSha: input.prHeadSha,
    dir: input.egCacheDir ?? path.join(process.cwd(), '.swarm', 'eg-cache'),
  };

  let workspaces;
  try {
    workspaces = provisionPRWorkspaces({
      repo: input.repo,
      prNumber: input.prNumber,
      prHeadSha: input.prHeadSha,
      ...(input.prBaseSha !== undefined ? { prBaseSha: input.prBaseSha } : {}),
      baseDir: input.baseDir,
      ...(input.cacheDir !== undefined ? { cacheDir: input.cacheDir } : {}),
      ...(input.installTimeoutMs !== undefined ? { installTimeoutMs: input.installTimeoutMs } : {}),
      ...(input.runBuild !== undefined ? { runBuild: input.runBuild } : {}),
    });
  } catch (err) {
    const reason = err instanceof SwarmError ? `${err.code}: ${err.message}` : String(err);
    log.warn(`provisioning failed for ${input.repo}#${input.prNumber}: ${reason}`);
    skipped.push(`provision: ${reason}`);
    return bailBeforeWorkspace(`provisioning failed: ${reason}`);
  }

  const deadline = Date.now() + input.config.maxWallClockPerPrMs;
  const findings: Finding[] = [];
  const outcome: ExecutionGroundedOutcome = { findings, mutationRuns: [], coverageRuns: [], repros: [], restorations: [], mockRestorations: [], noOpRestorations: [], typeSuppressionRestorations: [], fakeRefactorRestorations: [], deadBranchRestorations: [], skipped };
  const cacheArg = input.cacheDir !== undefined ? { cacheDir: input.cacheDir } : {};

  try {
    const installDir = workspaces.post.workspacePath;
    const pm = workspaces.post.packageManager;

    // Run mutation + coverage for one scope (a cwd plus its changed-line map,
    // keyed package-relative). Returns which checks executed.
    const runScope = (
      cwd: string,
      packageDir: string,
      scopeChanged: ChangedLineRanges,
      runner: TestRunner | null,
      doCoverage: boolean,
    ): { mutationRan: boolean; coverageRan: boolean } => {
      const evDir = (sub: string): { evidenceDir: string } | Record<string, never> =>
        input.evidenceDir !== undefined
          ? { evidenceDir: path.join(input.evidenceDir, packageDir || '_root', sub) }
          : {};
      const reroot = (f: Finding): Finding => ({
        ...f,
        location: { ...f.location, file: rerootToRepo(packageDir, f.location.file) },
      });
      let coverageMap: CoverageMap | undefined;
      let coverageRan = false;
      let mutationRan = false;
      if (input.config.coverage && doCoverage && Date.now() < deadline) {
        const cov = computeCoverageDelta({
          workspacePath: cwd,
          testRunner: runner,
          packageManager: pm,
          changedLines: scopeChanged,
          timeoutMs: Math.max(1, deadline - Date.now()),
          installDir,
          ...evDir('coverage'),
          ...cacheArg,
          ...(dockerCtx !== undefined ? { docker: dockerCtx } : {}),
          cache: cacheCtx,
        });
        outcome.coverageRuns.push({ packageDir, outcome: cov });
        if (cov.ran) {
          coverageMap = cov.coverage;
          coverageRan = true;
        } else skipped.push(`coverage[${packageDir || '<root>'}]: ${cov.skipReason ?? 'did not run'}`);
      }
      const scopeFindings: Finding[] = [];
      if (input.config.mutation && Date.now() < deadline) {
        const mut = runMutationCheck({
          workspacePath: cwd,
          changedLines: scopeChanged,
          testRunner: runner,
          packageManager: pm,
          timeoutMs: Math.max(1, deadline - Date.now()),
          installDir,
          ...(input.mutationRecipe !== undefined ? { recipe: input.mutationRecipe } : {}),
          ...evDir('mutation'),
          ...cacheArg,
          ...(dockerCtx !== undefined ? { docker: dockerCtx } : {}),
          cache: cacheCtx,
        });
        outcome.mutationRuns.push({ packageDir, outcome: mut });
        if (mut.ran) {
          mutationRan = true;
          scopeFindings.push(...mutationFindings(mut.results));
        } else skipped.push(`mutation[${packageDir || '<root>'}]: ${mut.skipReason ?? 'did not run'}`);
      }
      if (coverageRan && coverageMap !== undefined) {
        const lastCov = outcome.coverageRuns[outcome.coverageRuns.length - 1];
        const deltas = lastCov?.packageDir === packageDir ? lastCov.outcome.deltas : [];
        const mutationLines = new Set(
          scopeFindings.filter((f) => f.category.startsWith('mutation-survives')).map((f) => `${f.location.file}:${f.location.line}`),
        );
        scopeFindings.push(...coverageFindings(deltas, mutationLines));
      }
      findings.push(...scopeFindings.map(reroot));
      return { mutationRan, coverageRan };
    };

    // Root-first. A unified-config monorepo (one root vitest/jest config) ties
    // a package's source to tests that may live in another package (trpc keeps
    // its tests in packages/tests), so the whole change is run at the root.
    // When the root suite cannot run the change (a repo with independent
    // per-package configs, or a root suite with environment-dependent
    // failures), fall back to per-package, where the narrower suite often
    // passes. Coverage that already ran at the root is not repeated.
    let mutationRanAtRoot = false;
    let coverageRanAtRoot = false;
    if (workspaces.post.testRunner !== null && Date.now() < deadline) {
      const r = runScope(installDir, '', changed, workspaces.post.testRunner, input.config.coverage);
      mutationRanAtRoot = r.mutationRan;
      coverageRanAtRoot = r.coverageRan;
    }
    const needPackageFallback = input.config.mutation
      ? !mutationRanAtRoot
      : input.config.coverage && !coverageRanAtRoot;
    if (needPackageFallback) {
      for (const scope of groupChangedLinesByPackage(installDir, changed)) {
        if (scope.packageDir === '') continue; // already tried at the root
        if (Date.now() >= deadline) {
          skipped.push(`wall-clock budget reached before package ${scope.packageDir}`);
          break;
        }
        const pkgPath = path.join(installDir, scope.packageDir);
        const runner = detectTestRunner(pkgPath) ?? workspaces.post.testRunner;
        runScope(pkgPath, scope.packageDir, scope.changedLines, runner, input.config.coverage && !coverageRanAtRoot);
      }
    }

    if (input.config.issueRepro && input.prText !== undefined && Date.now() < deadline) {
      const repros = await runIssueRepros(input, workspaces, deadline, dockerCtx);
      outcome.repros = repros;
      findings.push(...reproFindings(repros));
    }

    // Differential restoration proofs against the already-provisioned pair
    // (test-tamper, no-op-fix, mock-mutation), sharing the run's wall-clock
    // budget. Each engine never throws and re-applies its patch forward before
    // returning, so the shared post workspace stays valid across candidates and
    // for the cleanup. Verdicts ride back onto their findings in place.
    const proofs = runProofRestorations({
      prDiff: input.prDiff,
      prRef,
      prHeadSha: input.prHeadSha,
      ...(input.prTitle !== undefined ? { prTitle: input.prTitle } : {}),
      ...(input.prBody !== undefined ? { prBody: input.prBody } : {}),
      structuralFindings: input.structuralFindings ?? [],
      preWorkspacePath: workspaces.pre.workspacePath,
      postWorkspacePath: workspaces.post.workspacePath,
      testRunner: workspaces.post.testRunner,
      packageManager: workspaces.post.packageManager,
      deadline,
      ...(input.mutationRecipe !== undefined ? { recipe: input.mutationRecipe } : {}),
      ...(dockerCtx !== undefined ? { docker: dockerCtx } : {}),
    });
    outcome.restorations = proofs.restorations;
    outcome.mockRestorations = proofs.mockRestorations;
    outcome.noOpRestorations = proofs.noOpRestorations;
    outcome.typeSuppressionRestorations = proofs.typeSuppressionRestorations;
    outcome.fakeRefactorRestorations = proofs.fakeRefactorRestorations;
    outcome.deadBranchRestorations = proofs.deadBranchRestorations;
    skipped.push(...proofs.skipped);
    persistProofs(outcome);
  } finally {
    workspaces.cleanup();
  }

  // A root run and a package fallback can both report coverage on the same
  // line; keep one finding per (category, file, line).
  const seen = new Set<string>();
  outcome.findings = findings.filter((f) => {
    const key = `${f.category}|${f.location.file}|${f.location.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return outcome;
}

interface ProvisionedPair {
  pre: { workspacePath: string; testRunner: import('./sandbox').TestRunner | null };
  post: { workspacePath: string; testRunner: import('./sandbox').TestRunner | null };
}

async function runIssueRepros(
  input: ExecutionGroundedInput,
  workspaces: ProvisionedPair,
  deadline: number,
  dockerCtx: DockerContext | undefined,
): Promise<ReproComparison[]> {
  const out: ReproComparison[] = [];
  const refs = parseIssueReferences(input.prText ?? '');
  const [defaultOwner, defaultRepo] = input.repo.split('/');
  for (const ref of refs) {
    if (Date.now() >= deadline) break;
    const owner = ref.owner ?? defaultOwner ?? '';
    const repo = ref.repo ?? defaultRepo ?? '';
    const issue = await fetchIssue({
      owner,
      repo,
      number: ref.number,
      ...(input.githubToken !== undefined ? { token: input.githubToken } : {}),
      ...(input.issueCacheDir !== undefined ? { cacheDir: input.issueCacheDir } : {}),
    });
    if (issue === null) continue;
    for (const repro of extractRepros(issue.body)) {
      if (Date.now() >= deadline) break;
      const dockerArg = dockerCtx !== undefined ? { docker: dockerCtx } : {};
      const runOnce = (workspacePath: string, testRunner: import('./sandbox').TestRunner | null) =>
        executeIssueRepro({ workspacePath, repro, testRunner, ...dockerArg });
      const pre = runOnce(workspaces.pre.workspacePath, workspaces.pre.testRunner);
      const post = runOnce(workspaces.post.workspacePath, workspaces.post.testRunner);
      const verdict = classifyComparison(pre.status, post.status);
      // The claim-falsified block trigger gates only on a confirmed fix-not-delivered:
      // the repro must fail twice on each side (D8). Re-run both sides only for that
      // verdict; every other verdict cannot gate, so a second run would be wasted.
      const preRuns = [pre.status];
      const postRuns = [post.status];
      if (verdict === 'fix-not-delivered' && Date.now() < deadline) {
        preRuns.push(runOnce(workspaces.pre.workspacePath, workspaces.pre.testRunner).status);
        postRuns.push(runOnce(workspaces.post.workspacePath, workspaces.post.testRunner).status);
      }
      out.push({
        issue: { owner, repo, number: ref.number },
        repro,
        verdict,
        preStatus: pre.status,
        postStatus: post.status,
        preRuns,
        postRuns,
        preOutput: `${pre.stdout}\n${pre.stderr}`.trim(),
        postOutput: `${post.stdout}\n${post.stderr}`.trim(),
      });
    }
  }
  return out;
}
