// No-op-fix restoration. A counterfactual proof for the cheat the structural
// no-op-fix detector can only flag, never confirm: a PR that claims to fix a
// failing behaviour but whose source change no test actually verifies. The
// proof reverts ONLY the PR's non-test (source) hunks in the provisioned
// sandbox, scopes to the affected tests (the repo tests whose import-graph
// closure reaches a reverted source file), and reruns them. If every affected
// test still passes with the fix gone, no test verified the fix; combined with
// the PR claiming a fix, that is a no-op.
//
// Three per-instance controls, all green before the proof can gate (fail-closed,
// exactly like test-tamper-proven and mock-mutation-proven):
//   1. prClaimsFix                   the PR claims a fix (pr-intent or a linked
//                                    issue close-keyword)
//   2. suitePassesAsSubmitted        the affected tests pass with the full PR
//                                    applied (a suite red as submitted is a
//                                    case CI already catches, not concealment)
//   3. revertedSuiteStillPassesTwice with the source fix reverted, the affected
//                                    tests still pass, twice (so the suite is
//                                    blind to the fix)
//
// The discriminator vs a real fix is control 3's polarity: a real fix, reverted,
// makes an affected test FAIL (the suite verified it) -> refuted. A no-op fix,
// reverted, changes nothing -> proven. An empty or capped affected-test closure
// is no proof, not a block.
//
// The pure core (patch extraction, classification, reproduce command) is
// unit-tested without a sandbox; the orchestrator mirrors runTestRestoration's
// fail-closed discipline and reuses its runner execution building blocks.

import { spawnSync } from 'child_process';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { getLogger } from '../../logger';
import { isPlausiblyTestReachable, isTestFile } from '../cheat-detector/diff-walker';
import { reachableSourceFiles } from '../cheat-detector/test-import-closure';
import { enumerateRepoTestFiles } from '../cheat-detector/no-op-fix-helpers';
import type { PrIntent } from '../cheat-detector/pr-intent';
import type { TestRunner, PackageManager } from './sandbox';
import type { MutationRecipe } from './mutation-check';
import type { DockerContext } from './docker-runner';
import {
  buildReproduceCommand,
  changedNonTestSourceFiles,
  closureLinksChangedSource,
  executeTestRun,
  type ExecuteTestRunOptions,
} from './test-restoration';

const log = getLogger('audit:execution-grounded:no-op-fix-restoration');

export type NoOpFixVerdict =
  | 'proven'
  | 'refuted'
  | 'not-proven:no-fix-claim'
  | 'not-proven:no-source-hunks'
  | 'not-proven:no-affected-tests'
  | 'not-proven:closure-capped'
  | 'not-proven:suite-already-failing'
  | 'not-proven:flaky'
  | 'not-proven:patch-apply-failed'
  | 'not-proven:runner-unsupported'
  // Reserved for the execution-grounded caller when no sandbox workspace exists.
  | 'not-proven:no-workspace'
  | 'not-proven:execution-error';

export interface NoOpFixControls {
  /** Control 1: the PR claims a fix (pr-intent or a linked-issue close keyword). */
  prClaimsFix: boolean | null;
  /** Control 2: the affected tests pass with the full PR applied. */
  suitePassesAsSubmitted: boolean | null;
  /** Control 3: with the source fix reverted, the affected tests still pass, twice. */
  revertedSuiteStillPassesTwice: boolean | null;
}

export interface NoOpFixProofRecord {
  schemaVersion: 1;
  verdict: NoOpFixVerdict;
  category: 'no-op-fix';
  findingFile: string;
  /** Non-test source files whose hunks were reverted (the "fix"). */
  revertedSourceFiles: string[];
  /** Repo tests whose closure reaches a reverted source file (what was run). */
  affectedTestFiles: string[];
  controls: NoOpFixControls;
  /** The PR's own fix-claim text, quoted back so the contradiction is plain. */
  prClaim: string;
  /** Exact command a human runs in a fresh checkout to see the affected tests
   *  still pass with the fix reverted. */
  reproduceCommand: string;
  /** The reverse patch of ONLY the source hunks (what was reverted). */
  revertedHunkPatch: string;
  reason?: string;
}

