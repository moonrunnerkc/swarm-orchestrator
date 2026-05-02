import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AgentAdapter } from '../../src/adapters/agent-adapter';
import {
  PropertyCommandRunner,
  PropertyFinding,
  PropertyTarget,
  runPropertyGate,
  synthesizeRegressionTest,
  type TestSynthesisAttempt,
  type TestSynthesisStatus,
} from '../../src/verification';
import { parseUnifiedDiff } from '../../src/verification/diff-analysis';
import {
  CommandResult,
  appendJsonlRecord,
  defaultApplyPatch,
  defaultRunCommand,
  defaultWithWorktree,
} from './swebench-eval-helpers';
import { rewriteCommandForWorktree, wrapCommandWithVenv } from './eval-utils';

export { appendJsonlRecord };

/** Per-attempt diagnostic preserved on the JSONL record. */
export interface SynthAttemptRecord {
  attemptNumber: number;
  adapterExitCode: number;
  validation: 'accepted' | 'rejected';
  /**
   * The synthesizer's own reason for rejecting this attempt (parse error,
   * adapter non-zero exit, "test passed against base"). Present when the
   * attempt did not produce an accepted candidate.
   */
  rejectionReason?: string;
  /**
   * Generated test source for this attempt, truncated to ATTEMPT_SOURCE_TRUNCATE_BYTES.
   * Captured for both accepted and rejected attempts when the synthesizer produced
   * one, so a GENERATION_FAILED record carries the candidates that almost worked.
   * Omitted when the synthesizer failed to produce any candidate (e.g. adapter
   * exit before stdout was emitted).
   */
  testSourceTruncated?: string;
}

/** One synth-eval record per SWE-bench instance. Written one-per-line to JSONL. */
export interface SynthEvalRecord {
  instanceId: string;
  status: TestSynthesisStatus | 'ERROR';
  attempts: number;
  testFilePath?: string;
  testCommand?: string;
  testSource?: string;
  basePass: boolean | null;
  goldPass: boolean | null;
  /**
   * SHA of HEAD inside the temporary gold worktree at the moment the gold
   * test ran. Captured to make the assertion "the gold worktree was at
   * gold-patch state" auditable on every record. Cross-reference against
   * `git rev-parse swarm-gold-eval` in the persistent repo to confirm the
   * worktree resolved the gold ref correctly. Undefined when goldPatchRef
   * was not supplied or rev-parse on the worktree failed.
   */
  goldHeadSha?: string;
  fp: boolean;
  fn: boolean;
  wallClockMs: number;
  error?: string;
  /**
   * The synthesizer's terminal `reason` string. Present on every record where
   * synthesis ran (i.e. not on catch-block ERROR records). For GENERATION_FAILED
   * and AMBIGUOUS_GOAL this is the only signal explaining why no candidate
   * landed; for GENERATED it documents the success branch ("generated test
   * fails against the base codebase").
   */
  synthReason?: string;
  /**
   * Captured stdout/stderr of the base-checkout test run, truncated to
   * RUN_OUTPUT_TRUNCATE_BYTES. Populated only when status='GENERATED' and the
   * base run actually executed. Required for diagnosing goldPass=false cases
   * where a basePass=false record alone is ambiguous between "test exposed
   * the bug" and "test crashed at import-time".
   */
  baseStdout?: string;
  baseStderr?: string;
  /** Captured stdout/stderr of the gold-worktree test run. Same truncation. */
  goldStdout?: string;
  goldStderr?: string;
  /**
   * Per-attempt diagnostic for non-GENERATED outcomes (and a one-element array
   * for GENERATED, recording the accepted attempt). Each entry includes
   * rejectionReason and testSourceTruncated when available, so a
   * GENERATION_FAILED record is self-contained for failure-mode classification
   * without re-running the synthesizer.
   */
  attemptDetails?: SynthAttemptRecord[];
}

/** 8 KiB ceiling for captured stdout/stderr per run. Keeps JSONL lines bounded. */
const RUN_OUTPUT_TRUNCATE_BYTES = 8 * 1024;
/** 4 KiB ceiling for per-attempt testSource. Mirrors the synthesizer's prompt budget. */
const ATTEMPT_SOURCE_TRUNCATE_BYTES = 4 * 1024;

/**
 * Truncate a string to `maxBytes` UTF-16 code units (the JS string length unit).
 * Appends a single `\n[...truncated N bytes]` marker so a downstream reader can
 * distinguish a real-empty capture from a clipped-to-zero capture.
 */
