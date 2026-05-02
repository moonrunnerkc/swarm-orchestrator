import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter';
import { runVerificationCommand } from './command-runner';
import {
  detectTestFramework,
  getFrameworkProfile,
} from './test-framework-detection';
import {
  buildFeedback,
  buildPrompt,
  parseCandidate,
  writeCandidate,
} from './test-synthesizer-io';
import type {
  SynthesizedTestCandidate,
  TestSynthesisAttempt,
  TestSynthesisInput,
  TestSynthesisResult,
} from './test-synthesizer-types';

export type {
  SynthesizedTestCandidate,
  TestSynthesisAttempt,
  TestSynthesisInput,
  TestSynthesisResult,
  TestSynthesisStatus,
} from './test-synthesizer-types';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Default per-attempt budget for the synthesizer. Aligned with
 * `claude-code-adapter.ts`'s STALL_TIMEOUT_MS so a hard prompt that
 * keeps the LLM thinking for several minutes is not cut short by a
 * shorter default in this layer. Tests that need a snappier ceiling
 * pass an explicit `timeoutMs` (the existing fixture tests use 30_000).
 */
export const DEFAULT_TIMEOUT_MS = 600_000;

function wrapWithVenv(command: string, venvBin: string | undefined, cwd: string): string {
  // Mirror `scripts/eval/eval-utils.ts:wrapCommandWithVenv` — see round-7
  // notes there. The synthesizer's internal preflight + base run benefit
  // from the same PYTHONPATH treatment so import resolution matches what
  // the eval driver's later runs will see, and so a Django-style
  // `python tests/runtests.py` here resolves `import django` to the
  // persistent worktree (base state) explicitly rather than relying on
  // the venv .pth.
  const exports: string[] = [`export PYTHONPATH=${cwd}:$PYTHONPATH`];
  if (venvBin) exports.push(`export PATH=${venvBin}:$PATH`);
  return `${exports.join('; ')}; ${command}`;
}

// validateSynthesizedTestCandidate was removed in 39c6f5b's follow-up.
// The previous structural preflight matched only JS assertion patterns
// (node `assert.X`, jest/chai `expect(`, should.js); Python `unittest`
// idioms (`self.assertRegex`, etc.) failed the check and every Python
// candidate was rejected before it ever ran. The authoritative gate is
// downstream — does the test fail against base and pass against the
// fix — and the test runner reports that exit code directly. Keeping
// a hand-rolled assertion-pattern allowlist would have re-created the
// Python-non-functional failure mode for the next language to land
// (pytest's bare `assert`, hamcrest, doctest, …).
//
// Round-7 (v7-critical-path session 2.5) reintroduces a structural
// preflight, but in framework-aware form: `pytest --collect-only` for
// pytest-shaped frameworks only, with the same PATH-wrap the base-run
// uses. The earlier failure mode (rejecting Python candidates by
// pattern-matching) does not recur because pytest's collector is the
// authority on whether the candidate is structurally valid Python; we
// no longer hand-roll the check.

/**
 * Generate a user-goal regression test and prove it fails against the base repo.
 *
 * Per-attempt control flow:
 *
 *   1. Detect the test framework from the repo on disk (e.g. `django-runtests`,
 *      `pytest-standard`) and inject framework-specific guidance into the
 *      LLM prompt.
 *   2. Spawn the adapter; on non-zero exit, feed `adapter-error` back to
 *      the next attempt and continue.
 *   3. Parse the candidate JSON; on parse failure, feed `json-parse-error`.
 *   4. Write the candidate to disk under the framework's placement rule
 *      (Django preserves directory structure; everything else flattens to
 *      the repo root). Substitute `{{TEST_FILE}}` and sanitize hardcoded
 *      `.venv/bin/<exe>` references.
 *   5. If the framework supports a pytest preflight, run
 *      `pytest --collect-only <relativePath>` (PATH-wrapped); on non-zero
 *      exit, feed `collection-error` and continue.
 *   6. Run the candidate's testCommand against the base repo (PATH-wrapped);
 *      non-zero exit → accept the candidate (it catches a real bug),
 *      zero exit → feed `passes-against-base` and continue.
 *
 * @param input - Goal, repo path, adapter, retry settings, optional venvBin
 *                for PATH-wrapping, and optional framework override.
 * @returns Synthesized test path and command, or an ambiguous/failed status.
 */
