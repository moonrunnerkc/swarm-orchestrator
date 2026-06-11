// Differential test-restoration. The pure core: given a PR finding that
// points at a tampered test file, `extractTestHunkPatch` lifts ONLY that
// file's hunks out of the PR diff as a standalone unified diff (the patch
// a sandbox reverts with `git apply -R`), `classifyRestoration` turns the
// executed control results into a verdict, and `buildReproduceCommand`
// renders the one-line command a human runs to see the restored test fail.
// The per-runner execution building blocks: `buildTestCommand` shapes the
// argv that runs a set of test files under a runner, `parseFailingTests`
// lifts failing-test identities out of runner output, and `executeTestRun`
// (the one impure helper here) runs the command in an already-provisioned
// workspace. Workspace provisioning itself lives with the caller.

import parseDiff from 'parse-diff';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';
import { isTestFile } from '../cheat-detector/diff-walker';
import type { CheatCategory } from '../types';
import type { TestRunner, PackageManager } from './sandbox';
import type { MutationRecipe } from './mutation-check';
import type { DockerContext } from './docker-runner';
import { execBin, execEnv, execFileGuarded, type GuardedRunError } from './exec-env';

const log = getLogger('audit:execution-grounded:test-restoration');

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

// File-scoped invocations per runner, in argv form for child_process
// execution (matching how issue-repro shapes its runner commands). ava and
// node-test are deliberately absent: `parseFailingTests` has no locked
// identity parser for them, so the orchestrator reports
// 'not-proven:runner-unsupported' instead of executing a run whose failures
// it cannot attribute. The human-facing reproduce command below renders the
// exact same invocation, so what we executed and what we publish never drift.
const RUNNER_ARGV: Partial<Record<TestRunner, (files: string[]) => RunnerCommand>> = {
  jest: (files) => ({ command: 'npx', args: ['jest', '--runTestsByPath', ...files] }),
  vitest: (files) => ({ command: 'npx', args: ['vitest', 'run', ...files] }),
  mocha: (files) => ({ command: 'npx', args: ['mocha', ...files] }),
};

export interface RunnerCommand {
  command: string;
  args: string[];
}

/** Pure: the argv that runs `files` under `runner` via child_process. Throws
 *  for runners with no locked file-scoped invocation (ava, node-test). */
export function buildTestCommand(runner: TestRunner, files: string[]): RunnerCommand {
  const build = RUNNER_ARGV[runner];
  if (build === undefined) {
    throw new SwarmError(
      `no file-scoped test command for test runner '${runner}'`,
      'RESTORATION_RUNNER_UNSUPPORTED',
      {
        remediation:
          'Restoration proofs only execute under jest, vitest, or mocha; report not-proven:runner-unsupported for this workspace.',
      },
    );
  }
  return build(files);
}

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
  // Throws RESTORATION_RUNNER_UNSUPPORTED for ava/node-test; the published
  // command is the rendered form of the exact argv the sandbox executed.
  const { command, args } = buildTestCommand(opts.testRunner, opts.testFiles);
  const prNumber = /#(\d+)$/.exec(opts.prRef)?.[1];
  const fetch =
    prNumber !== undefined
      ? `git fetch origin pull/${prNumber}/head`
      : `git fetch origin ${opts.prHeadSha}`;
  return [
    fetch,
    `git checkout ${opts.prHeadSha}`,
    'git apply -R restoration-test-hunks.patch',
    `${command} ${args.join(' ')}`,
  ].join(' && ');
}

// ---------------------------------------------------------------------------
// Failing-test identity parsing.
//
// The identity a parser yields is the human-readable test name path the
// runner printed, locked per runner so the same failure produces the same
// string on every run (the fails-twice-with-same-identity control compares
// these sets verbatim):
//   jest   -> '<suite> › <name>' (the ● failure-block header)
//   mocha  -> '<suite> › <name>' (the numbered epilogue block, levels joined)
//   vitest -> '<file> > <suite> > <name>' (the FAIL header)
// ---------------------------------------------------------------------------