function truncateForRecord(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) return value;
  const dropped = value.length - maxBytes;
  return `${value.slice(0, maxBytes)}\n[...truncated ${dropped} bytes]`;
}

function buildAttemptDetails(
  attempts: TestSynthesisAttempt[],
): SynthAttemptRecord[] {
  return attempts.map((attempt) => {
    const detail: SynthAttemptRecord = {
      attemptNumber: attempt.attemptNumber,
      adapterExitCode: attempt.adapterExitCode,
      validation: attempt.validation,
    };
    if (attempt.rejectionReason) {
      detail.rejectionReason = truncateForRecord(attempt.rejectionReason, ATTEMPT_SOURCE_TRUNCATE_BYTES);
    }
    const source = attempt.candidate?.testSource;
    if (source) {
      detail.testSourceTruncated = truncateForRecord(source, ATTEMPT_SOURCE_TRUNCATE_BYTES);
    }
    return detail;
  });
}

/**
 * Best-effort capture of the worktree's current HEAD SHA. Returns undefined
 * when the path isn't a git worktree or rev-parse fails for any reason
 * (e.g., test stubs that pass non-git tempdirs to withWorktreeFn). Not
 * intended to fail the run; the goldHeadSha field is observability, not a
 * gating assertion.
 */
function tryReadWorktreeHead(worktreePath: string): string | undefined {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return sha === '' ? undefined : sha;
  } catch {
    return undefined;
  }
}

/** One property-gate-eval record per SWE-bench instance. */
export interface PropertyEvalRecord {
  instanceId: string;
  status: 'PASS' | 'ADVISORY' | 'SKIP' | 'ERROR';
  modifiedFunctions: Array<Pick<PropertyTarget, 'filePath' | 'line' | 'functionName' | 'language' | 'typed' | 'advisoryOnly'>>;
  /**
   * Findings produced by running the property gate against the gold-applied
   * worktree. Includes both `property-skip-unsupported` advisories and
   * actual counterexamples. The legacy field name "counterexamples" is
   * preserved for compatibility; downstream SNR analysis should consume
   * `differentialCounterexamples` instead.
   */
  counterexamples: PropertyFinding[];
  /**
   * Findings produced by running the same gate against the BASE worktree
   * (no gold patch applied). Same shape as `counterexamples`. Used to
   * subtract pre-existing failures from the gold-side findings so the SNR
   * measurement only sees regressions introduced by the patch under test.
   */
  baseCounterexamples?: PropertyFinding[];
  /**
   * Differential findings = `counterexamples` ∖ `baseCounterexamples`,
   * matched by (filePath, functionName, ruleId). A finding here is a
   * NEW failure introduced by the patch and is the right input for the
   * v7 SNR halt-threshold computation. Empty list = no patch-introduced
   * regressions on the discovered targets.
   */
  differentialCounterexamples?: PropertyFinding[];
  wallClockMs: number;
  error?: string;
}

export interface SynthEvalInput {
  instanceId: string;
  problemStatement: string;
  repoPath: string;
  goldPatchRef?: string;
  /**
   * Absolute path of the per-instance venv's bin/ directory. When supplied,
   * the base and gold testCommand executions are wrapped so `python`,
   * `python3`, `pip`, and `pytest` resolve to that venv. Required for
   * Python SWE-bench instances whose target packages need an editable
   * install before import succeeds (astropy, sympy, scipy, etc.).
   */
  venvBin?: string;
  /** Override adapter for tests; defaults to the synthesizer's built-in Claude Code adapter. */
  adapter?: AgentAdapter;
  /** Override the synthesizer call for tests so a live Claude Code CLI isn't required. */
  synthesizeFn?: typeof synthesizeRegressionTest;
  /** Override the test-execution shell-out for tests. */
  runCommand?: (command: string, cwd: string, timeoutMs: number) => Promise<CommandResult>;
  /** Override worktree creation for tests. */
  withWorktreeFn?: <T>(repoPath: string, ref: string, fn: (worktreePath: string) => Promise<T>) => Promise<T>;
}

export interface PropertyEvalInput {
  instanceId: string;
  repoPath: string;
  goldPatchText: string;
  /**
   * Absolute path of the per-instance venv's bin/ directory. Forwarded to
   * the property gate's command runner so the harnesses generated by the
   * gate (Hypothesis on Python, fast-check on JS) execute against the
   * editable-installed package rather than failing to import.
   */
  venvBin?: string;
  /** Override the property-gate command runner for tests. */
  commandRunner?: PropertyCommandRunner;
  /** Override applyPatch for tests. */
  applyPatchFn?: (worktreePath: string, patchText: string) => void;
  /** Override worktree creation for tests. */
  withWorktreeFn?: <T>(repoPath: string, ref: string, fn: (worktreePath: string) => Promise<T>) => Promise<T>;
  /** Base commit ref to fork the property-gate worktree from. Defaults to HEAD. */
  baseCommit?: string;
}

