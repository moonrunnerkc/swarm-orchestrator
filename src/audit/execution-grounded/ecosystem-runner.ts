// The ecosystem seam for restoration proofs. Every proof engine asks the same
// question: given a repo state and a target test file, run the project's tests
// and tell me whether they executed and passed, executed and failed, or never
// executed and why. Only the run-the-tests step varies by ecosystem, so it is
// isolated here and the proof logic above it never forks per language.
//
// Three things live here because all of them are ecosystem-specific and none of
// them is proof logic:
//
// 1. The runner invocation (argv), including Go's package scoping.
// 2. The scope: which directory the command runs in and how the test target is
//    named relative to it. A Go module or a Python project can sit in a
//    subdirectory of the clone, in which case running from the clone root finds
//    no module at all.
// 3. The preflight: whether the toolchain the invocation needs is present, so a
//    missing `go` is reported as a named not-executed reason rather than dying
//    at spawn and being recorded as an execution error.

import * as fs from 'fs';
import * as path from 'path';
import { SwarmError } from '../../errors';
import { execBin } from './exec-env';
import type { TestRunner } from './sandbox';

/** The language ecosystems the sandbox can provision and run. */
export type Ecosystem = 'node' | 'python' | 'go';

/**
 * Why a suite run never executed. These are harness or environment facts, never
 * statements about the code under audit: a caller must not publish any of them
 * as a passing or failing suite.
 */
export type NotExecutedReason =
  | 'runner-undetected'
  | 'runner-unsupported'
  | 'toolchain-missing'
  | 'workspace-missing'
  | 'no-test-target'
  | 'module-root-unresolved'
  | 'spawn-failed'
  | 'timeout';

/** One runner invocation in argv form. */
export interface RunnerCommand {
  command: string;
  args: string[];
}

/** Where a suite command runs and what it runs on. */
export interface TestScope {
  /** Absolute directory the command runs in: the module or project root. */
  cwd: string;
  /** Test targets as the runner names them, relative to `cwd`. */
  targets: string[];
}

/** A preflight verdict: ok, or a named reason the run cannot be attempted. */
export type PreflightResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: NotExecutedReason; readonly detail: string };

/** Which ecosystem a test runner belongs to. */
export function ecosystemForRunner(runner: TestRunner): Ecosystem {
  if (runner === 'go-test') return 'go';
  if (runner === 'pytest') return 'python';
  return 'node';
}

/** Go is package-scoped: `go test` runs a directory's whole `_test.go` set, not a
 *  single file, so a test file maps to its package (`./dir`, or `.` at the root).
 *  Deduped and sorted so the argv is deterministic. */
export function goPackagesFor(files: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const dir = path.posix.dirname(f);
    dirs.add(dir === '.' || dir === '' ? '.' : `./${dir}`);
  }
  return [...dirs].sort();
}

// Invocations per runner, in argv form for child_process execution (matching how
// issue-repro shapes its runner commands). jest/vitest/mocha and pytest are
// file-scoped; go-test is package-scoped (goPackagesFor maps the test file to its
// package). `-count=1` on go defeats Go's test result cache so the fails-twice
// control actually re-executes rather than replaying a cached PASS. ava and
// node-test are deliberately absent: `parseFailingTests` has no locked identity
// parser for them, so the orchestrator reports 'not-proven:runner-unsupported'
// instead of executing a run whose failures it cannot attribute. The human-facing
// reproduce command renders the exact same invocation, so what we executed and
// what we publish never drift.
const RUNNER_ARGV: Partial<Record<TestRunner, (files: string[]) => RunnerCommand>> = {
  jest: (files) => ({ command: 'npx', args: ['jest', '--runTestsByPath', ...files] }),
  vitest: (files) => ({ command: 'npx', args: ['vitest', 'run', ...files] }),
  mocha: (files) => ({ command: 'npx', args: ['mocha', ...files] }),
  pytest: (files) => ({
    command: 'python3',
    args: ['-m', 'pytest', '-v', '--no-header', '-p', 'no:cacheprovider', ...files],
  }),
  'go-test': (files) => ({ command: 'go', args: ['test', '-v', '-count=1', ...goPackagesFor(files)] }),
};

/** True when this runner has a locked file-scoped invocation and identity parser. */
export function isSupportedRunner(runner: TestRunner): boolean {
  return RUNNER_ARGV[runner] !== undefined;
}

/**
 * Runners for proofs whose machinery beyond the test run is Node-only, not
 * merely whose test command is. Three engines are in this class and each for a
 * concrete reason, not for want of a runner invocation:
 *
 * - no-op-fix needs changed-line coverage, and the coverage path (coverage-delta)
 *   instruments Node runners only. Without it control 3 cannot be evaluated.
 * - mock-of-hallucination reasons about JS module mocks (`jest.mock` and its
 *   vitest equivalent), which have no counterpart in a Go or pytest tree.
 * - dead-branch insertion instruments branch markers through the Node runner.
 *
 * Widening these needs the corresponding machinery, not just a runner entry, so
 * they stay fail-closed until it exists. test-restoration has no such dependency
 * and runs on the full supported set.
 */
export const NODE_ONLY_PROOF_RUNNERS: readonly TestRunner[] = ['jest', 'vitest', 'mocha'];

/**
 * The argv that runs `files` under `runner` via child_process.
 *
 * @param runner the detected test runner.
 * @param files test targets, already scoped relative to the run directory.
 * @returns the command and its arguments.
 * @throws SwarmError for runners with no locked file-scoped invocation (ava,
 *   node-test), which callers report as not-proven:runner-unsupported.
 */
