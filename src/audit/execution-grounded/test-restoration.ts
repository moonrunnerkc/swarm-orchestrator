// Differential test-restoration: the pure core. Given a PR finding that
// points at a tampered test file, `extractTestHunkPatch` lifts ONLY that
// file's hunks out of the PR diff as a standalone unified diff (the patch
// a sandbox reverts with `git apply -R`), `classifyRestoration` turns the
// executed control results into a verdict, and `buildReproduceCommand`
// renders the one-line command a human runs to see the restored test fail.
// Everything impure (workspaces, runners, docker) lives with the caller.

import parseDiff from 'parse-diff';
import { SwarmError } from '../../errors';
import { filePath, isTestFile } from '../cheat-detector/diff-walker';
import type { CheatCategory } from '../types';
import type { TestRunner, PackageManager } from './sandbox';
import type { MutationRecipe } from './mutation-check';
import type { DockerContext } from './docker-runner';

export type RestorationVerdict =
  | 'proven'
  | 'refuted'
  | 'not-proven:pre-existing-failure'
  | 'not-proven:suite-already-failing'
  | 'not-proven:flaky'
  | 'not-proven:no-test-hunks'
  | 'not-proven:patch-apply-failed'
  | 'not-proven:runner-unsupported'
  | 'not-proven:no-workspace'
  | 'not-proven:execution-error';

export interface RestorationControls {
  /** Control 1: restored test passes on the BASE checkout. */
  baseTestPasses: boolean | null;
  /** Control 2: the PR's own (tampered) test run passes as submitted. */
  tamperedSuitePasses: boolean | null;
  /** Control 3: restored run failed twice with the same test identity. */
  restoredFailsTwiceSameIdentity: boolean | null;
}

export interface RestorationProofRecord {
  schemaVersion: 1;
  verdict: RestorationVerdict;
  category: CheatCategory;
  findingFile: string;
  testFiles: string[];
  /** Failing test identities from the restored runs (empty unless proven). */
  failingTests: string[];
  controls: RestorationControls;
  /** Exact command a human runs in a fresh checkout to see the restored test fail. */
  reproduceCommand: string;
  /** The reverse patch of ONLY the test hunks (what was reverted). */
  revertedHunkPatch: string;
  /** Loud reason for every not-proven verdict. */
  reason?: string;
}

export interface TestRestorationInput {
  finding: { category: CheatCategory; file: string };
  prDiff: string;
  prRef: string; // owner/repo#N for the reproduce command
  prHeadSha: string;
  preWorkspacePath: string | null; // base checkout; null => control 1 unevaluable
  postWorkspacePath: string; // head checkout (PR applied)
  testRunner: TestRunner | null;
  packageManager: PackageManager;
  recipe?: MutationRecipe;
  timeoutMs: number;
  docker?: DockerContext;
}

export const RESTORATION_CATEGORIES: readonly CheatCategory[] = [
  'assertion-strip',
  'test-relaxation',
  'coverage-erosion',
];

/** Pure: extract the PR's test-file hunks the finding points at, as a standalone unified diff. */
export function extractTestHunkPatch(prDiff: string, findingFile: string): string | null {
  if (!isTestFile(findingFile)) return null;
  const target = parseDiff(prDiff).find((f) => filePath(f) === findingFile);
  if (target === undefined || target.chunks.length === 0) return null;

  // parse-diff normalizes a new file's `from` (and a deleted file's `to`)
  // to '/dev/null'; the git header wants the real path on both sides.
  const oldPath = target.from !== undefined && target.from !== '/dev/null' ? target.from : null;
  const newPath = target.to !== undefined && target.to !== '/dev/null' ? target.to : null;
  const lines: string[] = [`diff --git a/${oldPath ?? newPath} b/${newPath ?? oldPath}`];
  if (target.new === true) lines.push('new file mode 100644');
  if (target.deleted === true) lines.push('deleted file mode 100644');
  lines.push(oldPath === null ? '--- /dev/null' : `--- a/${oldPath}`);
  lines.push(newPath === null ? '+++ /dev/null' : `+++ b/${newPath}`);
  for (const chunk of target.chunks) {
    // `chunk.content` is the verbatim '@@ -a,b +c,d @@' header; each
    // change's `content` keeps its '+'/'-'/' ' prefix, so the hunks
    // round-trip byte-for-byte.
    lines.push(chunk.content);
    for (const change of chunk.changes) lines.push(change.content);
  }
  return `${lines.join('\n')}\n`;
}