// CSI escape sequences (colors, cursor movement). Runners colorize when they
// believe they have a TTY; identities must not depend on that.
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// '● Console' and '● Test suite failed to run' are jest failure-block headers
// that carry no test identity; '<n> snapshot...' bullets come from the
// snapshot summary. A run that only produced these fails without identities,
// which the classifier maps to not-proven:execution-error (fail closed).
const JEST_NON_TEST_BULLET_RE = /^(Console$|Test suite failed to run|\d+ snapshot)/;
const JEST_BULLET_RE = /^\s*●\s+(.+?)\s*$/;
const JEST_CROSS_RE = /^\s*✕\s+(.+?)(?:\s+\(\d+(?:\.\d+)?\s*m?s\))?\s*$/;

function parseJestFailures(output: string): string[] {
  const bullets: string[] = [];
  const crosses: string[] = [];
  for (const line of output.split('\n')) {
    const bullet = JEST_BULLET_RE.exec(line);
    if (bullet !== null) {
      if (!JEST_NON_TEST_BULLET_RE.test(bullet[1]!)) bullets.push(bullet[1]!);
      continue;
    }
    const cross = JEST_CROSS_RE.exec(line);
    if (cross !== null) crosses.push(cross[1]!);
  }
  // ● headers carry the full suite path; ✕ lines only the leaf name. Prefer
  // the headers, and only fall back so a truncated report still attributes.
  return bullets.length > 0 ? bullets : crosses;
}

const MOCHA_NUMBERED_RE = /^(\s*)\d+\)\s+(.+?)\s*$/;

// Mocha's spec reporter prints a failure twice: an in-run marker
// ('    1) adds') and an epilogue block ('  1) suite' followed by
// deeper-indented lines ending in '<name>:'). Only the epilogue carries the
// full suite path, so a numbered line counts only when a deeper-indented
// colon-terminated header line follows before any blank or shallower line.
function parseMochaFailures(output: string): string[] {
  const lines = output.split('\n');
  const identities: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const numbered = MOCHA_NUMBERED_RE.exec(lines[i]!);
    if (numbered === null) continue;
    const indent = numbered[1]!.length;
    const first = numbered[2]!;
    if (first.endsWith(':')) {
      identities.push(first.slice(0, -1));
      continue;
    }
    const parts = [first];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim().length === 0) break;
      if (line.length - line.trimStart().length <= indent) break;
      const content = line.trim();
      if (content.endsWith(':')) {
        parts.push(content.slice(0, -1));
        identities.push(parts.join(' › '));
        break;
      }
      parts.push(content);
    }
  }
  return identities;
}

const VITEST_FAIL_RE = /^\s*FAIL\s+(.+?)\s*$/;
const VITEST_CROSS_RE = /^\s*×\s+(.+?)(?:\s+\d+(?:\.\d+)?\s*m?s)?\s*$/;

function parseVitestFailures(output: string): string[] {
  const fails: string[] = [];
  const crosses: string[] = [];
  for (const line of output.split('\n')) {
    const fail = VITEST_FAIL_RE.exec(line);
    // A FAIL header without ' > ' is file-level (suite failed to load): it
    // names no test, so it contributes no identity and the run fails closed.
    if (fail !== null) {
      if (fail[1]!.includes(' > ')) fails.push(fail[1]!);
      continue;
    }
    const cross = VITEST_CROSS_RE.exec(line);
    if (cross !== null) crosses.push(cross[1]!);
  }
  return fails.length > 0 ? fails : crosses;
}

/**
 * Pure: lift failing-test identities out of a runner's output (stdout and
 * stderr both, since jest reports on stderr). Deduplicated and sorted, so the
 * result is deterministic and directly comparable across runs. Runners with
 * no locked parser yield no identities, which the classifier maps to
 * not-proven:execution-error rather than a proof.
 */