export function buildTestCommand(runner: TestRunner, files: string[]): RunnerCommand {
  const build = RUNNER_ARGV[runner];
  if (build === undefined) {
    throw new SwarmError(
      `no file-scoped test command for test runner '${runner}'`,
      'RESTORATION_RUNNER_UNSUPPORTED',
      {
        remediation:
          'Restoration proofs execute under jest, vitest, mocha, pytest, or go-test; report not-proven:runner-unsupported for this workspace.',
      },
    );
  }
  return build(files);
}

/** Marker files that identify a project root, per ecosystem. Ordered most to
 *  least specific; the first hit walking up from the test file wins. */
const ROOT_MARKERS: Record<Ecosystem, readonly string[]> = {
  go: ['go.mod'],
  python: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'tox.ini'],
  node: ['package.json'],
};

/** Nearest ancestor of `startDir` (inclusive) holding one of `markers`, bounded
 *  by `root`, or null when no ancestor inside the workspace carries one. */
function nearestRoot(root: string, startDir: string, markers: readonly string[]): string | null {
  let dir = startDir;
  for (;;) {
    if (markers.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
    if (path.resolve(dir) === path.resolve(root)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve where a suite command runs and how its targets are named.
 *
 * Node keeps the historical behavior exactly: the command runs at the workspace
 * root with workspace-relative file paths, which is what every recorded Node
 * verdict was measured under. Go and Python instead run at the nearest module or
 * project root at or above the test file, with targets re-based onto it, so a
 * module in a subdirectory of the clone is found at all.
 *
 * @param runner the detected test runner.
 * @param workspacePath absolute path of the provisioned clone.
 * @param files test files relative to the workspace root.
 * @returns the resolved scope, or a named failure when no root exists.
 */
export function resolveTestScope(
  runner: TestRunner,
  workspacePath: string,
  files: readonly string[],
): { ok: true; scope: TestScope } | { ok: false; reason: NotExecutedReason; detail: string } {
  if (files.length === 0) {
    return { ok: false, reason: 'no-test-target', detail: 'no test files were named for this run' };
  }
  const ecosystem = ecosystemForRunner(runner);
  if (ecosystem === 'node') {
    return { ok: true, scope: { cwd: workspacePath, targets: [...files] } };
  }
  const markers = ROOT_MARKERS[ecosystem];
  const firstDir = path.join(workspacePath, path.dirname(files[0]!));
  const root = nearestRoot(workspacePath, firstDir, markers);
  if (root === null) {
    return {
      ok: false,
      reason: 'module-root-unresolved',
      detail:
        `no ${markers.join(' / ')} found at or above '${files[0]!}' inside the workspace, ` +
        `so there is no ${ecosystem} project root to run the suite from`,
    };
  }
  // Re-base every target onto the resolved root. A file outside the root (a
  // second module in the same clone) is dropped rather than passed with a
  // '../' path the runner would reject.
  const targets: string[] = [];
  for (const f of files) {
    const abs = path.join(workspacePath, f);
    const rel = path.relative(root, abs);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) targets.push(rel.split(path.sep).join('/'));
  }
  if (targets.length === 0) {
    return {
      ok: false,
      reason: 'no-test-target',
      detail: `no named test file lies inside the resolved ${ecosystem} root '${root}'`,
    };
  }
  return { ok: true, scope: { cwd: root, targets } };
}

/** Directories on `pathValue` that hold an executable `name`. */
function onPath(name: string, pathValue: string): string | null {
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir.length === 0) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Check that a run can be attempted at all: the workspace exists, the runner is
 * supported, and the binary the invocation needs is resolvable.
 *
 * Preflighting matters because the alternative is a spawn-level ENOENT recorded
 * as an execution error, which reads as "we tried and something went wrong" when
 * the truth is "the toolchain was never installed". It also fails fast instead of
 * burning the wall clock once per finding.
 *
 * @param runner the detected test runner.
 * @param cwd the resolved run directory.
 * @param env the environment the run will use, for PATH resolution.
 * @returns ok, or the named reason the run cannot be attempted.
 */
export function preflightRunner(
  runner: TestRunner,
  cwd: string,
  env: NodeJS.ProcessEnv,
): PreflightResult {
  if (!fs.existsSync(cwd)) {
    return { ok: false, reason: 'workspace-missing', detail: `run directory '${cwd}' does not exist` };
  }
  if (!isSupportedRunner(runner)) {
    return {
      ok: false,
      reason: 'runner-unsupported',
      detail: `test runner '${runner}' has no locked file-scoped invocation`,
    };
  }
  const { command } = buildTestCommand(runner, ['placeholder']);
  const resolved = execBin(command);
  // An absolute resolution (the pinned Node bin dir) is checked directly; a bare
  // name is looked up on the PATH the run will actually use, not the auditor's.
  if (path.isAbsolute(resolved)) {
    if (!fs.existsSync(resolved)) {
      return {
        ok: false,
        reason: 'toolchain-missing',
        detail: `'${command}' does not exist at the pinned path '${resolved}'`,
      };
    }
    return { ok: true };
  }
  if (onPath(command, env.PATH ?? '') === null) {
    return {
      ok: false,
      reason: 'toolchain-missing',
      detail:
        `'${command}' was not found on the sandbox PATH, so the ${ecosystemForRunner(runner)} ` +
        `suite cannot run; install it or point the toolchain env at it`,
    };
  }
  return { ok: true };
}
