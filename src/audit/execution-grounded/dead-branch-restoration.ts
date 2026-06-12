// Dead-branch restoration. A counterfactual proof for the structural
// dead-branch-insertion detector, which flags an inserted `if (<literal-false>)`
// branch by its condition shape but cannot witness whether the branch is truly
// unreachable in the running suite. The proof instruments the inserted branch in
// the provisioned head workspace and runs the affected-test closure: a probe
// inside the branch body records whether the body ever executes, and a
// positive-control probe placed immediately before the `if` records whether the
// condition was evaluated at all. The branch is proven dead only when the
// control fired (the `if` was reached, so the harness and closure are sound) and
// the branch probe never fired (the body never ran). A branch probe that does
// fire refutes the finding: the branch is live, so the detector over-flagged.
//
// Three per-instance controls, all green before the proof can gate (fail-closed,
// exactly like no-op-fix-proven and the other restoration proofs):
//   1. branchResolved            a single inserted if-branch with a block body is
//                                resolved from the diff at the finding line
//   2. suitePassesAsSubmitted    the affected tests pass with the PR applied and
//                                the instrumentation in place (so the probe
//                                injection did not break the suite)
//   3. branchNeverExecuted       the positive control fired (the `if` was
//                                evaluated) AND the branch-body probe never fired
//
// The discriminator vs a live branch is control 3: a reachable branch fires its
// body probe -> refuted; a dead branch the suite reaches but never enters fires
// only the control -> proven. A control that never fires (the `if` was never
// evaluated by the closure) is no proof, not a block; nor is an empty or capped
// affected-test closure, an instrumentation failure, or an ambiguous branch.
//
// The pure core (branch resolution, instrumentation splice, sentinel reading,
// classification, reproduce command) is unit-tested without a sandbox; the
// orchestrator mirrors runNoOpFixRestoration's fail-closed discipline and reuses
// its runner execution building blocks. The instrumented file is always restored
// before returning, so the shared workspace stays valid for later consumers.

import * as fs from 'fs';
import * as path from 'path';
import parseDiff from 'parse-diff';
import * as ts from 'typescript';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';
import { isPlausiblyTestReachable } from '../cheat-detector/diff-walker';
import type { TestRunner, PackageManager } from './sandbox';
import type { MutationRecipe } from './mutation-check';
import type { DockerContext } from './docker-runner';
import { executeTestRun, type ExecuteTestRunOptions } from './test-restoration';
import {
  selectAffectedTestFiles,
  DEFAULT_MAX_TEST_FILES_EXAMINED,
} from './no-op-fix-restoration';

const log = getLogger('audit:execution-grounded:dead-branch-restoration');

export type DeadBranchVerdict =
  | 'proven'
  | 'refuted'
  | 'not-proven:non-source-file'
  | 'not-proven:no-dead-branch'
  | 'not-proven:ambiguous-branch'
  | 'not-proven:no-affected-tests'
  | 'not-proven:closure-capped'
  | 'not-proven:suite-already-failing'
  | 'not-proven:instrumentation-failed'
  | 'not-proven:control-not-reached'
  | 'not-proven:runner-unsupported'
  // Reserved for the execution-grounded caller when no sandbox workspace exists.
  | 'not-proven:no-workspace'
  | 'not-proven:execution-error';

export interface DeadBranchControls {
  /** Control 1: a single inserted if-branch with a block body was resolved. */
  branchResolved: boolean | null;
  /** Control 2: the affected tests pass with the PR applied and instrumented. */
  suitePassesAsSubmitted: boolean | null;
  /** Control 3: the control probe fired and the branch-body probe never did. */
  branchNeverExecuted: boolean | null;
}

export interface DeadBranchProofRecord {
  schemaVersion: 1;
  verdict: DeadBranchVerdict;
  category: 'dead-branch-insertion';
  findingFile: string;
  /** The dead branch's condition text, quoted back (empty unless resolved). */
  branchCondition: string;
  /** The 1-based line of the inserted `if` (0 unless resolved). */
  branchLine: number;
  /** Repo tests whose closure reaches the branch file (what was run). */
  affectedTestFiles: string[];
  controls: DeadBranchControls;
  /** Exact command a human runs in a fresh checkout to reproduce the proof. */
  reproduceCommand: string;
  reason?: string;
}

