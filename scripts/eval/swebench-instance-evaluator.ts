import * as fs from 'fs';
import * as path from 'path';
import { AgentAdapter } from '../../src/adapters/agent-adapter';
import {
  PropertyCommandRunner,
  PropertyFinding,
  PropertyTarget,
  runPropertyGate,
  synthesizeRegressionTest,
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

export { appendJsonlRecord };

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
  fp: boolean;
  fn: boolean;
  wallClockMs: number;
  error?: string;
}

/** One property-gate-eval record per SWE-bench instance. */
export interface PropertyEvalRecord {
  instanceId: string;
  status: 'PASS' | 'ADVISORY' | 'SKIP' | 'ERROR';
  modifiedFunctions: Array<Pick<PropertyTarget, 'filePath' | 'line' | 'functionName' | 'language' | 'typed' | 'advisoryOnly'>>;
  counterexamples: PropertyFinding[];
  wallClockMs: number;
  error?: string;
}

export interface SynthEvalInput {
  instanceId: string;
  problemStatement: string;
  repoPath: string;
  goldPatchRef?: string;
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
    });
    acceptedTestPath = synthesis.testFilePath;

    let basePass: boolean | null = null;
    let goldPass: boolean | null = null;

    if (
      synthesis.status === 'GENERATED' &&
      synthesis.testFilePath &&
      synthesis.testCommand
    ) {
      const baseResult = await runCommand(synthesis.testCommand, input.repoPath, DEFAULT_TEST_TIMEOUT_MS);
      basePass = baseResult.exitCode === 0;

      if (input.goldPatchRef) {
        const testCommand = synthesis.testCommand;
        const testFilePath = synthesis.testFilePath;
        goldPass = await withWorktreeFn(input.repoPath, input.goldPatchRef, async (worktreePath) => {
          const rel = path.relative(input.repoPath, testFilePath);
          if (rel.startsWith('..')) return false;
          const target = path.join(worktreePath, rel);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(testFilePath, target);
          const result = await runCommand(testCommand, worktreePath, DEFAULT_TEST_TIMEOUT_MS);
          return result.exitCode === 0;
        });
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

    const result = await withWorktreeFn(input.repoPath, baseRef, async (worktreePath) => {
      applyPatchFn(worktreePath, input.goldPatchText);
      return runPropertyGate({
        targetRepoPath: worktreePath,
        changedFiles,
        ...(input.commandRunner ? { commandRunner: input.commandRunner } : {}),
      });
    });

    return {
      instanceId: input.instanceId,
      status: result.status,
      modifiedFunctions: result.targets.map(t => ({
        filePath: t.filePath,
        line: t.line,
        functionName: t.functionName,
        language: t.language,
        typed: t.typed,
        advisoryOnly: t.advisoryOnly,
      })),
      counterexamples: result.findings,
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
