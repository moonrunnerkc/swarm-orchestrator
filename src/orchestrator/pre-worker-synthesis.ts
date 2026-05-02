import * as fs from 'fs';
import * as path from 'path';
import { synthesizeRegressionTest } from '../verification/test-synthesizer';
import type { TestSynthesisAttempt, TestSynthesisInput, TestSynthesisResult } from '../verification/test-synthesizer-types';

/** Injectable synthesizer function; defaults to the real synthesizer. Used in tests. */
export type SynthesizerFn = (input: TestSynthesisInput) => Promise<TestSynthesisResult>;

/** Outcome when synthesis produced a valid failing test. */
export interface PreWorkerSynthesisSuccess {
  status: 'success';
  testCommand: string;
  testFilePath: string;
}

/** Outcome when synthesis exhausted retries without ever getting the model to produce output. */
export interface PreWorkerSynthesisGenerationFailed {
  status: 'GENERATION_FAILED';
  reason: string;
  attempts: TestSynthesisAttempt[];
}

/** Outcome when all model attempts produced a test that passes against base — goal too vague to produce a failing test. */
export interface PreWorkerSynthesisAmbiguousGoal {
  status: 'AMBIGUOUS_GOAL';
  reason: string;
  attempts: TestSynthesisAttempt[];
}

export type PreWorkerSynthesisResult =
  | PreWorkerSynthesisSuccess
  | PreWorkerSynthesisGenerationFailed
  | PreWorkerSynthesisAmbiguousGoal;

export interface PreWorkerSynthesisInput {
  goal: string;
  repoPath: string;
  /** Absolute path to the run's artifact directory (e.g. `runs/<id>`). */
  runDir: string;
  /** Optional per-attempt timeout, milliseconds. Defaults to synthesizer default (10 min). */
  timeoutMs?: number;
  /**
   * Override synthesizer for testing. Defaults to the real `synthesizeRegressionTest`.
   * Do not set in production callers.
   */
  _synthesize?: SynthesizerFn;
}

/**
 * Run pre-worker test synthesis.
 *
 * Calls the test synthesizer with the run goal and repo state (before any
 * worker has touched the repo). On success, copies the accepted test file
 * into the run's evidence directory so it survives worktree cleanup, and
 * returns the command that the end-of-run battery will use for Layer 1.
 *
 * On failure the result carries the synthesizer's structured failure status
 * and the caller must halt before dispatching any workers.
 *
 * @param input - Goal text, repo path, run artifact directory, and optional timeout.
 * @returns Structured synthesis result; caller checks `status === 'success'` before proceeding.
 */
export async function runPreWorkerSynthesis(
  input: PreWorkerSynthesisInput,
): Promise<PreWorkerSynthesisResult> {
  const synthesize = input._synthesize ?? synthesizeRegressionTest;
  const synthResult = await synthesize({
    goalText: input.goal,
    targetRepoPath: input.repoPath,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });

  if (synthResult.status !== 'GENERATED') {
    return {
      status: synthResult.status,
      reason: synthResult.reason ?? 'test synthesizer did not produce a result',
      attempts: synthResult.attempts,
    };
  }

  const testFilePath = synthResult.testFilePath!;
  const testCommand = synthResult.testCommand!;

  // Preserve the accepted test file in the run evidence directory so it
  // survives worktree cleanup and is available for attestation artifacts.
  const verificationDir = path.join(input.runDir, 'verification');
  fs.mkdirSync(verificationDir, { recursive: true });
  const ext = path.extname(testFilePath) || '.txt';
  const evidenceCopy = path.join(verificationDir, `synthesized-intent-test${ext}`);
  try {
    fs.copyFileSync(testFilePath, evidenceCopy);
  } catch {
    // Non-fatal: the original file is still at testFilePath; evidence copy
    // is best-effort so a read-only filesystem does not abort the run.
  }

  return {
    status: 'success',
    testCommand,
    testFilePath,
  };
}