export function parseFailingTests(runner: TestRunner, stdout: string, stderr: string): string[] {
  const output = stripAnsi(`${stdout}\n${stderr}`);
  let identities: string[];
  switch (runner) {
    case 'jest':
      identities = parseJestFailures(output);
      break;
    case 'mocha':
      identities = parseMochaFailures(output);
      break;
    case 'vitest':
      identities = parseVitestFailures(output);
      break;
    default:
      identities = [];
      break;
  }
  return identitySet(identities);
}

// ---------------------------------------------------------------------------
// Test-run execution. The one impure helper in this module: it runs the
// buildTestCommand argv inside an already-provisioned workspace and never
// provisions anything itself.
// ---------------------------------------------------------------------------

export interface ExecuteTestRunOptions {
  runner: TestRunner;
  /** Test files to run, relative to `cwd`. */
  files: string[];
  /** An already-provisioned workspace (deps installed, patch state applied). */
  cwd: string;
  timeoutMs: number;
  /** Package-manager cache override, threaded into execEnv. */
  cacheDir?: string;
  /** Per-repo recipe; its `env` entries override the sandbox environment. */
  recipe?: MutationRecipe;
  /** When set, run inside this container with `cwd` bind-mounted, exactly as
   *  the other execution-grounded checks do via execFileGuarded. */
  docker?: DockerContext;
}

export interface TestRunResult {
  passed: boolean;
  /** Parsed failing-test identities; empty when the run passed, timed out,
   *  or failed without parseable identities (the classifier fails closed on
   *  the latter as not-proven:execution-error). */
  failingTests: string[];
  /** Captured stdout+stderr, or the spawn error message when nothing ran. */
  rawOutput: string;
  timedOut: boolean;
}

/**
 * Run one restoration test command in a provisioned workspace. Never throws
 * for run-shaped problems: a nonzero exit parses identities from the output,
 * a nonzero exit with unparseable output surfaces as `passed: false` with no
 * identities (loud, distinct, and fail-closed downstream), a timeout sets
 * `timedOut`, and a spawn-level error (ENOENT and friends) returns the error
 * message as `rawOutput`. Honors SWARM_EG_NODE_BIN and the sandbox env
 * allowlist via execBin/execEnv.
 */
export function executeTestRun(opts: ExecuteTestRunOptions): TestRunResult {
  const { command, args } = buildTestCommand(opts.runner, opts.files);
  try {
    const stdout = execFileGuarded(execBin(command), args, {
      cwd: opts.cwd,
      env: { ...execEnv(opts.cacheDir), ...(opts.recipe?.env ?? {}) },
      timeoutMs: opts.timeoutMs,
      captureStdout: true,
      maxBuffer: 16 * 1024 * 1024,
      ...(opts.docker !== undefined ? { docker: opts.docker } : {}),
    });
    return { passed: true, failingTests: [], rawOutput: stdout, timedOut: false };
  } catch (err) {
    // execFileGuarded throws a GuardedRunError for nonzero exits, timeouts,
    // and spawn failures alike, always carrying stdout/stderr/timedOut; the
    // Partial cast keeps this safe should a foreign error ever surface.
    const guarded = err as Partial<GuardedRunError>;
    const stdout = typeof guarded.stdout === 'string' ? guarded.stdout : '';
    const stderr = typeof guarded.stderr === 'string' ? guarded.stderr : '';
    const timedOut = guarded.timedOut === true;
    const captured = [stdout, stderr].filter((s) => s.length > 0).join('\n');
    const rawOutput =
      captured.length > 0 ? captured : err instanceof Error ? err.message : String(err);
    // A timed-out run's partial output proves nothing; report no identities
    // so the classifier lands on an execution anomaly, not a proof.
    const failingTests = timedOut ? [] : parseFailingTests(opts.runner, stdout, stderr);
    log.debug(
      `test run failed (runner=${opts.runner}, timedOut=${timedOut}, identities=${failingTests.length}): ` +
        `${command} ${args.join(' ')}`,
    );
    return { passed: false, failingTests, rawOutput, timedOut };
  }
}