function identitySet(tests: string[]): string[] {
  return [...new Set(tests)].sort();
}

/** Pure: classify from executed control results. */
export function classifyRestoration(c: {
  tamperedSuitePasses: boolean;
  baseTestPasses: boolean | null;
  restoredRun1Failed: boolean;
  restoredRun2Failed: boolean;
  run1FailingTests: string[];
  run2FailingTests: string[];
}): { verdict: RestorationVerdict; failingTests: string[] } {
  // The tampered suite failing as submitted outranks everything: CI would
  // have caught the PR, so this is not a concealment case.
  if (!c.tamperedSuitePasses) {
    return { verdict: 'not-proven:suite-already-failing', failingTests: [] };
  }
  if (!c.restoredRun1Failed && !c.restoredRun2Failed) {
    return { verdict: 'refuted', failingTests: [] };
  }
  if (c.restoredRun1Failed !== c.restoredRun2Failed) {
    return { verdict: 'not-proven:flaky', failingTests: [] };
  }
  const run1 = identitySet(c.run1FailingTests);
  const run2 = identitySet(c.run2FailingTests);
  const sameIdentity = run1.length === run2.length && run1.every((t, i) => t === run2[i]);
  if (!sameIdentity) {
    return { verdict: 'not-proven:flaky', failingTests: [] };
  }
  if (c.baseTestPasses === false) {
    return { verdict: 'not-proven:pre-existing-failure', failingTests: [] };
  }
  if (c.baseTestPasses === null) {
    return { verdict: 'not-proven:execution-error', failingTests: [] };
  }
  return { verdict: 'proven', failingTests: run1 };
}

// File-scoped invocations per runner. ava and node-test are deliberately
// absent: the orchestrator reports 'not-proven:runner-unsupported' for them
// instead of guessing a command shape that was never executed.
const RUNNER_COMMANDS: Partial<Record<TestRunner, (files: string[]) => string>> = {
  jest: (files) => `npx jest --runTestsByPath ${files.join(' ')}`,
  vitest: (files) => `npx vitest run ${files.join(' ')}`,
  mocha: (files) => `npx mocha ${files.join(' ')}`,
};

/**
 * Pure: deterministic reproduce command for the proof record.
 *
 * `restoration-test-hunks.patch` is the proof record's `revertedHunkPatch`
 * saved to a file; `git apply -R` re-restores the tests the PR tampered with.
 * No timestamps, no absolute local paths: the same inputs always render the
 * same string.
 */
export function buildReproduceCommand(opts: {
  prRef: string;
  prHeadSha: string;
  testFiles: string[];
  testRunner: TestRunner;
}): string {
  const runner = RUNNER_COMMANDS[opts.testRunner];
  if (runner === undefined) {
    throw new SwarmError(
      `no file-scoped reproduce command for test runner '${opts.testRunner}'`,
      'RESTORATION_RUNNER_UNSUPPORTED',
      { remediation: 'Reproduce manually: save revertedHunkPatch and run `git apply -R` on it.' },
    );
  }
  const prNumber = /#(\d+)$/.exec(opts.prRef)?.[1];
  const fetch =
    prNumber !== undefined
      ? `git fetch origin pull/${prNumber}/head`
      : `git fetch origin ${opts.prHeadSha}`;
  return [
    fetch,
    `git checkout ${opts.prHeadSha}`,
    'git apply -R restoration-test-hunks.patch',
    runner(opts.testFiles),
  ].join(' && ');
}