export async function synthesizeRegressionTest(
  input: TestSynthesisInput,
): Promise<TestSynthesisResult> {
  const adapter = input.adapter ?? new ClaudeCodeAdapter();
  const maxAttempts = input.maxAttempts ?? 3;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const profile = input.framework
    ? getFrameworkProfile(input.framework)
    : detectTestFramework(input.targetRepoPath);
  const venvBin = input.venvBin;
  const instanceLogContext = `framework=${profile.framework} repo=${path.basename(input.targetRepoPath)}`;
  const attempts: TestSynthesisAttempt[] = [];
  let feedback: string | undefined;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const adapterResult = await adapter.spawn({
      prompt: buildPrompt(input, feedback, profile),
      workdir: input.targetRepoPath,
      model: input.model ?? DEFAULT_MODEL,
      timeout: timeoutMs,
    });

    if (adapterResult.exitCode !== 0) {
      feedback = buildFeedback('adapter-error', adapterResult.stderr || 'adapter exited non-zero');
      attempts.push({
        attemptNumber,
        adapterExitCode: adapterResult.exitCode,
        validation: 'rejected',
        rejectionReason: feedback,
      });
      continue;
    }

    let candidate: SynthesizedTestCandidate;
    try {
      candidate = parseCandidate(adapterResult.stdout);
    } catch (err) {
      feedback = buildFeedback(
        'json-parse-error',
        err instanceof Error ? err.message : String(err),
      );
      attempts.push({
        attemptNumber,
        adapterExitCode: adapterResult.exitCode,
        validation: 'rejected',
        rejectionReason: feedback,
      });
      continue;
    }

    const written = writeCandidate(
      input.targetRepoPath,
      candidate,
      attemptNumber,
      profile,
      instanceLogContext,
    );

    // Structural preflight: pytest --collect-only catches import errors,
    // missing fixtures, top-level raises, and indentation mistakes before
    // the base run. Without it, a syntactically broken candidate exits
    // non-zero against base for the wrong reason and the synthesizer
    // accepts it as "test fails — must catch a real bug." Mode 3 on
    // sphinx-doc__sphinx-9281 in v7-critical-path session 2's sweep.
    // Wrap with the same PATH the base run uses so the preflight cannot
    // pass under one Python and the base run fail under another.
    // Gated on a `.py` extension so JS / TS candidates (the legacy non-
    // SWE-bench shape) skip the preflight entirely; pytest cannot collect
    // a `.js` file and would always reject.
    const isPythonCandidate = /\.(py|pyx)$/i.test(written.relativePath);
    if (profile.pytestCollectPreflight && isPythonCandidate) {
      // Use `python3` rather than bare `python` so the preflight resolves on
      // bare Linux (Ubuntu and friends ship only `python3`) as well as
      // inside a venv (which symlinks both `python` and `python3`). The
      // base-run will execute whatever the LLM emits — if that is
      // `python ...`, the eval-driver's PATH-wrap into the venv handles
      // it; the preflight is structural only and should run on any host.
      const preflightCmd = wrapWithVenv(
        `python3 -m pytest --collect-only ${written.relativePath}`,
        venvBin,
        input.targetRepoPath,
      );
      const preflight = await runVerificationCommand(
        preflightCmd,
        input.targetRepoPath,
        timeoutMs,
      );
      if (preflight.exitCode !== 0) {
        const detail = (preflight.stderr || preflight.stdout || '').trim();
        feedback = buildFeedback('collection-error', detail);
        attempts.push({
          attemptNumber,
          adapterExitCode: adapterResult.exitCode,
          validation: 'rejected',
          rejectionReason: feedback,
          candidate,
          commandResult: preflight,
        });
        try { fs.unlinkSync(written.absolutePath); } catch { /* best-effort */ }
        continue;
      }
    }

    const baseCommand = wrapWithVenv(written.command, venvBin, input.targetRepoPath);
    const commandResult = await runVerificationCommand(
      baseCommand,
      input.targetRepoPath,
      timeoutMs,
    );
    if (commandResult.exitCode !== 0) {
      const accepted: SynthesizedTestCandidate = {
        ...candidate,
        testFilePath: written.absolutePath,
        testCommand: written.command,
      };
      attempts.push({
        attemptNumber,
        adapterExitCode: adapterResult.exitCode,
        validation: 'accepted',
        candidate: accepted,
        commandResult,
      });
      return {
        status: 'GENERATED',
        reason: 'generated test fails against the base codebase',
        attempts,
        testFilePath: written.absolutePath,
        testCommand: written.command,
      };
    }

    feedback = buildFeedback(
      'passes-against-base',
      (commandResult.stdout || commandResult.stderr || '').trim(),
    );
    attempts.push({
      attemptNumber,
      adapterExitCode: adapterResult.exitCode,
      validation: 'rejected',
      rejectionReason: feedback,
      candidate,
      commandResult,
    });
    // The rejected candidate file lives in the persistent worktree and
    // would otherwise leak into `capture_agent_diff` downstream. Best-
    // effort cleanup; the next attempt writes its own file with a
    // different attemptNumber.
    try { fs.unlinkSync(written.absolutePath); } catch { /* file already gone or unwritable */ }
  }

  return {
    status: attempts.some(attempt => attempt.adapterExitCode === 0) ? 'AMBIGUOUS_GOAL' : 'GENERATION_FAILED',
    reason: feedback ?? 'test synthesizer could not produce a failing regression test',
    attempts,
  };
}