const DEFAULT_TEST_TIMEOUT_MS = 180_000;

function lastAttemptCandidate(synthesis: Awaited<ReturnType<typeof synthesizeRegressionTest>>): string | undefined {
  for (let i = synthesis.attempts.length - 1; i >= 0; i -= 1) {
    const c = synthesis.attempts[i]?.candidate;
    if (c?.testSource) return c.testSource;
  }
  return undefined;
}

/**
 * Synthesizer hook for one SWE-bench instance.
 *
 * Generates a regression test from the problem statement, runs it against
 * the base checkout (FP if it passes), then in a fresh worktree at
 * goldPatchRef applies it and runs it (FN if it fails). All three steps
 * are replaceable via overrides for unit-testing without a live adapter.
 *
 * @param input - Instance metadata and optional test-time overrides.
 * @returns Per-instance record suitable for one JSONL line.
 */
export async function evaluateInstanceSynthesizer(input: SynthEvalInput): Promise<SynthEvalRecord> {
  const start = Date.now();
  const synthesizeFn = input.synthesizeFn ?? synthesizeRegressionTest;
  const runCommand = input.runCommand ?? defaultRunCommand;
  const withWorktreeFn = input.withWorktreeFn ?? defaultWithWorktree;

  // Held outside the try so the finally can clean up the candidate file
  // on every exit path: success, eval throw, or rethrow. Leaving the file
  // at the repo root would otherwise surface in capture_agent_diff as
  // agent-attributed work the agent never authored.
  let acceptedTestPath: string | undefined;

  try {
    const synthesis = await synthesizeFn({
      goalText: input.problemStatement,
      targetRepoPath: input.repoPath,
      ...(input.adapter ? { adapter: input.adapter } : {}),
      ...(input.venvBin ? { venvBin: input.venvBin } : {}),
    });
    acceptedTestPath = synthesis.testFilePath;

    let basePass: boolean | null = null;
    let goldPass: boolean | null = null;
    let goldHeadSha: string | undefined;
    let baseStdout: string | undefined;
    let baseStderr: string | undefined;
    let goldStdout: string | undefined;
    let goldStderr: string | undefined;

    if (
      synthesis.status === 'GENERATED' &&
      synthesis.testFilePath &&
      synthesis.testCommand
    ) {
      const baseCommand = wrapCommandWithVenv(synthesis.testCommand, input.venvBin, input.repoPath);
      const baseResult = await runCommand(baseCommand, input.repoPath, DEFAULT_TEST_TIMEOUT_MS);
      basePass = baseResult.exitCode === 0;
      baseStdout = truncateForRecord(baseResult.stdout, RUN_OUTPUT_TRUNCATE_BYTES);
      baseStderr = truncateForRecord(baseResult.stderr, RUN_OUTPUT_TRUNCATE_BYTES);

      if (input.goldPatchRef) {
        const testCommand = synthesis.testCommand;
        const testFilePath = synthesis.testFilePath;
        const venvBin = input.venvBin;
        const repoPath = input.repoPath;
        const goldRun = await withWorktreeFn(repoPath, input.goldPatchRef, async (worktreePath) => {
          // Capture the worktree's resolved HEAD before doing any work in
          // it, so even if the test crashes the record carries proof of
          // which commit the gold run actually pointed at. This is the
          // observability hook for the "gold worktree at base_commit?"
          // concern raised in p1-eval-harness-diagnostic.md section 3.
          goldHeadSha = tryReadWorktreeHead(worktreePath);
          const rel = path.relative(repoPath, testFilePath);
          if (rel.startsWith('..')) {
            return { exitCode: 1, stdout: '', stderr: 'test file path escapes repoPath; gold run skipped' };
          }
          const target = path.join(worktreePath, rel);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(testFilePath, target);
          // The synthesizer occasionally embeds an absolute `cd <repoPath>`
          // in its testCommand. Without rewriting, that cd jumps the gold
          // run back to the base repo and the test never exercises gold
          // state. Rewriting fromPath -> toPath neutralizes that whether
          // or not the cd is present.
          const rewritten = rewriteCommandForWorktree(testCommand, repoPath, worktreePath);
          const wrapped = wrapCommandWithVenv(rewritten, venvBin, worktreePath);
          return runCommand(wrapped, worktreePath, DEFAULT_TEST_TIMEOUT_MS);
        });
        goldPass = goldRun.exitCode === 0;
        goldStdout = truncateForRecord(goldRun.stdout, RUN_OUTPUT_TRUNCATE_BYTES);
        goldStderr = truncateForRecord(goldRun.stderr, RUN_OUTPUT_TRUNCATE_BYTES);
      }
    }

    const fp = basePass === true;
    const fn = synthesis.status !== 'GENERATED' || goldPass === false;

    const record: SynthEvalRecord = {
      instanceId: input.instanceId,
      status: synthesis.status,
      attempts: synthesis.attempts.length,
      basePass,
      goldPass,
      fp,
      fn,
      wallClockMs: Date.now() - start,
    };
    if (synthesis.testFilePath) record.testFilePath = synthesis.testFilePath;
    if (synthesis.testCommand) record.testCommand = synthesis.testCommand;
    const testSource = lastAttemptCandidate(synthesis);
    if (testSource) record.testSource = testSource;
    if (goldHeadSha) record.goldHeadSha = goldHeadSha;
    if (synthesis.reason) record.synthReason = synthesis.reason;
    if (baseStdout !== undefined) record.baseStdout = baseStdout;
    if (baseStderr !== undefined) record.baseStderr = baseStderr;
    if (goldStdout !== undefined) record.goldStdout = goldStdout;
    if (goldStderr !== undefined) record.goldStderr = goldStderr;
    if (synthesis.attempts.length > 0) {
      record.attemptDetails = buildAttemptDetails(synthesis.attempts);
    }
    return record;
  } catch (err) {
    return {
      instanceId: input.instanceId,
      status: 'ERROR',
      attempts: 0,
      basePass: null,
      goldPass: null,
      fp: false,
      fn: true,
      wallClockMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // The candidate file lives at the worktree root and would otherwise
    // surface in capture_agent_diff downstream. The per-attempt testSource
    // is preserved on the JSONL record, so the candidate is reconstructable
    // from results — if a future debug pass wants the file kept on disk,
    // remove this cleanup or guard it on a debug flag, do not bypass it
    // by deleting the JSONL record.
    if (acceptedTestPath) {
      try { fs.unlinkSync(acceptedTestPath); } catch { /* best-effort */ }
    }
  }
}

function changedImplementationFiles(goldPatchText: string): string[] {
  const parsed = parseUnifiedDiff(goldPatchText);
  const out: string[] = [];
  for (const file of parsed) {
    const newPath = file.newPath;
    if (!newPath || newPath === '/dev/null') continue;
    out.push(newPath);
  }
  return Array.from(new Set(out));
}

// Property-gate message templates put the function name as the first
// identifier-like token after a fixed lead phrase ("found a counterexample
// in <name>", "found a failure in <name>", "Property gate skipped <name>").
// Re-extracting from the message rather than threading a structured field
// through the Finding type avoids polluting the shared Finding shape with a
// property-gate-specific concern, since (filePath, ruleId) alone is
// insufficient — line shifts between base and gold whenever upstream hunks
// added or removed lines, so we cannot key on line.
const FUNCTION_NAME_FROM_MESSAGE = /(?:counterexample in |failure in |Property gate skipped )([A-Za-z_][\w]*)/;

function functionNameFromFinding(f: PropertyFinding): string {
  if ('message' in f) {
    const match = f.message.match(FUNCTION_NAME_FROM_MESSAGE);
    if (match) return match[1] ?? '';
  }
  return '';
}

function findingFilePath(f: PropertyFinding): string {
  if ('filePath' in f && typeof f.filePath === 'string') return f.filePath;
  return '';
}

/**
 * Stable identity for finding-matching across the base and gold runs. Line
 * numbers shift between base and gold whenever an upstream patch hunk added
 * or removed lines, so line is intentionally NOT part of the key. The
 * (filePath, functionName, ruleId) triple matches the same logical finding
 * across runs even when the function moved within the file.
 */
function findingKey(f: PropertyFinding): string {
  return `${findingFilePath(f)}::${functionNameFromFinding(f)}::${f.ruleId}`;
}

/**
 * Subtract base-run findings from gold-run findings by stable key. The
 * remaining set is the "agent-introduced regression" surface — findings
 * that the gold patch (i.e. the patch under test) caused.
 *
 * Pre-existing fragility (the dominant noise class on SWE-bench Verified)
 * appears in both runs and drops out by construction. The result is the
 * input to the v7 SNR halt-threshold computation; a finding here is what
 * the rubric calls (a) genuine bug or (b) false alarm, never (c) tooling
 * artifact (those are filtered by `property-skip-unsupported` ruleId in
 * the gate's own output).
 */
function differentialFindings(
  goldFindings: PropertyFinding[],
  baseFindings: PropertyFinding[],
): PropertyFinding[] {
  const baseKeys = new Set(baseFindings.map(findingKey));
  return goldFindings.filter((f) => !baseKeys.has(findingKey(f)));
}

/**
 * Property-gate hook for one SWE-bench instance.
 *
 * Applies the gold patch in a fresh worktree, discovers modified
 * functions, runs the property gate against them, and records any
 * counterexamples. Classification of counterexamples (real bug vs.
 * false alarm) is manual review work and is not done here.
 *
 * @param input - Instance metadata and optional test-time overrides.
 * @returns Per-instance record suitable for one JSONL line.
 */
export async function evaluateInstancePropertyGate(input: PropertyEvalInput): Promise<PropertyEvalRecord> {
  const start = Date.now();
  const withWorktreeFn = input.withWorktreeFn ?? defaultWithWorktree;
  const applyPatchFn = input.applyPatchFn ?? defaultApplyPatch;
  const baseRef = input.baseCommit ?? 'HEAD';
  const venvBin = input.venvBin;

  try {
    const changedFiles = changedImplementationFiles(input.goldPatchText);
    if (changedFiles.length === 0) {
      return {
        instanceId: input.instanceId,
        status: 'SKIP',
        modifiedFunctions: [],
        counterexamples: [],
        wallClockMs: Date.now() - start,
      };
    }

    // Wrap the property gate's runner so its harness commands inherit the
    // per-instance venv when supplied. Without this, `python -m hypothesis`
    // and `node` invocations resolve to whatever happens to be on PATH and
    // the gate either crashes on import or silently shadows the local
    // package, both of which would taint the SNR measurement.
    const baseRunner = input.commandRunner;
    const venvAwareRunner = venvBin
      ? (async (command, cwd, timeoutMs) => {
        const wrapped = wrapCommandWithVenv(command, venvBin, cwd);
        if (baseRunner) return baseRunner(wrapped, cwd, timeoutMs);
        const r = await defaultRunCommand(wrapped, cwd, timeoutMs);
        return {
          command: wrapped,
          cwd,
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
          durationMs: 0,
          timedOut: false,
        };
      }) satisfies PropertyCommandRunner
      : undefined;

    const runnerOpts = venvAwareRunner
      ? { commandRunner: venvAwareRunner }
      : (input.commandRunner ? { commandRunner: input.commandRunner } : {});

    // Base run: same baseRef, same changedFiles, NO gold patch applied.
    // Captures pre-existing fragility on functions the patch will modify.
    // Files that the gold patch ADDS won't exist in base; the gate's
    // existing fs.existsSync gate skips them silently, which is the
    // desired behavior — there is nothing in base to subtract for a
    // newly-added function.
    const baseRun = await withWorktreeFn(input.repoPath, baseRef, async (worktreePath) => {
      return runPropertyGate({
        targetRepoPath: worktreePath,
        changedFiles,
        ...runnerOpts,
      });
    });

    // Gold run: same baseRef, gold patch applied. Captures the state the
    // patch under test claims to produce.
    const goldRun = await withWorktreeFn(input.repoPath, baseRef, async (worktreePath) => {
      applyPatchFn(worktreePath, input.goldPatchText);
      return runPropertyGate({
        targetRepoPath: worktreePath,
        changedFiles,
        ...runnerOpts,
      });
    });

    const differential = differentialFindings(goldRun.findings, baseRun.findings);

    return {
      instanceId: input.instanceId,
      // Status reflects the differential, not the gold-side raw findings:
      // a clean differential means no patch-introduced regressions, even
      // if base and gold both produced the same pre-existing findings.
      status: differential.length > 0 ? 'ADVISORY' : (goldRun.targets.length > 0 ? 'PASS' : goldRun.status),
      modifiedFunctions: goldRun.targets.map(t => ({
        filePath: t.filePath,
        line: t.line,
        functionName: t.functionName,
        language: t.language,
        typed: t.typed,
        advisoryOnly: t.advisoryOnly,
      })),
      counterexamples: goldRun.findings,
      baseCounterexamples: baseRun.findings,
      differentialCounterexamples: differential,
      wallClockMs: Date.now() - start,
    };
  } catch (err) {
    return {
      instanceId: input.instanceId,
      status: 'ERROR',
      modifiedFunctions: [],
      counterexamples: [],
      wallClockMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
