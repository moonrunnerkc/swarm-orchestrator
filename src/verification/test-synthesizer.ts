import * as fs from 'fs';
import * as path from 'path';
import { AgentAdapter } from '../adapters/agent-adapter';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter';
import { runVerificationCommand, VerificationCommandResult } from './command-runner';

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
}

export interface TestSynthesisResult {
  status: TestSynthesisStatus;
  reason: string;
  attempts: TestSynthesisAttempt[];
  testFilePath?: string;
  testCommand?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Default per-attempt budget for the synthesizer. Aligned with
 * `claude-code-adapter.ts`'s STALL_TIMEOUT_MS so a hard prompt that
 * keeps the LLM thinking for several minutes is not cut short by a
 * shorter default in this layer. Tests that need a snappier ceiling
 * pass an explicit `timeoutMs` (the existing fixture tests use 30_000).
 */
export const DEFAULT_TIMEOUT_MS = 600_000;

// Candidates are written at repo root (not a subdirectory) so the test's
// computed __file__/dirname resolves to the worktree root. The prior
// `.swarm/synthesized-tests/` location pushed __file__ one directory deep,
// which broke any candidate whose import logic computed paths from
// __file__ (e.g. `<dirname>/requests/auth.py`) — those paths missed the
// local source and fell through to the host-installed package, producing
// false-pass-against-base on instances whose target package was already
// installed system-wide. See docs/p1-real-data-findings.md.
const SYNTH_TEST_PREFIX = 'swarm-synth-attempt';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const raw = fenced?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!raw || raw.trim() === '') {
    throw new Error('adapter output did not contain a JSON object');
  }
  return JSON.parse(raw);
}

function parseCandidate(stdout: string): SynthesizedTestCandidate {
  const parsed = extractJsonObject(stdout);
  if (!isRecord(parsed)) {
    throw new Error('candidate JSON must be an object');
  }

  const testFilePath = parsed.testFilePath;
  const testCommand = parsed.testCommand;
  const testSource = parsed.testSource;

  if (typeof testCommand !== 'string' || testCommand.trim() === '') {
    throw new Error('candidate JSON must include non-empty testCommand');
  }
  if (typeof testSource !== 'string' || testSource.trim() === '') {
    throw new Error('candidate JSON must include non-empty testSource');
  }

  return {
    testFilePath: typeof testFilePath === 'string' && testFilePath.trim() !== ''
      ? testFilePath
      : 'synthesized-regression.test.js',
    testCommand,
    testSource,
  };
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
// (pytest's bare `assert`, hamcrest, doctest, …). See
// docs/p1-real-data-findings.md for the discovery sequence.

function safeOutputPath(repoPath: string, candidatePath: string, attemptNumber: number): string {
  const safeName = path.basename(candidatePath).replace(/[^a-zA-Z0-9._-]/g, '-')
    || 'synthesized-regression.test.js';
  return path.join(repoPath, `${SYNTH_TEST_PREFIX}-${attemptNumber}-${safeName}`);
}

function writeCandidate(repoPath: string, candidate: SynthesizedTestCandidate, attemptNumber: number): {
  absolutePath: string;
  relativePath: string;
  command: string;
} {
  const absolutePath = safeOutputPath(repoPath, candidate.testFilePath, attemptNumber);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, candidate.testSource, 'utf8');
  const relativePath = path.relative(repoPath, absolutePath);
  const command = candidate.testCommand.includes('{{TEST_FILE}}')
    ? candidate.testCommand.replace(/\{\{TEST_FILE\}\}/g, relativePath)
    : candidate.testCommand.replace(candidate.testFilePath, relativePath);
  return { absolutePath, relativePath, command };
}

function readRelevantFiles(repoPath: string, relevantFiles: string[] | undefined): string {
  if (!relevantFiles || relevantFiles.length === 0) return 'No relevant files were supplied.';
  const sections: string[] = [];
  for (const rel of relevantFiles.slice(0, 8)) {
    if (rel.startsWith('/') || path.normalize(rel).startsWith('..')) continue;
    const full = path.join(repoPath, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const body = fs.readFileSync(full, 'utf8').slice(0, 4_000);
    sections.push(`FILE: ${rel}\n\`\`\`\n${body}\n\`\`\``);
  }
  return sections.length > 0 ? sections.join('\n\n') : 'No readable relevant files were found.';
}

function buildPrompt(input: TestSynthesisInput, feedback: string | undefined): string {
  return `Generate one regression test for this goal:

${input.goalText}

Relevant source context:
${readRelevantFiles(input.targetRepoPath, input.relevantFiles)}

Return ONLY JSON with this schema:
{
  "testFilePath": "relative/path/to/regression.test.js",
  "testCommand": "command that runs only this test; use {{TEST_FILE}} for the generated file path",
  "testSource": "complete test source"
}

The test must contain clear assertions, fail against the current codebase, and pass once the goal is correctly implemented.
${feedback ? `Previous attempt feedback: ${feedback}` : ''}`;
}

/**
 * Generate a user-goal regression test and prove it fails against the base repo.
 *
 * @param input - Goal, repo path, adapter, and retry settings.
 * @returns Synthesized test path and command, or an ambiguous/failed status.
 */
export async function synthesizeRegressionTest(
  input: TestSynthesisInput,
): Promise<TestSynthesisResult> {
  const adapter = input.adapter ?? new ClaudeCodeAdapter();
  const maxAttempts = input.maxAttempts ?? 3;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts: TestSynthesisAttempt[] = [];
  let feedback: string | undefined;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const adapterResult = await adapter.spawn({
      prompt: buildPrompt(input, feedback),
      workdir: input.targetRepoPath,
      model: input.model ?? DEFAULT_MODEL,
      timeout: timeoutMs,
    });

    if (adapterResult.exitCode !== 0) {
      feedback = adapterResult.stderr || 'adapter exited non-zero';
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
      feedback = err instanceof Error ? err.message : String(err);
      attempts.push({
        attemptNumber,
        adapterExitCode: adapterResult.exitCode,
        validation: 'rejected',
        rejectionReason: feedback,
      });
      continue;
    }

    const written = writeCandidate(input.targetRepoPath, candidate, attemptNumber);
    const commandResult = await runVerificationCommand(written.command, input.targetRepoPath, timeoutMs);
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

    feedback = 'generated test passed against the base codebase; make it expose the bug or missing behavior';
    attempts.push({
      attemptNumber,
      adapterExitCode: adapterResult.exitCode,
      validation: 'rejected',
      rejectionReason: feedback,
      candidate,
      commandResult,
    });
    // The rejected candidate file lives at the repo root and would
    // otherwise leak into capture_agent_diff at the end of the
    // orchestrator's run. Best-effort cleanup; the next attempt writes
    // its own file with a different attemptNumber.
    try { fs.unlinkSync(written.absolutePath); } catch { /* file already gone or unwritable */ }
  }

  return {
    status: attempts.some(attempt => attempt.adapterExitCode === 0) ? 'AMBIGUOUS_GOAL' : 'GENERATION_FAILED',
    reason: feedback ?? 'test synthesizer could not produce a failing regression test',
    attempts,
  };
}