export interface NoOpFixRestorationInput {
  finding: { category: 'no-op-fix'; file: string };
  prDiff: string;
  prRef: string;
  prHeadSha: string;
  /** Parsed PR fix-claim (cheat-detector/pr-intent.ts). */
  prIntent: PrIntent;
  /** Number of issues the PR closes; a close-keyword link is itself a fix claim. */
  linkedIssueCount: number;
  postWorkspacePath: string;
  /** Repo root for closure scoping and repo-test enumeration (= post workspace). */
  repoRoot: string;
  testRunner: TestRunner | null;
  packageManager: PackageManager;
  recipe?: MutationRecipe;
  timeoutMs: number;
  docker?: DockerContext;
  /** Cap on repo test files examined for the affected-test closure, so a giant
   *  monorepo cannot blow the per-PR budget on closure BFS alone. */
  maxTestFilesExamined?: number;
}

const realPathOf = (p: string | undefined): string | null =>
  p !== undefined && p !== '/dev/null' ? p : null;

/**
 * Pure: lift ONLY the PR's non-test source hunks into a standalone unified diff
 * the sandbox reverts with `git apply -R`. Multiple source files are emitted in
 * one patch (the whole "fix" is reverted together). Test files and non-source
 * files (lockfiles, config, docs) are excluded: reverting them is not the fix.
 * Returns null when the PR changed no non-test source.
 */
