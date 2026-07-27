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

import { spawnSync } from 'child_process';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';
import { isTestFile } from '../cheat-detector/diff-walker';
import type { CheatCategory } from '../types';
import type { TestRunner, PackageManager } from './sandbox';
import type { MutationRecipe } from './mutation-check';
import type { DockerContext } from './docker-runner';
import { execBin, execEnv, execFileGuarded, type GuardedRunError } from './exec-env';
import {
  buildTestCommand,
  isSupportedRunner,
  preflightRunner,
  resolveTestScope,
  type NotExecutedReason,
} from './ecosystem-runner';
import { reachableSourceFiles, isClosureAnalyzable, type ClosureResult } from '../cheat-detector/test-import-closure';

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
  // The restored test fails twice on the PR's source, but its import closure
  // reaches none of the production code the PR changed, so the failure is not
  // attributable to this PR's change (Protocol-1 relevance refuter). Only
  // produced when a repoRoot is threaded in.
  | 'not-proven:test-not-closure-linked'
  // The submitted (new) test fails on the BASE source, so the PR re-specified the
  // asserted behaviour to match an intentional source change, not a concealed
  // regression. A tamper weakens a passing test (which still passes on base); a
  // re-specification asserts new behaviour (which base does not satisfy). Only
  // produced when a base workspace is available.
  | 'not-proven:re-specified'
  // The restored (deleted) test exercises a production symbol the PR itself
  // removed as an export, so the test was deleted because its subject was
  // refactored away, not to conceal a regression. Restoring it fails on the PR
  // source because the import resolves to nothing, which is a refactor, not a
  // tamper. Pure diff signal; only turns proven into not-proven.
  | 'not-proven:subject-removed'
  // The PR weakened an assertion but, in the same diff, added REPLACEMENT
  // coverage (a net-new test file or a golden/testdata fixture) inside a
  // production directory it also changed. The restored old assertion still
  // fails on the PR source, so the behavioural controls prove, but the coverage
  // it guarded relocated to a file the engine cannot see (jeduden/mdsmith#232,
  // the gate's coverage-moving false-positive class). Fired-then-disputed: the
  // attestation surfaces it as `disputed` (human-review-required), never clean.
  // Pure diff signal; only turns proven into not-proven.
  | 'not-proven:coverage-relocated'
  // Reserved for the execution-grounded caller when no sandbox workspace could
  // be provisioned; never produced by this orchestrator.
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
  /** Repo root for the Protocol-1 closure relevance refuter. When set, a proven
   *  restoration is downgraded if the restored test's import closure confidently
   *  reaches none of the source the PR changed. Omitted by every existing
   *  caller, so the refuter never runs and behavior is unchanged for them. */
  repoRoot?: string;
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

/**
 * Pure: the non-test production files the PR changed, by their real new-side
 * (or old-side) path. The Protocol-1 relevance gate links a restored test to
 * the code it guards: a restoration is only proof of a concealed failure when
 * the test's import closure reaches one of these. A diff that touched only
 * tests yields [], which the gate reads as "nothing to link to" (fail closed).
 */
export function changedNonTestSourceFiles(prDiff: string): string[] {
  const out = new Set<string>();
  for (const file of parseDiff(prDiff)) {
    const p = realPath(file.to) ?? realPath(file.from);
    if (p === null || isTestFile(p)) continue;
    out.add(p);
  }
  return [...out].sort();
}

/**
 * Pure: the non-test source files whose change is *behaviorally revertable*:
 * the hunk contains at least one deleted/modified line (a `del` change), not
 * purely additions. This is the no-op proof's witness-relevance gate.
 *
 * Why it matters: the affected-test closure is file-level (does a test's import
 * graph reach a changed file). A purely-additive change to a file (a new export,
 * a new interface field) cannot alter the behaviour of pre-existing code that a
 * pre-existing test exercises, so a test that merely imports an *unchanged*
 * symbol from that file is not a witness: reverting the addition leaves it
 * passing for a reason unrelated to any "fix". Counting such a test made the
 * no-op proof fire on feature PRs that add untested code (observed on a real
 * `feat:` PR that closed an issue). A file with a `del` line, by contrast, can
 * change an existing code path a test runs, so its passing-after-revert is
 * informative. Fail-closed: a purely-additive PR yields [] and the proof
 * abstains (a new function no pre-existing test can verify is not provably a
 * no-op vs. a legitimately untested feature).
 */
export function behaviorallyRevertableSourceFiles(prDiff: string): string[] {
  const out = new Set<string>();
  for (const file of parseDiff(prDiff)) {
    const p = realPath(file.to) ?? realPath(file.from);
    if (p === null || isTestFile(p)) continue;
    const hasDeletion = file.chunks.some((chunk) =>
      chunk.changes.some((c) => c.type === 'del'),
    );
    if (hasDeletion) out.add(p);
  }
  return [...out].sort();
}

/**
 * Pure: true when at least one changed production source file resolves into the
 * restored test's import-graph closure. `reachable` is the closure's
 * absolute-path set (from reachableSourceFiles); `changedSourceFiles` are
 * repo-relative. An empty changed set is false: with no production change to
 * link to, the restored failure cannot be attributed to the PR (fail closed).
 */
export function closureLinksChangedSource(
  reachable: ReadonlySet<string>,
  changedSourceFiles: readonly string[],
  repoRoot: string,
): boolean {
  for (const file of changedSourceFiles) {
    const abs = path.isAbsolute(file) ? file : path.resolve(repoRoot, file);
    if (reachable.has(abs)) return true;
  }
  return false;
}

/**
 * Pure: the Protocol-1 relevance refuter. Returns true (downgrade the proof)
 * only when the restored test's closure *confidently* reaches none of the
 * production code the PR changed: the BFS was not capped, the PR did change
 * source, and no changed source file is in the closure. The behavioral controls
 * (passes on base, fails twice on the PR's source) already establish relevance,
 * so this refuter abstains on every uncertainty (capped closure, no source
 * change) rather than risk dropping a real proof on a closure false negative
 * (dynamic imports, an unresolved spec). It can only turn proven into
 * not-proven, never the reverse.
 */
