// Differential test-restoration: the pure core. Given a PR finding that
// points at a tampered test file, `extractTestHunkPatch` lifts ONLY that
// file's hunks out of the PR diff as a standalone unified diff (the patch
// a sandbox reverts with `git apply -R`), `classifyRestoration` turns the
// executed control results into a verdict, and `buildReproduceCommand`
// renders the one-line command a human runs to see the restored test fail.
// Everything impure (workspaces, runners, docker) lives with the caller.

import parseDiff from 'parse-diff';
import { SwarmError } from '../../errors';
import { isTestFile } from '../cheat-detector/diff-walker';
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

/** A parsed-diff path with the '/dev/null' placeholder normalized away. */
function realPath(p: string | undefined): string | null {
  return p !== undefined && p !== '/dev/null' ? p : null;
}

/** Pure: extract the PR's test-file hunks the finding points at, as a standalone unified diff. */
export function extractTestHunkPatch(prDiff: string, findingFile: string): string | null {
  if (!isTestFile(findingFile)) return null;
  // parse-diff sets a deleted file's `to` (and a new file's `from`) to
  // '/dev/null', so match the finding file against whichever side carries a
  // real path: a deletion's finding file is its from-path by contract, and
  // '/dev/null' itself is never a valid finding file.
  const target = parseDiff(prDiff).find(
    (f) => realPath(f.to) === findingFile || realPath(f.from) === findingFile,
  );
  if (target === undefined || target.chunks.length === 0) return null;

  // The git header wants the real path on both sides.
  const oldPath = realPath(target.from);
  const newPath = realPath(target.to);
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
  // Both runs failed "the same way" but neither yielded a single parseable
  // failing-test identity (e.g. a compile error after a legitimate rename).
  // Failure without identity is an execution anomaly, not proof: fail closed.
  if (run1.length === 0) {
    return { verdict: 'not-proven:execution-error', failingTests: [] };
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

// The reproduce command is published verbatim in PR comments and pasted into
// maintainers' shells, while its inputs (file paths, sha, ref) originate from
// an attacker-controlled PR. Everything interpolated into it must match a
// conservative shape; on violation we throw rather than emit a sanitized but
// different command (fail closed: a command we never executed is not proof).
const SAFE_TEST_PATH = /^[A-Za-z0-9._/@-]+$/;
const SAFE_HEAD_SHA = /^[0-9a-f]{7,40}$/;
const SAFE_PR_REF = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+$/;

function assertShellSafe(opts: { prRef: string; prHeadSha: string; testFiles: string[] }): void {
  for (const file of opts.testFiles) {
    const traversal = file.startsWith('/') || file.split('/').includes('..');
    if (!SAFE_TEST_PATH.test(file) || traversal) {
      throw new SwarmError(
        `test file path '${file}' is not safe to publish in a reproduce command`,
        'RESTORATION_UNSAFE_TEST_PATH',
        {
          remediation:
            'Reproduce manually: save revertedHunkPatch to a file, run `git apply -R` on it, then invoke the test runner on the restored files yourself.',
        },
      );
    }
  }
  if (!SAFE_HEAD_SHA.test(opts.prHeadSha)) {
    throw new SwarmError(
      `PR head sha '${opts.prHeadSha}' is not a 7-40 character lowercase hex string`,
      'RESTORATION_UNSAFE_HEAD_SHA',
      { remediation: 'Pass the full lowercase commit sha of the PR head as reported by git.' },
    );
  }
  if (/#\d+$/.test(opts.prRef) && !SAFE_PR_REF.test(opts.prRef)) {
    throw new SwarmError(
      `PR ref '${opts.prRef}' does not match the owner/repo#N shape`,
      'RESTORATION_UNSAFE_PR_REF',
      { remediation: 'Pass the PR ref as owner/repo#N with conservative repository characters.' },
    );
  }
}

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
  assertShellSafe(opts);
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