export interface DeadBranchRestorationInput {
  finding: { category: 'dead-branch-insertion'; file: string; line: number };
  prDiff: string;
  prRef: string;
  prHeadSha: string;
  postWorkspacePath: string;
  /** Repo root for closure scoping and repo-test enumeration (= post workspace). */
  repoRoot: string;
  testRunner: TestRunner | null;
  packageManager: PackageManager;
  recipe?: MutationRecipe;
  timeoutMs: number;
  docker?: DockerContext;
  /** Cap on repo test files examined for the affected-test closure. */
  maxTestFilesExamined?: number;
  /** Sentinel file the injected probes append to; defaults to a temp file under
   *  the workspace. Injected as an absolute path baked into the probe text, so
   *  the proof does not depend on the runner forwarding a custom env var. */
  sentinelPath?: string;
}

const SOURCE_EXT = /\.(?:m|c)?[jt]sx?$/;
const realPathOf = (p: string | undefined): string | null =>
  p !== undefined && p !== '/dev/null' ? p : null;

/** Marker the branch-body probe writes; its presence in the sentinel refutes. */
export const BRANCH_MARKER = 'B';
/** Marker the positive-control probe (before the `if`) writes; its absence means
 *  the `if` was never evaluated, so a silent branch proves nothing. */
export const CONTROL_MARKER = 'P';

export interface ResolvedDeadBranch {
  /** The condition source text (e.g. `false`, `0`, `true && false`). */
  condition: string;
  /** 1-based line of the `if` keyword in the post (head) file. */
  ifLine: number;
  /** Byte offset just after the then-block's opening brace (branch probe site). */
  branchProbeOffset: number;
  /** Byte offset at the start of the `if` statement (control probe site). */
  controlProbeOffset: number;
}

/**
 * Pure: the added lines the PR's diff carries for `findingFile`, by new-file line
 * number. Used to confirm the resolved `if` is one the PR inserted (not a
 * pre-existing branch the finding line happens to land on).
 */
export function addedLineNumbers(prDiff: string, findingFile: string): Set<number> {
  const target = parseDiff(prDiff).find(
    (f) => realPathOf(f.to) === findingFile || realPathOf(f.from) === findingFile,
  );
  const out = new Set<number>();
  if (target === undefined) return out;
  for (const chunk of target.chunks) {
    for (const change of chunk.changes) {
      if (change.type === 'add') {
        const ln = (change as { ln?: number }).ln;
        if (typeof ln === 'number') out.add(ln);
      }
    }
  }
  return out;
}

/**
 * Pure-with-text: resolve the single inserted if-branch at `findingLine` in the
 * head file `text`. Requires the `if` to be added by the PR (its line is in
 * `addedLines`) and its then-clause to be a brace block (so the probe has a body
 * to enter). Returns null when nothing resolves, more than one if resolves, or
 * the then-clause is not a block (fail closed: never guess a branch to gate on).
 */