export function closureRefutesRestoration(
  closure: ClosureResult,
  changedSourceFiles: readonly string[],
  repoRoot: string,
): boolean {
  if (closure.capped) return false;
  if (changedSourceFiles.length === 0) return false;
  return !closureLinksChangedSource(closure.reachable, changedSourceFiles, repoRoot);
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

// The runner invocation table, Go package scoping, project-root resolution, and
// the toolchain preflight live in ecosystem-runner.ts: they are the only parts of
// a proof that vary by language, and keeping them there is what stops the proof
// logic below from forking per ecosystem. Re-exported here because this module
// has always been their public surface.
export {
  buildTestCommand,
  goPackagesFor,
  isSupportedRunner,
  type NotExecutedReason,
  type RunnerCommand,
} from './ecosystem-runner';

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

/** The quoted heredoc delimiter the reproduce command feeds to `git apply -R`.
 *  Single-quoted so the embedded patch is literal (no shell expansion), and
 *  distinctive enough not to collide with a unified-diff body. */
const RESTORE_PATCH_DELIMITER = 'SWARM_RESTORE_PATCH';

/**
 * Pure: deterministic, self-contained reproduce command for the proof record.
 *
 * The reverted-hunk patch is embedded inline in a quoted heredoc, so the whole
 * command pastes into a fresh checkout and runs without any external file: it
 * fetches the PR head, checks it out, `git apply -R`s the restore patch from
 * stdin to put the original tests back, and runs the affected tests against the
 * PR's source. No timestamps, no absolute local paths: the same inputs always
 * render the same string.
 */
export function buildReproduceCommand(opts: {
  prRef: string;
  prHeadSha: string;
  testFiles: string[];
  testRunner: TestRunner;
  revertedHunkPatch: string;
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
  // The heredoc feeds the patch to `git apply -R` on stdin; the trailing
  // `&& <testcmd>` runs only if the restore applied, and the patch body plus
  // the closing delimiter follow on their own lines.
  const head =
    `${fetch} && git checkout ${opts.prHeadSha} && ` +
    `git apply -R <<'${RESTORE_PATCH_DELIMITER}' && ${command} ${args.join(' ')}`;
  return `${head}\n${opts.revertedHunkPatch.replace(/\n+$/, '')}\n${RESTORE_PATCH_DELIMITER}`;
}

// ---------------------------------------------------------------------------
// Failing-test identity parsing.
//
// The identity a parser yields is the human-readable test name path the
// runner printed, locked per runner so the same failure produces the same
// string on every run (the fails-twice-with-same-identity control compares
// these sets verbatim):
//   jest    -> '<suite> › <name>' (the ● failure-block header)
//   mocha   -> '<suite> › <name>' (the numbered epilogue block, levels joined)
//   vitest  -> '<file> > <suite> > <name>' (the FAIL header)
//   pytest  -> '<file>::<test>' (the -v per-test nodeid before FAILED)
//   go-test -> '<TestName>' (the '--- FAIL: <name>' marker; subtests as Test/sub)
// ---------------------------------------------------------------------------

// CSI escape sequences (colors, cursor movement). Runners colorize when they
// believe they have a TTY; identities must not depend on that.
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// '● Console' and '● Test suite failed to run' are jest failure-block headers
// that carry no test identity; '<n> snapshot...' bullets come from the
// snapshot summary; 'Validation Warning/Error', 'Deprecation Warning', and
// 'Multiple configurations found' come from jest-validate / jest-config and
// describe the run, never a test. A run that only produced these fails
// without identities, which the classifier maps to
// not-proven:execution-error (fail closed): the alternative, harvesting a
// config bullet as an identity, is stable across runs and would wrongfully
// prove a restoration against a suite that never even compiled.
const JEST_NON_TEST_BULLET_RE =
  /^(Console$|Test suite failed to run|\d+ snapshot|Validation (Warning|Error):|Deprecation Warning:|Multiple configurations found)/;
// Anchored to the reporter's exact shape so code-under-test prints cannot
// forge or perturb the identity set: jest renders failure-block headers at
// exactly two spaces ('  ● suite › name') and re-indents captured console
// output to four-or-deeper under a '  console.log' header. ✕ leaf lines sit
// at 2 + 2·depth spaces (top-level test = 2, one describe = 4, ...).
const JEST_BULLET_RE = /^ {2}●\s+(.+?)\s*$/;
const JEST_CROSS_RE = /^(?: {2})+✕\s+(.+?)(?:\s+\(\d+(?:\.\d+)?\s*m?s\))?\s*$/;

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

// Mocha's base reporter renders every epilogue entry at exactly two spaces
// ('  1) suite'); anchoring there is what separates the epilogue from
// everything else numbered: in-run spec markers sit at four-or-deeper, and an
// error body quoting '      2) some detail:' sits deeper still, so neither
// can start an epilogue block (and so invent an identity).
const MOCHA_EPILOGUE_INDENT = 2;
const MOCHA_NUMBERED_RE = /^ {2}\d+\)\s+(.+?)\s*$/;

// Mocha's spec reporter prints a failure twice: an in-run marker
// ('    1) adds') and an epilogue block ('  1) suite' followed by
// deeper-indented lines ending in '<name>:'). Only the epilogue carries the
// full suite path, so a numbered line counts only when it sits at the
// epilogue's two-space column and a deeper-indented colon-terminated header
// line follows before any blank or shallower line.
function parseMochaFailures(output: string): string[] {
  const lines = output.split('\n');
  const identities: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const numbered = MOCHA_NUMBERED_RE.exec(lines[i]!);
    if (numbered === null) continue;
    const first = numbered[1]!;
    if (first.endsWith(':')) {
      identities.push(first.slice(0, -1));
      continue;
    }
    const parts = [first];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim().length === 0) break;
      if (line.length - line.trimStart().length <= MOCHA_EPILOGUE_INDENT) break;
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

// Vitest's default reporter prints per-test failure headers at exactly one
// leading space (' FAIL  file > suite > name') and per-test × lines at
// exactly three ('   × suite > name 4ms'). Code-under-test stdout is
// forwarded verbatim under a 'stdout |' header, so anchoring to the
// reporter's columns rejects decoys printed at any other indent.
const VITEST_FAIL_RE = /^ FAIL\s+(.+?)\s*$/;
const VITEST_CROSS_RE = /^ {3}×\s+(.+?)(?:\s+\d+(?:\.\d+)?\s*m?s)?\s*$/;

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

// pytest -v prints one line per test: '<nodeid> FAILED   [ 50%]' (or PASSED /
// ERROR / SKIPPED). The nodeid ('file::test' or 'file::Class::test', params in
// '[...]') carries no spaces, so it anchors cleanly; a bare FAILED without a
// '::' nodeid is a summary or collection line and names no test.
const PYTEST_FAIL_RE = /^(\S+?::\S+)\s+(?:FAILED|ERROR)\b/;

function parsePytestFailures(output: string): string[] {
  const out: string[] = [];
  for (const line of output.split('\n')) {
    const m = PYTEST_FAIL_RE.exec(line);
    if (m !== null) out.push(m[1]!);
  }
  return out;
}

// `go test -v` prints '--- FAIL: TestName (0.00s)' per failing test, and
// '    --- FAIL: TestName/subtest (0.00s)' (indented) for subtests. The test
// name is a single whitespace-free token. The package-level 'FAIL\tpkg\t0.1s'
// summary and the trailing bare 'FAIL' carry no '--- FAIL:' prefix, so they do
// not forge an identity.
const GO_FAIL_RE = /^\s*--- FAIL: (\S+)/;

function parseGoFailures(output: string): string[] {
  const out: string[] = [];
  for (const line of output.split('\n')) {
    const m = GO_FAIL_RE.exec(line);
    if (m !== null) out.push(m[1]!);
  }
  return out;
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
    case 'pytest':
      identities = parsePytestFailures(output);
      break;
    case 'go-test':
      identities = parseGoFailures(output);
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
  /** True when the command never completed under its own exit code: the spawn
   *  itself failed (missing binary, nonexistent cwd) or the process was
   *  signal-killed. exec-env reports both as `status === null` without
   *  `timedOut`. No test executed to a verdict, so `passed: false` here is a
   *  harness fact, not a claim about the suite; callers must not publish it
   *  as one. */
  spawnFailed: boolean;
  /** The ecosystem-agnostic outcome: the suite executed and passed, executed and
   *  failed, or never executed. A caller that needs to distinguish "could not
   *  prove" from "never looked" reads this, not `passed`. */
  outcome: 'executed-with-pass' | 'executed-with-fail' | 'not-executed';
  /** Set exactly when `outcome` is 'not-executed': why no suite ran. */
  notExecutedReason?: NotExecutedReason;
  /** Human-readable elaboration of `notExecutedReason`. */
  notExecutedDetail?: string;
}

/** A run that never started, with its classified reason. Never reports
 *  `passed: true`, and never claims a suite result. */
function notExecuted(reason: NotExecutedReason, detail: string): TestRunResult {
  return {
    passed: false,
    failingTests: [],
    rawOutput: detail,
    timedOut: reason === 'timeout',
    spawnFailed: reason !== 'timeout',
    outcome: 'not-executed',
    notExecutedReason: reason,
    notExecutedDetail: detail,
  };
}

/**
 * Run one restoration test command in a provisioned workspace. Never throws
 * for run-shaped problems: a nonzero exit parses identities from the output,
 * a nonzero exit with unparseable output surfaces as `passed: false` with no
 * identities (loud, distinct, and fail-closed downstream), a timeout sets
 * `timedOut`, and a spawn-level error (ENOENT and friends) returns the error
 * message as `rawOutput`. Honors SWARM_EG_NODE_BIN and the sandbox env
 * allowlist via execBin/execEnv.
 *
 * The scope and preflight steps are ecosystem-specific and delegate to
 * ecosystem-runner: Node runs at the workspace root with workspace-relative
 * paths exactly as before, while Go and Python resolve their module or project
 * root first, and a missing toolchain is reported as a named not-executed reason
 * instead of dying at spawn.
 */
export function executeTestRun(opts: ExecuteTestRunOptions): TestRunResult {
  const env = { ...execEnv(opts.cacheDir), ...(opts.recipe?.env ?? {}) };
  const scoped = resolveTestScope(opts.runner, opts.cwd, opts.files);
  if (!scoped.ok) return notExecuted(scoped.reason, scoped.detail);
  // Docker supplies its own image toolchain, so a host-side preflight would
  // reject runs that are perfectly able to execute in the container.
  if (opts.docker === undefined) {
    const pre = preflightRunner(opts.runner, scoped.scope.cwd, env);
    if (!pre.ok) {
      log.warn(
        `test run not attempted (runner=${opts.runner}, reason=${pre.reason}): ${pre.detail}`,
      );
      return notExecuted(pre.reason, pre.detail);
    }
  }
  const { command, args } = buildTestCommand(opts.runner, scoped.scope.targets);
  try {
    const stdout = execFileGuarded(execBin(command), args, {
      cwd: scoped.scope.cwd,
      env,
      timeoutMs: opts.timeoutMs,
      captureStdout: true,
      maxBuffer: 16 * 1024 * 1024,
      ...(opts.docker !== undefined ? { docker: opts.docker } : {}),
    });
    return {
      passed: true,
      failingTests: [],
      rawOutput: stdout,
      timedOut: false,
      spawnFailed: false,
      outcome: 'executed-with-pass',
    };
  } catch (err) {
    // execFileGuarded throws a GuardedRunError for nonzero exits, timeouts,
    // and spawn failures alike, always carrying stdout/stderr/timedOut; the
    // Partial cast keeps this safe should a foreign error ever surface.
    const guarded = err as Partial<GuardedRunError>;
    const stdout = typeof guarded.stdout === 'string' ? guarded.stdout : '';
    const stderr = typeof guarded.stderr === 'string' ? guarded.stderr : '';
    const timedOut = guarded.timedOut === true;
    // exec-env sets `status` to a number exactly when the child exited under
    // its own exit code; null (or a foreign error without the field) means
    // nothing ran to completion, which is a harness failure, not a test run.
    const spawnFailed = !timedOut && typeof guarded.status !== 'number';
    const captured = [stdout, stderr].filter((s) => s.length > 0).join('\n');
    const rawOutput =
      captured.length > 0 ? captured : err instanceof Error ? err.message : String(err);
    // A timed-out run's partial output proves nothing, and a spawn failure
    // produced no runner output at all; report no identities so the
    // classifier lands on an execution anomaly, not a proof.
    const failingTests =
      timedOut || spawnFailed ? [] : parseFailingTests(opts.runner, stdout, stderr);
    log.debug(
      `test run failed (runner=${opts.runner}, timedOut=${timedOut}, spawnFailed=${spawnFailed}, ` +
        `identities=${failingTests.length}): ${command} ${args.join(' ')}`,
    );
    if (timedOut) return notExecuted('timeout', `run exceeded ${opts.timeoutMs}ms: ${rawOutput}`);
    if (spawnFailed) return notExecuted('spawn-failed', rawOutput);
    return {
      passed: false,
      failingTests,
      rawOutput,
      timedOut,
      spawnFailed,
      outcome: 'executed-with-fail',
    };
  }
}

// ---------------------------------------------------------------------------
// The orchestrator. The proof engine that later blocks PRs, so fail-closed
// discipline is absolute: it never throws, and every early exit is a loud
// not-proven verdict with a reason. The order is cheap-first: patch
// extraction, then the runner gate, then the tampered-suite control, then the
// reverse-apply, then the double restored run, and only when everything up to
// there is proven-shaped does the base-checkout control run.
// ---------------------------------------------------------------------------

/** Run `git apply [-R]` in `cwd` with the patch on stdin. Never throws. */
function gitApplyPatch(opts: { patch: string; cwd: string; reverse: boolean }): {
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
    return {
      ok: false,
      detail: detail.length > 0 ? detail : `git apply exited with status ${res.status ?? 'null'}`,
    };
  }
  return { ok: true, detail: '' };
}

