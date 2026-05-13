import type { AgentAdapter } from '../adapters/agent-adapter';
import type { VerificationCommandResult } from './command-runner';
import type { TestFramework } from './test-framework-detection';

/**
 * Signature of the synthesizer's verification-command runner. Matches the
 * real {@link import('./command-runner').runVerificationCommand} so the
 * default can be swapped in tests without changing call sites. Tests inject
 * a fake here to assert synthesizer behavior (placement, sanitization,
 * rejection-feedback routing) without depending on the host having pytest
 * or any other interpreter installed.
 */
export type VerificationCommandRunner = (
  command: string,
  cwd: string,
  timeoutMs?: number,
) => Promise<VerificationCommandResult>;

/**
 * Shared type definitions for the test synthesizer's public API. Lives in
 * its own file so the run loop (`test-synthesizer.ts`) and the I/O helpers
 * (`test-synthesizer-io.ts`) can both import these types without creating
 * a cycle. No runtime values here.
 */

export type TestSynthesisStatus = 'GENERATED' | 'AMBIGUOUS_GOAL' | 'GENERATION_FAILED';

export interface SynthesizedTestCandidate {
  testFilePath: string;
  testCommand: string;
  testSource: string;
}

export interface TestSynthesisAttempt {
  attemptNumber: number;
  adapterExitCode: number;
  validation: 'accepted' | 'rejected';
  rejectionReason?: string;
  candidate?: SynthesizedTestCandidate;
  commandResult?: VerificationCommandResult;
}

export interface TestSynthesisInput {
  goalText: string;
  targetRepoPath: string;
  adapter?: AgentAdapter;
  model?: string;
  maxAttempts?: number;
  /**
   * Per-attempt budget in milliseconds: caps both the adapter spawn (the
   * underlying CLI's stall-without-output watchdog) and the candidate
   * test execution. Defaults to {@link DEFAULT_TIMEOUT_MS} (10 minutes),
   * matching `claude-code-adapter.ts`'s STALL_TIMEOUT_MS, because Claude
   * Code can spend several minutes on internal reasoning before producing
   * stdout on hard SWE-bench prompts. The earlier 2-minute default
   * silently failed the v7-critical-path multi-repo Layer 1 sweep on
   * sphinx, pylint, and one Django instance with `Process killed after
   * 120s of no output (stall timeout)` rejections.
   */
  timeoutMs?: number;
  relevantFiles?: string[];
  /**
   * Absolute path of the per-instance virtualenv's bin/ directory. When
   * supplied, every shell-out from the synthesizer (the `--collect-only`
   * preflight, the internal base-run that gates accept/reject) gets
   * wrapped with `export PATH=<venvBin>:$PATH;` so `python` and `pytest`
   * resolve to the venv. The eval driver's later base-run uses the same
   * wrap; matching the wrap up-front prevents the preflight from passing
   * under one Python and the real run failing under another (precision
   * 2 from v7 critical-path session 2.5).
   */
  venvBin?: string;
  /**
   * Override the auto-detected framework. Tests use this to assert prompt
   * shape and placement without writing a full marker filesystem; the
   * eval-driver path leaves it unset so detection runs on the real repo.
   */
  framework?: TestFramework;
  /**
   * Override the verification-command runner. Tests inject a fake to drive
   * the synthesizer's preflight + base-run state machine without requiring
   * a working `python3 -m pytest` on the host (or, for JS profiles, any
   * particular Node version). Production callers leave this undefined and
   * the real `runVerificationCommand` is used.
   *
   * Underscore prefix matches the convention used elsewhere
   * (`_synthesize` in pre-worker-synthesis) for test-only injection seams.
   */
  _runCommand?: VerificationCommandRunner;
}

export interface TestSynthesisResult {
  status: TestSynthesisStatus;
  reason: string;
  attempts: TestSynthesisAttempt[];
  testFilePath?: string;
  testCommand?: string;
}