export function extractSourceRevertPatch(prDiff: string): string | null {
  const targets = parseDiff(prDiff).filter((f) => {
    const p = realPathOf(f.to) ?? realPathOf(f.from);
    return p !== null && !isTestFile(p) && isPlausiblyTestReachable(p) && f.chunks.length > 0;
  });
  if (targets.length === 0) return null;
  const lines: string[] = [];
  for (const target of targets) {
    const oldPath = realPathOf(target.from);
    const newPath = realPathOf(target.to);
    lines.push(`diff --git a/${oldPath ?? newPath} b/${newPath ?? oldPath}`);
    if (target.new === true) lines.push('new file mode 100644');
    if (target.deleted === true) lines.push('deleted file mode 100644');
    lines.push(oldPath === null ? '--- /dev/null' : `--- a/${oldPath}`);
    lines.push(newPath === null ? '+++ /dev/null' : `+++ b/${newPath}`);
    for (const chunk of target.chunks) {
      lines.push(chunk.content);
      for (const change of chunk.changes) lines.push(change.content);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Pure: classify from executed control results. Fail-closed: every ambiguity
 * lands on a loud not-proven verdict, never on proven. Preconditions
 * (prClaimsFix, a non-empty affected-test closure) are gated by the orchestrator
 * before this runs.
 */
export function classifyNoOpFixRestoration(c: {
  suitePassesAsSubmitted: boolean;
  revertedRun1Passed: boolean;
  revertedRun2Passed: boolean;
}): { verdict: NoOpFixVerdict } {
  if (!c.suitePassesAsSubmitted) {
    return { verdict: 'not-proven:suite-already-failing' };
  }
  // The fix is reverted; the affected tests either still pass (the suite is
  // blind to the fix: a no-op) or one of them now fails (the fix is verified).
  if (c.revertedRun1Passed && c.revertedRun2Passed) {
    return { verdict: 'proven' };
  }
  if (!c.revertedRun1Passed && !c.revertedRun2Passed) {
    return { verdict: 'refuted' };
  }
  return { verdict: 'not-proven:flaky' };
}

/** Default cap on repo test files whose closure is computed for one proof. */
export const DEFAULT_MAX_TEST_FILES_EXAMINED = 200;

export interface AffectedTestSelection {
  /** Repo-relative test files whose closure reaches a reverted source file. */
  affected: string[];
  /** True when at least one examined test's closure BFS hit the node cap; its
   *  reachability is optimistic, so such a test never contributes to `affected`
   *  (fail-closed) but the flag is recorded so the orchestrator can explain an
   *  empty selection. */
  capped: boolean;
  /** How many repo test files were examined (after the cap). */
  examined: number;
}

/**
 * The affected tests for a no-op proof: repo test files whose import-graph
 * closure reaches one of the reverted source files. A capped closure is skipped
 * (its membership is optimistic, so it could wrongly pull in an unrelated test).
 * Reads the workspace; never throws (a missing repoRoot yields an empty
 * selection, fail-closed). Reuses the same closure primitive the structural
 * no-op-fix detector keys on, so the two cannot disagree on reachability.
 */
export function selectAffectedTestFiles(
  repoRoot: string,
  revertedSourceFiles: readonly string[],
  maxTestFilesExamined: number = DEFAULT_MAX_TEST_FILES_EXAMINED,
): AffectedTestSelection {
  const testFiles = enumerateRepoTestFiles(repoRoot).slice(0, maxTestFilesExamined);
  const affected: string[] = [];
  let capped = false;
  for (const abs of testFiles) {
    let closure;
    try {
      closure = reachableSourceFiles([abs], repoRoot);
    } catch (err) {
      log.debug(
        `closure failed for ${abs}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (closure.capped) {
      capped = true;
      continue;
    }
    if (closureLinksChangedSource(closure.reachable, revertedSourceFiles, repoRoot)) {
      affected.push(path.relative(repoRoot, abs));
    }
  }
  return { affected: [...new Set(affected)].sort(), capped, examined: testFiles.length };
}

const SUPPORTED_RUNNERS: readonly TestRunner[] = ['jest', 'vitest', 'mocha'];

/** `git apply [-R]` the source patch in `cwd`. Never throws. */
function gitApply(opts: { patch: string; cwd: string; reverse: boolean }): {
  ok: boolean;
  detail: string;
} {
  const args = ['apply', ...(opts.reverse ? ['-R'] : []), '--whitespace=nowarn', '-'];
  const res = spawnSync('git', args, {
    cwd: opts.cwd,
    input: opts.patch,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (res.error !== undefined) return { ok: false, detail: res.error.message };
  if (res.status !== 0) {
    const detail = [res.stderr, res.stdout]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join('\n')
      .trim();
    return { ok: false, detail: detail.length > 0 ? detail : `git apply -R status ${res.status}` };
  }
  return { ok: true, detail: '' };
}

function record(
  base: {
    findingFile: string;
    revertedSourceFiles: string[];
    revertedHunkPatch: string;
    affectedTestFiles: string[];
    prClaim: string;
  },
  verdict: NoOpFixVerdict,
  controls: NoOpFixControls,
  extra: Partial<NoOpFixProofRecord> = {},
): NoOpFixProofRecord {
  return {
    schemaVersion: 1,
    verdict,
    category: 'no-op-fix',
    findingFile: base.findingFile,
    revertedSourceFiles: base.revertedSourceFiles,
    affectedTestFiles: base.affectedTestFiles,
    controls,
    prClaim: base.prClaim,
    reproduceCommand: '',
    revertedHunkPatch: base.revertedHunkPatch,
    ...extra,
  };
}

function notProvenReason(verdict: NoOpFixVerdict): string {
  switch (verdict) {
    case 'refuted':
      return 'reverting the fix makes an affected test fail, so a test does verify the fix';
    case 'not-proven:flaky':
      return 'the two reverted runs disagreed (split pass/fail)';
    case 'not-proven:no-affected-tests':
      return 'no repo test imports the changed source, directly or transitively, so there is no affected test to run (fail closed)';
    case 'not-proven:closure-capped':
      return 'the import-graph closure hit its node cap, so affected-test reachability is not trustworthy (fail closed)';
    default:
      return verdict;
  }
}

/**
 * The orchestrator. Provisioning is the caller's job; this runs the controls in
 * cheap-first order against an already-provisioned post (head) workspace and
 * never throws. The reverted source patch is always re-applied forward before
 * returning, so the shared workspace stays valid for later consumers.
 */
export function runNoOpFixRestoration(input: NoOpFixRestorationInput): NoOpFixProofRecord {
  try {
    return runNoOpFixPipeline(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`no-op-fix-restoration: orchestrator threw unexpectedly: ${message}`);
    return {
      schemaVersion: 1,
      verdict: 'not-proven:execution-error',
      category: 'no-op-fix',
      findingFile: input.finding.file,
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
      reason: `no-op-fix-restoration orchestrator threw unexpectedly: ${message}`,
    };
  }
}

function runNoOpFixPipeline(input: NoOpFixRestorationInput): NoOpFixProofRecord {
  const controls: NoOpFixControls = {
    prClaimsFix: null,
    suitePassesAsSubmitted: null,
    revertedSuiteStillPassesTwice: null,
  };
  const prClaim =
    input.prIntent.evidence.length > 0
      ? input.prIntent.evidence
      : input.linkedIssueCount > 0
        ? `closes ${input.linkedIssueCount} linked issue(s)`
        : '';
  const revertedSourceFiles = changedNonTestSourceFiles(input.prDiff);
  const revertedHunkPatch = extractSourceRevertPatch(input.prDiff) ?? '';
  const base = {
    findingFile: input.finding.file,
    revertedSourceFiles,
    revertedHunkPatch,
    affectedTestFiles: [] as string[],
    prClaim,
  };

  // Control 1: the PR must claim a fix. A change that claims nothing cannot be
  // a no-op fix; the proof is silent (not a block).
  const claimsFix = input.prIntent.claimsFix || input.linkedIssueCount > 0;
  if (!claimsFix) {
    return record(base, 'not-proven:no-fix-claim', controls, {
      reason: 'the PR makes no fix claim (no pr-intent match and no linked issue)',
    });
  }
  controls.prClaimsFix = true;

  if (revertedHunkPatch.length === 0) {
    return record(base, 'not-proven:no-source-hunks', controls, {
      reason: 'the PR changed no non-test source, so there is no fix to revert',
    });
  }
  if (input.testRunner === null || !SUPPORTED_RUNNERS.includes(input.testRunner)) {
    return record(base, 'not-proven:runner-unsupported', controls, {
      reason: `runner ${input.testRunner ?? 'none'} has no locked file-scoped invocation`,
    });
  }
  const runner = input.testRunner;

  const selection = selectAffectedTestFiles(
    input.repoRoot,
    revertedSourceFiles,
    input.maxTestFilesExamined ?? DEFAULT_MAX_TEST_FILES_EXAMINED,
  );
  base.affectedTestFiles = selection.affected;
  if (selection.affected.length === 0) {
    const verdict = selection.capped ? 'not-proven:closure-capped' : 'not-proven:no-affected-tests';
    return record(base, verdict, controls, { reason: notProvenReason(verdict) });
  }

  const runOpts: ExecuteTestRunOptions = {
    runner,
    files: selection.affected,
    cwd: input.postWorkspacePath,
    timeoutMs: input.timeoutMs,
    ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
    ...(input.docker !== undefined ? { docker: input.docker } : {}),
  };

  // Control 2: the affected tests must pass with the full PR applied. A suite
  // already red as submitted is a case CI catches, not concealment.
  const submitted = executeTestRun(runOpts);
  if (submitted.timedOut || submitted.spawnFailed) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `submitted-suite run did not complete: ${submitted.rawOutput.slice(0, 200)}`,
    });
  }
  controls.suitePassesAsSubmitted = submitted.passed;
  if (!submitted.passed) {
    return record(base, 'not-proven:suite-already-failing', controls, {
      reason: 'the affected tests do not pass as submitted, so CI would have caught it',
    });
  }

  // Revert the fix, run the affected tests twice, then always re-apply forward.
  const revert = gitApply({ patch: revertedHunkPatch, cwd: input.postWorkspacePath, reverse: true });
  if (!revert.ok) {
    return record(base, 'not-proven:patch-apply-failed', controls, {
      reason: `reverse-applying the source patch failed: ${revert.detail}`,
    });
  }
  let run1, run2;
  let restoreFailure: string | null = null;
  try {
    run1 = executeTestRun(runOpts);
    run2 = executeTestRun(runOpts);
  } finally {
    const forward = gitApply({ patch: revertedHunkPatch, cwd: input.postWorkspacePath, reverse: false });
    if (!forward.ok) {
      restoreFailure = `forward re-apply failed, the post workspace is corrupted (harness bug): ${forward.detail}`;
      log.error(`no-op-fix-restoration: ${restoreFailure} (cwd=${input.postWorkspacePath})`);
    }
  }
  if (run1.timedOut || run1.spawnFailed || run2.timedOut || run2.spawnFailed) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `a reverted run did not complete: ${(run1.timedOut || run1.spawnFailed ? run1 : run2).rawOutput.slice(0, 200)}`,
    });
  }

  const classified = classifyNoOpFixRestoration({
    suitePassesAsSubmitted: true,
    revertedRun1Passed: run1.passed,
    revertedRun2Passed: run2.passed,
  });
  controls.revertedSuiteStillPassesTwice = classified.verdict === 'proven';

  if (classified.verdict !== 'proven') {
    const reason = notProvenReason(classified.verdict);
    return record(base, classified.verdict, controls, {
      reason: restoreFailure !== null ? `${reason}; ${restoreFailure}` : reason,
    });
  }

  let reproduceCommand: string;
  try {
    reproduceCommand = buildReproduceCommand({
      prRef: input.prRef,
      prHeadSha: input.prHeadSha,
      testFiles: selection.affected,
      testRunner: runner,
      revertedHunkPatch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`no-op-fix-restoration: proven proof cannot render its reproduce command: ${message}`);
    return record(base, 'not-proven:execution-error', controls, {
      reason: `proven no-op proof could not render its reproduce command: ${message}`,
    });
  }
  return record(base, 'proven', controls, {
    reproduceCommand,
    ...(restoreFailure !== null ? { reason: restoreFailure } : {}),
  });
}