/** `git status --porcelain --untracked-files=no` in `cwd`, or null when git
 *  itself failed. Tracked files only: untracked scratch (caches, markers a
 *  test writes) is expected workspace noise, not what this probe watches. */
function readTrackedStatus(cwd: string): string | null {
  const res = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (res.error !== undefined || res.status !== 0) return null;
  return res.stdout;
}

interface RestoredPhaseOutcome {
  verdict: RestorationVerdict;
  failingTests: string[];
  reason?: string;
}

function reasonForRestoredAnomaly(
  verdict: RestorationVerdict,
  run1: TestRunResult,
  run2: TestRunResult,
): string {
  if (verdict === 'not-proven:flaky') {
    if (run1.passed !== run2.passed) {
      return (
        `restored runs split: run 1 ${run1.passed ? 'passed' : 'failed'}, ` +
        `run 2 ${run2.passed ? 'passed' : 'failed'}`
      );
    }
    return (
      `restored runs failed with different identities: run 1 [${run1.failingTests.join(', ')}], ` +
      `run 2 [${run2.failingTests.join(', ')}]`
    );
  }
  return 'restored runs failed twice without parseable failing-test identities (execution anomaly, not proof)';
}

/** Steps 5-6 of the locked order: the double restored run, then (only when
 *  the result is proven-shaped) the base-checkout control. Mutates `controls`
 *  to reflect exactly what ran. Runs inside the reverse-applied workspace. */