export function resolveDeadBranch(
  text: string,
  fileName: string,
  findingLine: number,
  addedLines: Set<number>,
): ResolvedDeadBranch | null {
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  } catch (err) {
    log.debug(`could not parse ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const matches: ResolvedDeadBranch[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      const ifLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (ifLine === findingLine && addedLines.has(ifLine) && ts.isBlock(node.thenStatement)) {
        matches.push({
          condition: node.expression.getText(source),
          ifLine,
          branchProbeOffset: node.thenStatement.getStart(source) + 1,
          controlProbeOffset: node.getStart(source),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (matches.length !== 1) return null;
  return matches[0]!;
}

/**
 * Pure: splice the control and branch probes into `text` for `resolved`. The
 * branch probe sits just inside the then-block (it fires iff the body runs); the
 * control probe sits immediately before the `if` (it fires iff the `if` is
 * evaluated). The later offset is spliced first so the earlier offset stays
 * valid. The probes are CommonJS, path-baked, and wrapped in try/catch, so a
 * module system that cannot `require` simply does not record (which fails the
 * control and lands on not-proven, never on a false proof).
 */
export function instrumentSource(
  text: string,
  resolved: ResolvedDeadBranch,
  sentinelPath: string,
): string {
  const probe = (marker: string): string =>
    `;try{require('node:fs').appendFileSync(${JSON.stringify(sentinelPath)},${JSON.stringify(marker)});}catch(e){}`;
  const branchProbe = probe(BRANCH_MARKER);
  const controlProbe = probe(CONTROL_MARKER);
  const afterBranch =
    text.slice(0, resolved.branchProbeOffset) + branchProbe + text.slice(resolved.branchProbeOffset);
  // controlProbeOffset < branchProbeOffset, so it is unshifted by the splice above.
  return (
    afterBranch.slice(0, resolved.controlProbeOffset) +
    controlProbe +
    afterBranch.slice(resolved.controlProbeOffset)
  );
}

/**
 * Pure: read the markers a sentinel run produced. `controlFired` gates the proof
 * (the `if` was evaluated); `branchFired` refutes it (the body ran).
 */
export function readSentinel(content: string): { controlFired: boolean; branchFired: boolean } {
  return {
    controlFired: content.includes(CONTROL_MARKER),
    branchFired: content.includes(BRANCH_MARKER),
  };
}

/**
 * Pure: classify from the two sentinel runs. Fail-closed: a control that never
 * fired, or runs that disagree, never lands on proven.
 */
export function classifyDeadBranchRestoration(c: {
  suitePassesAsSubmitted: boolean;
  run1: { controlFired: boolean; branchFired: boolean };
  run2: { controlFired: boolean; branchFired: boolean };
}): { verdict: DeadBranchVerdict } {
  if (!c.suitePassesAsSubmitted) return { verdict: 'not-proven:suite-already-failing' };
  // A branch that ran in either instrumented run is live: refuted.
  if (c.run1.branchFired || c.run2.branchFired) return { verdict: 'refuted' };
  // The control must have fired in both runs, or we never witnessed the `if`
  // being evaluated and a silent branch proves nothing.
  if (!c.run1.controlFired || !c.run2.controlFired) {
    return { verdict: 'not-proven:control-not-reached' };
  }
  return { verdict: 'proven' };
}

const SUPPORTED_RUNNERS: readonly TestRunner[] = ['jest', 'vitest', 'mocha'];

function record(
  base: {
    findingFile: string;
    branchCondition: string;
    branchLine: number;
    affectedTestFiles: string[];
  },
  verdict: DeadBranchVerdict,
  controls: DeadBranchControls,
  extra: Partial<DeadBranchProofRecord> = {},
): DeadBranchProofRecord {
  return {
    schemaVersion: 1,
    verdict,
    category: 'dead-branch-insertion',
    findingFile: base.findingFile,
    branchCondition: base.branchCondition,
    branchLine: base.branchLine,
    affectedTestFiles: base.affectedTestFiles,
    controls,
    reproduceCommand: '',
    ...extra,
  };
}

/**
 * The orchestrator. Provisioning is the caller's job; this runs the controls in
 * cheap-first order against an already-provisioned post (head) workspace and
 * never throws. The instrumented branch file is always restored before
 * returning, so the shared workspace stays valid for later consumers.
 */
export function runDeadBranchRestoration(input: DeadBranchRestorationInput): DeadBranchProofRecord {
  try {
    return runDeadBranchPipeline(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`dead-branch-restoration: orchestrator threw unexpectedly: ${message}`);
    return {
      schemaVersion: 1,
      verdict: 'not-proven:execution-error',
      category: 'dead-branch-insertion',
      findingFile: input.finding.file,
      branchCondition: '',
      branchLine: 0,
      affectedTestFiles: [],
      controls: {
        branchResolved: null,
        suitePassesAsSubmitted: null,
        branchNeverExecuted: null,
      },
      reproduceCommand: '',
      reason: `dead-branch-restoration orchestrator threw unexpectedly: ${message}`,
    };
  }
}

function runDeadBranchPipeline(input: DeadBranchRestorationInput): DeadBranchProofRecord {
  const controls: DeadBranchControls = {
    branchResolved: null,
    suitePassesAsSubmitted: null,
    branchNeverExecuted: null,
  };
  const base = {
    findingFile: input.finding.file,
    branchCondition: '',
    branchLine: 0,
    affectedTestFiles: [] as string[],
  };

  if (!SOURCE_EXT.test(input.finding.file) || !isPlausiblyTestReachable(input.finding.file)) {
    return record(base, 'not-proven:non-source-file', controls, {
      reason: `the finding file '${input.finding.file}' is not a test-reachable JS/TS source file`,
    });
  }

  const absFile = path.join(input.postWorkspacePath, input.finding.file);
  let original: string;
  try {
    original = fs.readFileSync(absFile, 'utf8');
  } catch (err) {
    return record(base, 'not-proven:no-dead-branch', controls, {
      reason: `could not read the branch file in the workspace: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const resolved = resolveDeadBranch(
    original,
    input.finding.file,
    input.finding.line,
    addedLineNumbers(input.prDiff, input.finding.file),
  );
  if (resolved === null) {
    return record(base, 'not-proven:ambiguous-branch', controls, {
      reason:
        'no single inserted if-branch with a block body resolved at the finding line (fail closed)',
    });
  }
  controls.branchResolved = true;
  base.branchCondition = resolved.condition;
  base.branchLine = resolved.ifLine;

  if (input.testRunner === null || !SUPPORTED_RUNNERS.includes(input.testRunner)) {
    return record(base, 'not-proven:runner-unsupported', controls, {
      reason: `runner ${input.testRunner ?? 'none'} has no locked file-scoped invocation`,
    });
  }
  const runner = input.testRunner;

  const selection = selectAffectedTestFiles(
    input.repoRoot,
    [input.finding.file],
    input.maxTestFilesExamined ?? DEFAULT_MAX_TEST_FILES_EXAMINED,
  );
  base.affectedTestFiles = selection.affected;
  if (selection.affected.length === 0) {
    const verdict = selection.capped ? 'not-proven:closure-capped' : 'not-proven:no-affected-tests';
    return record(base, verdict, controls, {
      reason: selection.capped
        ? 'the import-graph closure hit its node cap, so affected-test reachability is not trustworthy (fail closed)'
        : 'no repo test imports the branch file, directly or transitively, so there is no affected test to run (fail closed)',
    });
  }

  const sentinelPath = input.sentinelPath ?? path.join(input.postWorkspacePath, '.swarm-dead-branch-sentinel');
  const runOpts: ExecuteTestRunOptions = {
    runner,
    files: selection.affected,
    cwd: input.postWorkspacePath,
    timeoutMs: input.timeoutMs,
    ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
    ...(input.docker !== undefined ? { docker: input.docker } : {}),
  };

  // Instrument the branch file; always restore it in the finally below.
  const instrumented = instrumentSource(original, resolved, sentinelPath);
  try {
    fs.writeFileSync(absFile, instrumented);
  } catch (err) {
    return record(base, 'not-proven:instrumentation-failed', controls, {
      reason: `could not write the instrumented branch file: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  let result: DeadBranchProofRecord;
  try {
    result = runInstrumented(input, runOpts, base, controls, resolved, sentinelPath, selection.affected, runner);
  } finally {
    try {
      fs.writeFileSync(absFile, original);
    } catch (err) {
      log.error(
        `dead-branch-restoration: could not restore ${absFile}, the post workspace is corrupted (harness bug): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      fs.rmSync(sentinelPath, { force: true });
    } catch {
      // best-effort cleanup; a stale sentinel never makes a later run prove
      // falsely because each run truncates it first.
    }
  }
  return result;
}

/** Run the instrumented suite twice and classify. The sentinel is truncated
 *  before each run so a stale marker never leaks across runs. */
function runInstrumented(
  input: DeadBranchRestorationInput,
  runOpts: ExecuteTestRunOptions,
  base: { findingFile: string; branchCondition: string; branchLine: number; affectedTestFiles: string[] },
  controls: DeadBranchControls,
  resolved: ResolvedDeadBranch,
  sentinelPath: string,
  affectedTests: string[],
  runner: TestRunner,
): DeadBranchProofRecord {
  const runOnce = (): { run: ReturnType<typeof executeTestRun>; markers: string } => {
    try {
      fs.writeFileSync(sentinelPath, '');
    } catch {
      // if we cannot reset the sentinel, the read below sees whatever is there;
      // the control/branch logic is still fail-closed.
    }
    const run = executeTestRun(runOpts);
    let markers: string;
    try {
      markers = fs.readFileSync(sentinelPath, 'utf8');
    } catch {
      markers = '';
    }
    return { run, markers };
  };

  // Control 2: the affected tests must pass with the PR applied and instrumented.
  const submitted = runOnce();
  if (submitted.run.timedOut || submitted.run.spawnFailed) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `instrumented submitted-suite run did not complete: ${submitted.run.rawOutput.slice(0, 200)}`,
    });
  }
  controls.suitePassesAsSubmitted = submitted.run.passed;
  if (!submitted.run.passed) {
    return record(base, 'not-proven:suite-already-failing', controls, {
      reason:
        'the affected tests do not pass as submitted with the probes injected, so the run is not a clean baseline',
    });
  }

  const second = runOnce();
  if (second.run.timedOut || second.run.spawnFailed) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `the second instrumented run did not complete: ${second.run.rawOutput.slice(0, 200)}`,
    });
  }

  const classified = classifyDeadBranchRestoration({
    suitePassesAsSubmitted: true,
    run1: readSentinel(submitted.markers),
    run2: readSentinel(second.markers),
  });
  controls.branchNeverExecuted = classified.verdict === 'proven';

  if (classified.verdict === 'refuted') {
    return record(base, 'refuted', controls, {
      reason: `the inserted branch executed under the affected tests, so it is live, not dead`,
    });
  }
  if (classified.verdict === 'not-proven:control-not-reached') {
    return record(base, 'not-proven:control-not-reached', controls, {
      reason:
        'the positive control before the `if` never fired, so the affected tests never evaluated the branch condition; a silent branch is not a proof (fail closed)',
    });
  }
  if (classified.verdict !== 'proven') {
    return record(base, classified.verdict, controls, { reason: classified.verdict });
  }

  let reproduceCommand: string;
  try {
    reproduceCommand = buildDeadBranchReproduceCommand({
      prRef: input.prRef,
      prHeadSha: input.prHeadSha,
      testFiles: affectedTests,
      testRunner: runner,
      branchFile: input.finding.file,
      branchLine: resolved.ifLine,
      branchCondition: resolved.condition,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`dead-branch-restoration: proven proof cannot render its reproduce command: ${message}`);
    return record(base, 'not-proven:execution-error', controls, {
      reason: `proven dead-branch proof could not render its reproduce command: ${message}`,
    });
  }
  return record(base, 'proven', controls, { reproduceCommand });
}

