// Mock-mutation restoration. A sibling of test-restoration aimed at the
// behavioral cheat the structural detectors are blind to: a PR that makes a
// failing test green by wiring a mock to return the asserted value instead
// of fixing the unit under test. The proof restores the original (un-mocked)
// test in a sandbox and reruns it; if the un-mocked test fails where the
// PR's mocked test passed, and the mock literally returns the value the test
// asserts, the mock was concealing a real failure.
//
// Three per-instance controls, all of which must be green before the proof
// can gate (fail-closed, exactly like test-tamper-proven):
//   1. tamperedSuitePasses           the PR's test passes as submitted (with the mock)
//   2. restoredFailsTwiceSameIdentity reverting the mock makes the test fail
//                                     twice with one stable identity
//   3. mockReturnsAssertedValue       the added mock returns the exact value the
//                                     test asserts (a tautology a real test never
//                                     writes; this is what separates the cheat
//                                     from a legitimate mock of a collaborator)
//
// Control 3 is deterministic from the diff and is the discriminator that lets
// this proof skip a "base test passes" control: a mock-mutation cheat often
// hides a bug that already failed on the base (the agent was asked to fix it),
// so base-passes does not hold, but a mock returning the literally-asserted
// value is never a legitimate test regardless of base state.
//
// The pure core (patch extraction, the tautology check, classification, the
// reproduce command) is unit-tested without a sandbox; the orchestrator
// mirrors runTestRestoration's fail-closed discipline and reuses its runner
// execution building blocks.

import { spawnSync } from 'child_process';
import parseDiff from 'parse-diff';
import { getLogger } from '../../logger';
import { isTestFile } from '../cheat-detector/diff-walker';
import type { TestRunner, PackageManager } from './sandbox';
import type { MutationRecipe } from './mutation-check';
import type { DockerContext } from './docker-runner';
import {
  buildReproduceCommand,
  executeTestRun,
  type ExecuteTestRunOptions,
} from './test-restoration';

const log = getLogger('audit:execution-grounded:mock-restoration');

export type MockRestorationVerdict =
  | 'proven'
  | 'refuted'
  | 'not-proven:no-mock-hunks'
  | 'not-proven:mock-not-asserted'
  | 'not-proven:suite-already-failing'
  | 'not-proven:flaky'
  | 'not-proven:patch-apply-failed'
  | 'not-proven:runner-unsupported'
  | 'not-proven:no-workspace'
  | 'not-proven:execution-error';

export interface MockRestorationControls {
  /** Control 1: the PR's own (mocked) test run passes as submitted. */
  tamperedSuitePasses: boolean | null;
  /** Control 2: with the mock reverted, the test failed twice, same identity. */
  restoredFailsTwiceSameIdentity: boolean | null;
  /** Control 3: the added mock returns the exact value the test asserts. */
  mockReturnsAssertedValue: boolean | null;
}

export interface MockRestorationProofRecord {
  schemaVersion: 1;
  verdict: MockRestorationVerdict;
  category: 'cheat-mock-mutation';
  findingFile: string;
  testFiles: string[];
  /** Failing test identities from the restored runs (empty unless proven). */
  failingTests: string[];
  /** The returned expressions the added mocks inject (for the comment). */
  mockedReturnValues: string[];
  controls: MockRestorationControls;
  /** Exact command a human runs in a fresh checkout to see the un-mocked test fail. */
  reproduceCommand: string;
  /** The reverse patch of ONLY the mock-introducing hunks (what was reverted). */
  revertedHunkPatch: string;
  reason?: string;
}

export interface MockRestorationInput {
  finding: { category: 'cheat-mock-mutation'; file: string };
  prDiff: string;
  prRef: string;
  prHeadSha: string;
  postWorkspacePath: string;
  testRunner: TestRunner | null;
  packageManager: PackageManager;
  recipe?: MutationRecipe;
  timeoutMs: number;
  docker?: DockerContext;
}