function runRestoredPhase(
  input: TestRestorationInput,
  runner: TestRunner,
  testFiles: string[],
  controls: RestorationControls,
): RestoredPhaseOutcome {
  const runOpts: ExecuteTestRunOptions = {
    runner,
    files: testFiles,
    cwd: input.postWorkspacePath,
    timeoutMs: input.timeoutMs,
    ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
    ...(input.docker !== undefined ? { docker: input.docker } : {}),
  };
  const run1 = executeTestRun(runOpts);
  if (run1.timedOut) {
    return {
      verdict: 'not-proven:execution-error',
      failingTests: [],
      reason: `restored run 1 timed out after ${input.timeoutMs}ms`,
    };
  }
  if (run1.spawnFailed) {
    return {
      verdict: 'not-proven:execution-error',
      failingTests: [],
      reason: `restored run 1 never executed (spawn-level failure): ${run1.rawOutput}`,
    };
  }
  const run2 = executeTestRun(runOpts);
  if (run2.timedOut) {
    return {
      verdict: 'not-proven:execution-error',
      failingTests: [],
      reason: `restored run 2 timed out after ${input.timeoutMs}ms`,
    };
  }
  if (run2.spawnFailed) {
    return {
      verdict: 'not-proven:execution-error',
      failingTests: [],
      reason: `restored run 2 never executed (spawn-level failure): ${run2.rawOutput}`,
    };
  }

  const runs = {
    restoredRun1Failed: !run1.passed,
    restoredRun2Failed: !run2.passed,
    run1FailingTests: run1.failingTests,
    run2FailingTests: run2.failingTests,
  };

  // Control-1-independent probe: with both other controls assumed green, the
  // classifier returns 'proven' exactly when the restored runs failed twice
  // with the same nonempty identity. Every other verdict (refuted, flaky,
  // identityless execution-error) is decided before the base control is
  // consulted, so it is final without running control 1 (cheap-first), and
  // the probe is also how restoredFailsTwiceSameIdentity is derived without
  // re-implementing the identity comparison.
  const probe = classifyRestoration({ tamperedSuitePasses: true, baseTestPasses: true, ...runs });
  if (probe.verdict !== 'proven') {
    controls.restoredFailsTwiceSameIdentity = false;
    if (probe.verdict === 'refuted') {
      return { verdict: 'refuted', failingTests: [] };
    }
    return {
      verdict: probe.verdict,
      failingTests: [],
      reason: reasonForRestoredAnomaly(probe.verdict, run1, run2),
    };
  }
  controls.restoredFailsTwiceSameIdentity = true;

  // Control 1: the restored test must pass on the base checkout, or the
  // failure predates the PR. The base workspace already carries the original
  // tests; nothing is applied there.
  if (input.preWorkspacePath === null) {
    const final = classifyRestoration({ tamperedSuitePasses: true, baseTestPasses: null, ...runs });
    return {
      verdict: final.verdict,
      failingTests: final.failingTests,
      reason: 'base-workspace-unavailable: control 1 cannot run without a base checkout',
    };
  }
  const baseRun = executeTestRun({ ...runOpts, cwd: input.preWorkspacePath });
  if (baseRun.timedOut) {
    return {
      verdict: 'not-proven:execution-error',
      failingTests: [],
      reason: `base-control run timed out after ${input.timeoutMs}ms`,
    };
  }
  // A base control that never executed is not a base failure: publishing
  // `baseTestPasses: false` here would read as "the failure predates the PR"
  // for a run that never happened, so the control stays null and the verdict
  // is an execution error.
  if (baseRun.spawnFailed) {
    return {
      verdict: 'not-proven:execution-error',
      failingTests: [],
      reason: `base-control run never executed (spawn-level failure): ${baseRun.rawOutput}`,
    };
  }
  controls.baseTestPasses = baseRun.passed;
  const final = classifyRestoration({
    tamperedSuitePasses: true,
    baseTestPasses: baseRun.passed,
    ...runs,
  });
  if (final.verdict === 'proven') {
    return closureRelevanceGate(input, testFiles, final.failingTests);
  }
  return {
    verdict: final.verdict,
    failingTests: [],
    reason: 'the restored test also fails on the base checkout: the failure predates the PR',
  };
}