const SAFE_HEAD_SHA = /^[0-9a-f]{7,40}$/;
const SAFE_PR_REF = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+$/;
const SAFE_PATH = /^[A-Za-z0-9._/@-]+$/;

const COVERAGE_COMMAND: Record<TestRunner, string | null> = {
  vitest: 'npx vitest run --coverage',
  jest: 'npx jest --coverage',
  mocha: 'npx c8 mocha',
  ava: null,
  'node-test': null,
};

/**
 * Pure: a self-contained command that fetches the PR head and runs the affected
 * tests under coverage, so a reader can confirm the inserted branch line is never
 * covered while the suite passes. Throws (fail closed) on any unsafe interpolation
 * or a runner with no locked coverage invocation.
 */
export function buildDeadBranchReproduceCommand(opts: {
  prRef: string;
  prHeadSha: string;
  testFiles: string[];
  testRunner: TestRunner;
  branchFile: string;
  branchLine: number;
  branchCondition: string;
}): string {
  if (!SAFE_HEAD_SHA.test(opts.prHeadSha)) {
    throw new SwarmError(
      `PR head sha '${opts.prHeadSha}' is not a 7-40 character lowercase hex string`,
      'DEAD_BRANCH_UNSAFE_HEAD_SHA',
      { remediation: 'Pass the full lowercase commit sha of the PR head as reported by git.' },
    );
  }
  if (/#\d+$/.test(opts.prRef) && !SAFE_PR_REF.test(opts.prRef)) {
    throw new SwarmError(
      `PR ref '${opts.prRef}' does not match the owner/repo#N shape`,
      'DEAD_BRANCH_UNSAFE_PR_REF',
      { remediation: 'Pass the PR ref as owner/repo#N with conservative repository characters.' },
    );
  }
  const coverage = COVERAGE_COMMAND[opts.testRunner];
  if (coverage === null) {
    throw new SwarmError(
      `runner '${opts.testRunner}' has no locked coverage invocation`,
      'DEAD_BRANCH_UNSUPPORTED_RUNNER',
      { remediation: 'Run the affected tests under your own coverage tool and inspect the branch line.' },
    );
  }
  for (const f of [opts.branchFile, ...opts.testFiles]) {
    if (!SAFE_PATH.test(f) || f.startsWith('/') || f.split('/').includes('..')) {
      throw new SwarmError(
        `path '${f}' is not safe to publish in a reproduce command`,
        'DEAD_BRANCH_UNSAFE_PATH',
        { remediation: 'Run the affected tests under coverage in the restored checkout manually.' },
      );
    }
  }
  const prNumber = /#(\d+)$/.exec(opts.prRef)?.[1];
  const fetch =
    prNumber !== undefined
      ? `git fetch origin pull/${prNumber}/head`
      : `git fetch origin ${opts.prHeadSha}`;
  const files = opts.testFiles.length > 0 ? opts.testFiles.join(' ') : '.';
  return (
    `${fetch} && git checkout ${opts.prHeadSha} && ${coverage} ${files} ` +
    `# then confirm ${opts.branchFile}:${opts.branchLine} (the inserted 'if (${opts.branchCondition})' branch body) is reported uncovered`
  );
}