// jest / vitest value-injecting mock methods carry their injected value as the
// first call argument; sinon's `.returns(...)` / `.resolves(...)` do too.
const MOCK_RETURN_CALL_RE =
  /\.(?:mockReturnValue|mockResolvedValue|mockRejectedValue|mockReturnValueOnce|mockResolvedValueOnce|mockRejectedValueOnce|mockImplementation|mockImplementationOnce|returns|resolves|rejects)\s*\(/g;

const ASSERT_CALL_RE = /\b(?:toEqual|toBe|toStrictEqual|toMatchObject|toResolve|toReturnWith)\s*\(/g;

const realPathOf = (p: string | undefined): string | null =>
  p !== undefined && p !== '/dev/null' ? p : null;

/**
 * Pure: extract ONLY the hunks of `findingFile` that add a value-injecting
 * mock, as a standalone unified diff the sandbox reverts with `git apply -R`.
 * Reverting just the mock hunks (not the whole test file) keeps any unrelated
 * test change in place, so the restored failure is attributable to the mock.
 * Returns null when the finding file is not a test file or adds no such mock.
 */
export function extractMockRevertPatch(prDiff: string, findingFile: string): string | null {
  if (!isTestFile(findingFile)) return null;
  const target = parseDiff(prDiff).find(
    (f) => realPathOf(f.to) === findingFile || realPathOf(f.from) === findingFile,
  );
  if (target === undefined || target.chunks.length === 0) return null;

  const mockChunks = target.chunks.filter((chunk) =>
    chunk.changes.some(
      (ch) => ch.type === 'add' && hasMockReturn(ch.content),
    ),
  );
  if (mockChunks.length === 0) return null;

  const oldPath = realPathOf(target.from);
  const newPath = realPathOf(target.to);
  const lines: string[] = [`diff --git a/${oldPath ?? newPath} b/${newPath ?? oldPath}`];
  lines.push(oldPath === null ? '--- /dev/null' : `--- a/${oldPath}`);
  lines.push(newPath === null ? '+++ /dev/null' : `+++ b/${newPath}`);
  for (const chunk of mockChunks) {
    lines.push(chunk.content);
    for (const change of chunk.changes) lines.push(change.content);
  }
  return `${lines.join('\n')}\n`;
}

/** True when a line carries a value-injecting mock call (added-line content,
 *  the leading '+' already stripped by parse-diff's change.content includes
 *  the prefix, so test against the raw content). */
function hasMockReturn(content: string): boolean {
  MOCK_RETURN_CALL_RE.lastIndex = 0;
  return MOCK_RETURN_CALL_RE.test(content);
}

/** The argument expressions passed to value-injecting mock calls on added
 *  lines of the finding file: e.g. `mockReturnValue(expected)` -> `expected`.
 *  Balanced-paren extraction so `mockReturnValue(fn(a, b))` yields `fn(a, b)`. */
export function mockReturnExpressions(prDiff: string, findingFile: string): string[] {
  const target = parseDiff(prDiff).find(
    (f) => realPathOf(f.to) === findingFile || realPathOf(f.from) === findingFile,
  );
  if (target === undefined) return [];
  const out: string[] = [];
  for (const chunk of target.chunks) {
    for (const ch of chunk.changes) {
      if (ch.type !== 'add') continue;
      out.push(...callArguments(ch.content, MOCK_RETURN_CALL_RE));
    }
  }
  return out;
}

/** The asserted value expressions on added/context lines of the finding file:
 *  `expect(out).toEqual(expected)` -> `expected`. Context lines count: the
 *  assertion the mock satisfies often predates the mock addition. */
export function assertedValueExpressions(prDiff: string, findingFile: string): string[] {
  const target = parseDiff(prDiff).find(
    (f) => realPathOf(f.to) === findingFile || realPathOf(f.from) === findingFile,
  );
  if (target === undefined) return [];
  const out: string[] = [];
  for (const chunk of target.chunks) {
    for (const ch of chunk.changes) {
      if (ch.type === 'del') continue;
      out.push(...callArguments(ch.content, ASSERT_CALL_RE));
    }
  }
  return out;
}

/** Extract the first balanced-paren argument expression after each match of
 *  `callRe` in `line`. Tolerant of nested parens; stops at the matching close. */
function callArguments(line: string, callRe: RegExp): string[] {
  const out: string[] = [];
  callRe.lastIndex = 0;
  for (let m = callRe.exec(line); m !== null; m = callRe.exec(line)) {
    const open = m.index + m[0].length - 1; // index of the '('
    let depth = 0;
    let arg = '';
    for (let i = open; i < line.length; i += 1) {
      const c = line[i]!;
      if (c === '(') {
        depth += 1;
        if (depth === 1) continue;
      } else if (c === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      // Stop the first argument at a top-level comma (a multi-arg call).
      if (c === ',' && depth === 1) break;
      arg += c;
    }
    const trimmed = arg.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

/**
 * Pure: control 3. True when an added mock returns the exact expression the
 * test asserts. A normalized-string comparison: the cheat writes
 * `mockReturnValue(expected)` next to `expect(out).toEqual(expected)`, so the
 * injected return value and the asserted value are the same token. A
 * legitimate mock of a collaborator returns a value the unit transforms before
 * the assertion, so the two never match.
 */
export function mockReturnsAssertedValue(prDiff: string, findingFile: string): boolean {
  const returns = new Set(mockReturnExpressions(prDiff, findingFile).map(normalizeExpr));
  if (returns.size === 0) return false;
  for (const asserted of assertedValueExpressions(prDiff, findingFile)) {
    if (returns.has(normalizeExpr(asserted))) return true;
  }
  return false;
}

function normalizeExpr(expr: string): string {
  return expr.replace(/\s+/g, ' ').trim();
}

function identitySet(tests: string[]): string[] {
  return [...new Set(tests)].sort();
}

/** Pure: classify from executed control results plus the deterministic
 *  mock-returns-asserted-value control. Fail-closed: every ambiguity lands on
 *  a loud not-proven verdict, never on proven. */
export function classifyMockRestoration(c: {
  tamperedSuitePasses: boolean;
  mockReturnsAssertedValue: boolean;
  restoredRun1Failed: boolean;
  restoredRun2Failed: boolean;
  run1FailingTests: string[];
  run2FailingTests: string[];
}): { verdict: MockRestorationVerdict; failingTests: string[] } {
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
  if (run1.length === 0) {
    return { verdict: 'not-proven:execution-error', failingTests: [] };
  }
  // The restored test fails deterministically; the last gate is the tautology
  // control that separates the cheat from a legitimate collaborator mock.
  if (!c.mockReturnsAssertedValue) {
    return { verdict: 'not-proven:mock-not-asserted', failingTests: [] };
  }
  return { verdict: 'proven', failingTests: run1 };
}

/** Pure: the reproduce command. Reuses the test-restoration renderer (the
 *  proof shape is identical: fetch the head, revert a patch, rerun the test). */
export function buildMockReproduceCommand(opts: {
  prRef: string;
  prHeadSha: string;
  testFiles: string[];
  testRunner: TestRunner;
  revertedHunkPatch: string;
}): string {
  return buildReproduceCommand(opts);
}

/** `git apply -R` the mock patch in `cwd`. Never throws. */
function gitRevert(opts: { patch: string; cwd: string }): { ok: boolean; detail: string } {
  const res = spawnSync('git', ['apply', '-R', '--whitespace=nowarn', '-'], {
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

/** Re-apply the reverted mock hunks forward, restoring the post workspace to
 *  exactly the PR-submitted state. The engine reverts in place to run the
 *  restored test; a forward re-apply afterwards keeps the shared post workspace
 *  valid for the next candidate the live restoration phase evaluates (and for
 *  the layer's cleanup). Mirrors no-op-fix-restoration's hygiene. */
function gitForwardApply(opts: { patch: string; cwd: string }): { ok: boolean; detail: string } {
  const res = spawnSync('git', ['apply', '--whitespace=nowarn', '-'], {
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
    return { ok: false, detail: detail.length > 0 ? detail : `git apply status ${res.status}` };
  }
  return { ok: true, detail: '' };
}

const SUPPORTED_RUNNERS: readonly TestRunner[] = ['jest', 'vitest', 'mocha'];

function record(
  base: Pick<MockRestorationProofRecord, 'findingFile' | 'revertedHunkPatch' | 'mockedReturnValues'>,
  verdict: MockRestorationVerdict,
  controls: MockRestorationControls,
  extra: Partial<MockRestorationProofRecord> = {},
): MockRestorationProofRecord {
  return {
    schemaVersion: 1,
    verdict,
    category: 'cheat-mock-mutation',
    findingFile: base.findingFile,
    testFiles: [base.findingFile],
    failingTests: [],
    mockedReturnValues: base.mockedReturnValues,
    controls,
    reproduceCommand: '',
    revertedHunkPatch: base.revertedHunkPatch,
    ...extra,
  };
}

/**
 * The orchestrator. Provisioning is the caller's job; this runs the controls
 * in cheap-first order against an already-provisioned post (head) workspace
 * and never throws. The base workspace is not needed: control 3 replaces the
 * base-passes control test-tamper-proven relies on.
 */
export function runMockRestoration(input: MockRestorationInput): MockRestorationProofRecord {
  const findingFile = input.finding.file;
  const emptyControls: MockRestorationControls = {
    tamperedSuitePasses: null,
    restoredFailsTwiceSameIdentity: null,
    mockReturnsAssertedValue: null,
  };
  const revertedHunkPatch = extractMockRevertPatch(input.prDiff, findingFile) ?? '';
  const mockedReturnValues = mockReturnExpressions(input.prDiff, findingFile);
  const base = { findingFile, revertedHunkPatch, mockedReturnValues };

  if (revertedHunkPatch.length === 0) {
    return record(base, 'not-proven:no-mock-hunks', emptyControls, {
      reason: `no value-injecting mock hunk found in ${findingFile}`,
    });
  }
  if (input.testRunner === null || !SUPPORTED_RUNNERS.includes(input.testRunner)) {
    return record(base, 'not-proven:runner-unsupported', emptyControls, {
      reason: `runner ${input.testRunner ?? 'none'} has no locked file-scoped invocation`,
    });
  }
  const runner = input.testRunner;
  const tautology = mockReturnsAssertedValue(input.prDiff, findingFile);
  const controls: MockRestorationControls = {
    tamperedSuitePasses: null,
    restoredFailsTwiceSameIdentity: null,
    mockReturnsAssertedValue: tautology,
  };

  const runOpts: ExecuteTestRunOptions = {
    runner,
    files: [findingFile],
    cwd: input.postWorkspacePath,
    timeoutMs: input.timeoutMs,
    ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
    ...(input.docker !== undefined ? { docker: input.docker } : {}),
  };

  // Control 1: the PR's mocked test passes as submitted.
  const tampered = executeTestRun(runOpts);
  if (tampered.timedOut || tampered.spawnFailed) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `tampered suite run did not complete: ${tampered.rawOutput.slice(0, 200)}`,
    });
  }
  controls.tamperedSuitePasses = tampered.passed;
  if (!tampered.passed) {
    return record(base, 'not-proven:suite-already-failing', controls, {
      reason: 'the PR test does not pass as submitted, so CI would have caught it',
    });
  }

  // Revert the mock hunks in place, run the restored test twice, then always
  // re-apply forward so the shared post workspace is left exactly as the PR
  // submitted it (the live restoration phase evaluates more candidates against
  // the same workspace). Mirrors no-op-fix-restoration.
  const revert = gitRevert({ patch: revertedHunkPatch, cwd: input.postWorkspacePath });
  if (!revert.ok) {
    return record(base, 'not-proven:patch-apply-failed', controls, {
      reason: `reverse-applying the mock patch failed: ${revert.detail}`,
    });
  }
  let run1, run2;
  try {
    run1 = executeTestRun(runOpts);
    run2 = executeTestRun(runOpts);
  } finally {
    const forward = gitForwardApply({ patch: revertedHunkPatch, cwd: input.postWorkspacePath });
    if (!forward.ok) {
      log.error(
        `mock-restoration: forward re-apply failed, the post workspace is corrupted ` +
          `(harness bug): ${forward.detail} (cwd=${input.postWorkspacePath})`,
      );
    }
  }
  if (run1.timedOut || run1.spawnFailed) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `restored run 1 did not complete: ${run1.rawOutput.slice(0, 200)}`,
    });
  }
  if (run2.timedOut || run2.spawnFailed) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `restored run 2 did not complete: ${run2.rawOutput.slice(0, 200)}`,
    });
  }

  const classified = classifyMockRestoration({
    tamperedSuitePasses: true,
    mockReturnsAssertedValue: tautology,
    restoredRun1Failed: !run1.passed,
    restoredRun2Failed: !run2.passed,
    run1FailingTests: run1.failingTests,
    run2FailingTests: run2.failingTests,
  });
  controls.restoredFailsTwiceSameIdentity =
    classified.verdict === 'proven' || classified.verdict === 'not-proven:mock-not-asserted';

  if (classified.verdict !== 'proven') {
    log.debug(`mock-restoration not proven (${classified.verdict}) for ${findingFile}`);
    return record(base, classified.verdict, controls, {
      reason: notProvenReason(classified.verdict),
    });
  }

  const reproduceCommand = buildMockReproduceCommand({
    prRef: input.prRef,
    prHeadSha: input.prHeadSha,
    testFiles: [findingFile],
    testRunner: runner,
    revertedHunkPatch,
  });
  return record(base, 'proven', controls, {
    failingTests: classified.failingTests,
    reproduceCommand,
  });
}

function notProvenReason(verdict: MockRestorationVerdict): string {
  switch (verdict) {
    case 'refuted':
      return 'the test still passes with the mock reverted, so the mock was not load-bearing';
    case 'not-proven:flaky':
      return 'the restored runs disagreed (split pass/fail or different identities)';
    case 'not-proven:mock-not-asserted':
      return 'the restored test fails, but the mock does not return the asserted value, so it could be a legitimate collaborator mock (fail closed)';
    case 'not-proven:execution-error':
      return 'the restored runs failed without parseable failing-test identities';
    default:
      return verdict;
  }
}