/**
 * Protocol-1 relevance refuter, applied to an otherwise-proven restoration. When
 * a repoRoot is threaded in, confirm the restored test's import closure reaches
 * production code the PR changed; if it confidently reaches none, downgrade to
 * not-proven:test-not-closure-linked (the restored failure is not attributable
 * to this PR's change). Abstains (keeps the proof) when no repoRoot is given,
 * the closure cannot be computed, or the refuter is uncertain (capped BFS, no
 * source change). Never throws.
 */
function closureRelevanceGate(
  input: TestRestorationInput,
  testFiles: string[],
  failingTests: string[],
): RestoredPhaseOutcome {
  if (input.repoRoot === undefined) {
    return { verdict: 'proven', failingTests };
  }
  // The closure refuter follows TS/JS/Python imports only; a Go (or other
  // non-analyzable) test file is parsed by the TS fallback and yields an
  // unreliable, effectively-empty closure. Treating that as "reaches none of the
  // changed source" would refute a real proof the behavioral controls already
  // established, so abstain when the closure cannot be built for these test files
  // (same fail-closed stance the refuter takes for a capped BFS). The Protocol-1
  // relevance check is a JS/TS/Python refinement; the language-agnostic behavioral
  // controls and the re-spec refuter carry the proof on other languages.
  if (!testFiles.every(isClosureAnalyzable)) {
    log.debug(
      `closure relevance gate abstains: ${testFiles.join(', ')} is not import-analyzable (TS/JS/Python only)`,
    );
    return { verdict: 'proven', failingTests };
  }
  const changedSrc = changedNonTestSourceFiles(input.prDiff);
  let closure;
  try {
    closure = reachableSourceFiles(testFiles, input.repoRoot);
  } catch (err) {
    // The behavioral controls already proved the restoration; a closure failure
    // is not grounds to drop it, so the refuter abstains.
    log.debug(
      `closure relevance gate could not run for ${testFiles.join(', ')}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { verdict: 'proven', failingTests };
  }
  if (closureRefutesRestoration(closure, changedSrc, input.repoRoot)) {
    return {
      verdict: 'not-proven:test-not-closure-linked',
      failingTests: [],
      reason:
        `the restored test's import closure reaches none of the source this PR changed ` +
        `(${changedSrc.join(', ')}), so the restored failure is not attributable to the PR's ` +
        `production change`,
    };
  }
  return { verdict: 'proven', failingTests };
}

/**
 * Conservative re-specification refuter for an otherwise-proven restoration.
 *
 * The proof rests on "the restored OLD test fails on the PR source". That is
 * equally true of a tamper (a regression hidden behind a weakened test) and of a
 * legitimate behaviour change (the PR changed the source intentionally and
 * updated the test to assert the NEW behaviour; the old test asserted the OLD
 * behaviour, so it fails). The discriminator is the SUBMITTED test run on the
 * BASE source:
 *
 *   - a tamper weakens a test that already passed, so the submitted test still
 *     PASSES on the base source;
 *   - a re-specification asserts new behaviour the base source does not have, so
 *     the submitted test FAILS on the base source.
 *
 * Fires (drops the proof) only on a clean, definite submitted-fails-on-base.
 * Abstains (keeps the proof) on every uncertainty (no base workspace, the PR
 * deleted the test file, a patch-apply, spawn, or timeout problem), so it can
 * only turn proven into not-proven, never the reverse, and never drops an oracle
 * tamper (whose weakened test passes on base). The base workspace is restored to
 * its original tests before returning.
 */
function reSpecifiesOnBase(
  input: TestRestorationInput,
  runner: TestRunner,
  tamperedFile: string | null,
  patch: string,
): boolean {
  if (input.preWorkspacePath === null || tamperedFile === null) return false;
  // Put the submitted (new) test onto the base source: apply the test hunk
  // forward in the base workspace (which carries the old test), run, then revert.
  const applied = gitApplyPatch({ patch, cwd: input.preWorkspacePath, reverse: false });
  if (!applied.ok) return false;
  try {
    const run = executeTestRun({
      runner,
      files: [tamperedFile],
      cwd: input.preWorkspacePath,
      timeoutMs: input.timeoutMs,
      ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
      ...(input.docker !== undefined ? { docker: input.docker } : {}),
    });
    if (run.timedOut || run.spawnFailed) return false;
    return !run.passed;
  } finally {
    gitApplyPatch({ patch, cwd: input.preWorkspacePath, reverse: true });
  }
}

/**
 * Pure: the exported symbol names a PR removed from its non-test source. A
 * deleted `export function NAME`, `export const/let/var NAME`, `export class
 * NAME`, or `export interface/type/enum NAME` line (a `-` change) in a
 * production file. The test-file filter keeps `describe`/`it` and test-local
 * exports out. Used by the subject-removed refuter; conservative (only the
 * declaration forms, not re-export lists) so it under-matches rather than over.
 */
export function removedExportedSymbols(prDiff: string): Set<string> {
  const out = new Set<string>();
  const patterns = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /\bexport\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  ];
  for (const file of parseDiff(prDiff)) {
    const p = realPath(file.to) ?? realPath(file.from);
    if (p === null || isTestFile(p)) continue;
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type !== 'del') continue;
        for (const re of patterns) {
          const m = change.content.match(re);
          if (m && m[1] !== undefined) out.add(m[1]);
        }
      }
    }
  }
  return out;
}

/**
 * Pure: the subject-removed refuter. Returns the matched symbol when the
 * restored (deleted) test references a production symbol the PR removed as an
 * export, otherwise null. The restored test patch's deletions are the tests the
 * PR removed; if any identifier they reference is a symbol the PR also removed
 * from production source, the test was deleted because its subject was
 * refactored away (its import would now resolve to nothing), not to conceal a
 * regression. The re-spec refuter cannot catch this: there is no submitted test
 * to run on base. Conservative: matches only a removed export *declaration*, so
 * it abstains on every uncertainty and can only turn proven into not-proven. It
 * never matches an oracle tamper, which weakens an assertion in a test whose
 * production subject is unchanged (no removed export to match).
 */
export function restoredTestSubjectRemoved(prDiff: string, testPatch: string): string | null {
  const removed = removedExportedSymbols(prDiff);
  if (removed.size === 0) return null;
  // Identifiers referenced on the restored test's deleted lines.
  const referenced = new Set<string>();
  for (const line of testPatch.split('\n')) {
    if (!line.startsWith('-') || line.startsWith('---')) continue;
    for (const id of line.slice(1).match(/[A-Za-z_$][\w$]*/g) ?? []) referenced.add(id);
  }
  for (const sym of removed) {
    if (referenced.has(sym)) return sym;
  }
  return null;
}

// Data files a test compares against (golden/approved outputs, snapshots): a
// PR that adds one is adding coverage even though isTestFile does not classify
// the data file itself as a test. Keyed by a path segment (a `testdata`,
// `__snapshots__`, or `snapshots` directory) or a basename shape
// (`*.golden`, `*.golden.*`, `*.snap`, `*.approved.*`).
const COVERAGE_DATA_SEGMENTS: ReadonlySet<string> = new Set([
  'testdata',
  '__snapshots__',
  '__fixtures__',
  'snapshots',
]);
const COVERAGE_DATA_BASENAME = /\.(golden|snap|approved)(\.[^.]+)?$/;

/** Pure: true when `p` is a golden/snapshot/approved fixture a test reads. */
export function isCoverageDataFile(p: string): boolean {
  const segments = p.split('/');
  if (segments.some((s) => COVERAGE_DATA_SEGMENTS.has(s))) return true;
  return COVERAGE_DATA_BASENAME.test(segments[segments.length - 1] ?? '');
}

/** Pure: true when `p`'s directory, or any ancestor, is a directory the PR also
 *  changed production source in. Walks up so a `testdata` subdir under a changed
 *  package (`internal/githooks/testdata/x.golden` under `internal/githooks`)
 *  links to it. */
function dirWithinChangedProd(p: string, changedProdDirs: ReadonlySet<string>): boolean {
  let dir = path.posix.dirname(p);
  for (;;) {
    if (changedProdDirs.has(dir)) return true;
    const parent = path.posix.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Pure: the coverage-relocation refuter. Returns a reason when the PR, in the
 * same diff, adds REPLACEMENT test coverage over the same production code the
 * tampered test guarded, otherwise null.
 *
 * The restoration proof establishes "a guarding assertion was removed and the
 * guarded behaviour changed". That pattern is equally the signature of a
 * legitimate refactor that MOVED coverage elsewhere: the weakened assertion
 * checked the old shape, the PR redesigned the subject, and a new dedicated test
 * (or golden file) now verifies it more thoroughly. The proof cannot see
 * coverage that moved to a different file (jeduden/mdsmith#232, the gate's one
 * known false-positive class). This refuter detects the relocation statically:
 * the PR adds a net-new test file, or a golden/snapshot/testdata fixture with
 * added content, whose directory sits within production source the PR itself
 * changed. Present => downgrade to not-proven:coverage-relocated (fail closed:
 * an abstain is human review, never a clean pass; the attestation records it as
 * `disputed`). Ties the relocation to "the same code" via directory proximity to
 * a changed production file, so an unrelated added test elsewhere does not fire
 * it and a pure assertion-deletion tamper (which adds no replacement coverage)
 * proves unchanged. Conservative: only turns proven into not-proven, never the
 * reverse.
 *
 * @param prDiff the PR's full unified diff.
 * @param findingFile the tampered test file (excluded from the added set).
 * @returns a human-facing reason when replacement coverage is present, else null.
 */
export function coverageRelocated(prDiff: string, findingFile: string): string | null {
  const changedProdDirs = new Set<string>();
  const added: string[] = [];
  for (const file of parseDiff(prDiff)) {
    const p = realPath(file.to) ?? realPath(file.from);
    if (p === null) continue;
    if (!isTestFile(p) && !isCoverageDataFile(p)) {
      changedProdDirs.add(path.posix.dirname(p));
      continue;
    }
    if (p === findingFile) continue;
    const isNew = file.new === true;
    const addsContent = file.chunks.some((c) => c.changes.some((ch) => ch.type === 'add'));
    if ((isTestFile(p) && isNew) || (isCoverageDataFile(p) && (isNew || addsContent))) {
      added.push(p);
    }
  }
  if (added.length === 0) return null;
  const relocated = added.filter((p) => dirWithinChangedProd(p, changedProdDirs)).sort();
  if (relocated.length === 0) return null;
  return (
    `the PR adds replacement test coverage (${relocated.join(', ')}) in production ` +
    `directories it also changed, so the weakened assertion may be a legitimate ` +
    `coverage-moving refactor rather than a concealed regression; human review required`
  );
}

/**
 * Impure orchestrator: prove (or fail to prove) that the PR tampered with a
 * test to conceal a failure. Never throws; every non-proven verdict carries a
 * reason. The post workspace is shared with later consumers, so the reverse-
 * applied test patch is always re-applied forward before returning, even when
 * the restored phase errors.
 */
export function runTestRestoration(input: TestRestorationInput): RestorationProofRecord {
  // Last-resort guard so "never throws" holds by construction: the pipeline's
  // building blocks are individually fail-closed, but a harness bug anywhere
  // in between must still come back as a verdict, never an exception.
  try {
    return runRestorationPipeline(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`test-restoration: orchestrator threw unexpectedly: ${message}`);
    return {
      schemaVersion: 1,
      verdict: 'not-proven:execution-error',
      category: input.finding.category,
      findingFile: input.finding.file,
      testFiles: [],
      failingTests: [],
      controls: {
        baseTestPasses: null,
        tamperedSuitePasses: null,
        restoredFailsTwiceSameIdentity: null,
      },
      reproduceCommand: '',
      revertedHunkPatch: '',
      reason: `test-restoration orchestrator threw unexpectedly: ${message}`,
    };
  }
}

function runRestorationPipeline(input: TestRestorationInput): RestorationProofRecord {
  const controls: RestorationControls = {
    baseTestPasses: null,
    tamperedSuitePasses: null,
    restoredFailsTwiceSameIdentity: null,
  };
  // Set when control 2 cannot exist at all (the PR deleted the test file);
  // folded into every record's reason so a published null control always
  // explains itself.
  let vacuousControl2Note: string | null = null;
  const record = (
    verdict: RestorationVerdict,
    fields: {
      testFiles?: string[];
      failingTests?: string[];
      reproduceCommand?: string;
      revertedHunkPatch?: string;
      reason?: string;
    },
  ): RestorationProofRecord => {
    const reasonParts = [fields.reason, vacuousControl2Note ?? undefined].filter(
      (part): part is string => part !== undefined,
    );
    return {
      schemaVersion: 1,
      verdict,
      category: input.finding.category,
      findingFile: input.finding.file,
      testFiles: fields.testFiles ?? [],
      failingTests: fields.failingTests ?? [],
      controls,
      reproduceCommand: fields.reproduceCommand ?? '',
      revertedHunkPatch: fields.revertedHunkPatch ?? '',
      ...(reasonParts.length > 0 ? { reason: reasonParts.join('; ') } : {}),
    };
  };

  // Step 1: the finding must come with revertible test hunks.
  const patch = extractTestHunkPatch(input.prDiff, input.finding.file);
  if (patch === null) {
    return record('not-proven:no-test-hunks', {
      reason: `the PR diff carries no test-file hunks for '${input.finding.file}'`,
    });
  }

  // Step 2: only runners with a locked file-scoped invocation and identity
  // parser may execute (jest, vitest, mocha, pytest, go-test).
  const runner = input.testRunner;
  if (runner === null || !isSupportedRunner(runner)) {
    return record('not-proven:runner-unsupported', {
      revertedHunkPatch: patch,
      reason:
        runner === null
          ? 'no supported test runner detected in the workspace'
          : `test runner '${runner}' has no locked file-scoped invocation ` +
            `(jest, vitest, mocha, pytest, go-test only)`,
    });
  }

  // The restored state carries the patch's old-side path (a deleted test file
  // exists again after the revert); the submitted state carries the new side.
  const patchedFile = parseDiff(patch)[0];
  const restoredFile =
    patchedFile !== undefined ? (realPath(patchedFile.from) ?? realPath(patchedFile.to)) : null;
  if (restoredFile === null) {
    return record('not-proven:execution-error', {
      revertedHunkPatch: patch,
      reason: 'the extracted test-hunk patch names no real file path on either side',
    });
  }
  const testFiles = [restoredFile];
  const tamperedFile = patchedFile !== undefined ? realPath(patchedFile.to) : null;

  // Step 3 / control 2: the PR's own test run must pass as submitted. A PR
  // that deleted the test file outright has nothing to run here, which
  // trivially passes for classification purposes (CI saw no failure), but the
  // published control stays null: no tampered run executed, and the record
  // must never claim one did.
  if (tamperedFile !== null) {
    const tamperedRun = executeTestRun({
      runner,
      files: [tamperedFile],
      cwd: input.postWorkspacePath,
      timeoutMs: input.timeoutMs,
      ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
      ...(input.docker !== undefined ? { docker: input.docker } : {}),
    });
    // A run that never executed (missing toolchain, missing workspace, timeout)
    // is a harness or environment fact, not a failing suite: publishing
    // `tamperedSuitePasses: false` here would read as "CI would have caught this
    // PR" for a run that never happened, so the control stays null and the
    // verdict is an execution error carrying the classified reason. Naming the
    // reason is what lets a reader tell "the Go toolchain was absent" from "the
    // workspace was corrupt" without re-running the audit.
    if (tamperedRun.outcome === 'not-executed') {
      return record('not-proven:execution-error', {
        testFiles,
        revertedHunkPatch: patch,
        reason:
          `tampered-suite control run never executed ` +
          `(${tamperedRun.notExecutedReason ?? 'unclassified'}): ` +
          `${tamperedRun.notExecutedDetail ?? tamperedRun.rawOutput}`,
      });
    }
    if (!tamperedRun.passed) {
      controls.tamperedSuitePasses = false;
      const ids = tamperedRun.failingTests;
      return record('not-proven:suite-already-failing', {
        testFiles,
        revertedHunkPatch: patch,
        reason:
          `the PR's own test run fails as submitted` +
          `${ids.length > 0 ? ` (${ids.join(', ')})` : ''}; CI would have caught this PR`,
      });
    }
    controls.tamperedSuitePasses = true;
  } else {
    vacuousControl2Note =
      'control 2 vacuous: the PR deleted the test file outright, so no tampered run exists';
  }

  // Tracked-state observability baseline. The fixture builder commits its
  // workspaces clean, but a production caller may hand over a checkout with
  // legitimate uncommitted state, so the post-restore probe below warns only
  // on a DIFFERENCE from this snapshot, never on dirt that was already there.
  const trackedBefore = readTrackedStatus(input.postWorkspacePath);

  // Step 4: revert the test hunks in the post workspace.
  const reverse = gitApplyPatch({ patch, cwd: input.postWorkspacePath, reverse: true });
  if (!reverse.ok) {
    return record('not-proven:patch-apply-failed', {
      testFiles,
      revertedHunkPatch: patch,
      reason: `git apply -R failed in the post workspace: ${reverse.detail}`,
    });
  }

  // Steps 5-6 run against the reverse-applied workspace; the forward re-apply
  // in the finally restores the shared workspace for later consumers no
  // matter what happened in between.
  let outcome: RestoredPhaseOutcome;
  let restoreFailure: string | null = null;
  try {
    try {
      outcome = runRestoredPhase(input, runner, testFiles, controls);
    } finally {
      const forward = gitApplyPatch({ patch, cwd: input.postWorkspacePath, reverse: false });
      if (!forward.ok) {
        restoreFailure = `forward re-apply failed, the post workspace is corrupted (harness bug): ${forward.detail}`;
        log.error(
          `test-restoration: ${restoreFailure} (cwd=${input.postWorkspacePath}, file=${input.finding.file})`,
        );
      } else if (trackedBefore !== null) {
        // Log-only observability: a restored test that mutated tracked files
        // is worth a look, but it is not by itself evidence about the PR, so
        // it never changes the record.
        const trackedAfter = readTrackedStatus(input.postWorkspacePath);
        if (trackedAfter !== null && trackedAfter !== trackedBefore) {
          log.warn(
            `test-restoration: tracked files in the post workspace changed across the restoration ` +
              `(cwd=${input.postWorkspacePath}); git status --porcelain now reads:\n${trackedAfter}`,
          );
        }
      }
    }
  } catch (err) {
    // runRestoredPhase's building blocks never throw by contract; anything
    // that still surfaces here is a harness bug, reported fail-closed.
    const message = err instanceof Error ? err.message : String(err);
    log.error(`test-restoration: restored phase threw unexpectedly: ${message}`);
    outcome = {
      verdict: 'not-proven:execution-error',
      failingTests: [],
      reason: `restored phase threw unexpectedly: ${message}`,
    };
  }
  if (restoreFailure !== null) {
    outcome = {
      ...outcome,
      reason:
        outcome.reason !== undefined ? `${outcome.reason}; ${restoreFailure}` : restoreFailure,
    };
  }

  // Step 6b: re-specification refuter. The restored old test failing on the PR
  // source proves a concealed regression only if the test was weakened; if the
  // PR instead re-specified the test to match an intentional source change, the
  // submitted test asserts new behaviour and fails on the base source. Drop the
  // proof in that case (a real behaviour change with a matching test update is
  // not a tamper). Conservative: only fires on a clean submitted-fails-on-base.
  if (outcome.verdict === 'proven' && reSpecifiesOnBase(input, runner, tamperedFile, patch)) {
    outcome = {
      verdict: 'not-proven:re-specified',
      failingTests: [],
      reason:
        'the submitted test fails on the base source: the PR re-specified the asserted behaviour ' +
        'to match an intentional source change, not a concealed regression',
    };
  }

  // Step 6c: subject-removed refuter. A deleted test whose subject the PR also
  // removed from production (an export the PR deleted) is a refactor, not a
  // tamper: the restored test fails on the PR source only because its import no
  // longer resolves. The re-spec refuter cannot see this (there is no submitted
  // test to run on base), so it is checked separately, purely from the diff.
  if (outcome.verdict === 'proven') {
    const removedSubject = restoredTestSubjectRemoved(input.prDiff, patch);
    if (removedSubject !== null) {
      outcome = {
        verdict: 'not-proven:subject-removed',
        failingTests: [],
        reason:
          `the restored test exercises "${removedSubject}", which this PR removed from production ` +
          `source: the test was deleted because its subject was refactored away, not to conceal a regression`,
      };
    }
  }

  // Step 6d: coverage-relocation refuter. A weakened assertion whose guarded
  // coverage the PR moved to a new test or golden file (in a production
  // directory it also changed) is a legitimate refactor, not concealment; the
  // proof cannot see the relocated coverage (jeduden/mdsmith#232). Downgrade to
  // a fired-then-disputed verdict the attestation surfaces as human-review, not
  // a clean pass. Pure diff signal, checked only on an otherwise-proven record.
  if (outcome.verdict === 'proven') {
    const relocation = coverageRelocated(input.prDiff, input.finding.file);
    if (relocation !== null) {
      outcome = { verdict: 'not-proven:coverage-relocated', failingTests: [], reason: relocation };
    }
  }

  // Step 7: a proven verdict must ship its reproduce command; a proof a human
  // cannot replay is not published as a proof (fail closed).
  if (outcome.verdict === 'proven') {
    let reproduceCommand: string;
    try {
      reproduceCommand = buildReproduceCommand({
        prRef: input.prRef,
        prHeadSha: input.prHeadSha,
        testFiles,
        testRunner: runner,
        revertedHunkPatch: patch,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(
        `test-restoration: proven restoration cannot render its reproduce command: ${message}`,
      );
      const reason = `proven restoration could not render its reproduce command: ${message}`;
      return record('not-proven:execution-error', {
        testFiles,
        revertedHunkPatch: patch,
        reason: outcome.reason !== undefined ? `${reason}; ${outcome.reason}` : reason,
      });
    }
    return record('proven', {
      testFiles,
      failingTests: outcome.failingTests,
      reproduceCommand,
      revertedHunkPatch: patch,
      ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
    });
  }
  return record(outcome.verdict, {
    testFiles,
    revertedHunkPatch: patch,
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
  });
}
