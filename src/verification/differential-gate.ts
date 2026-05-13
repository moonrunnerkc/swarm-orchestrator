import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runVerificationCommand, VerificationCommandResult } from './command-runner';
import { createFinding, type Finding } from '../types/finding';
import { extractSourceLocations } from './source-locations';

export type DifferentialGateStatus = 'PASS' | 'FAIL' | 'INVALID_TEST';

/**
 * A file to overlay onto both the base and patch worktrees after they
 * are created. The synthesized intent test is the canonical case: it
 * lives in the orchestrator's scratch directory rather than in either
 * commit's history, so without overlay it is missing from the detached
 * worktrees the gate creates and the test command exits non-zero
 * because the file does not exist — masquerading as a failed regression
 * test when the real problem is a misconfigured input.
 *
 * Source paths must be absolute; destination paths are repo-relative.
 * Parent directories are created as needed when the file is copied.
 */
export interface OverlayFile {
  /** Absolute path on the host filesystem (e.g. orchestrator scratch dir). */
  absoluteSource: string;
  /** Repo-relative path inside the worktree (e.g. `test/regression.test.ts`). */
  relativeDestination: string;
}

export interface DifferentialGateInput {
  repoPath: string;
  testCommand: string;
  baseCommit: string;
  agentBranch: string;
  timeoutMs?: number;
  worktreeRoot?: string;
  /**
   * Files to copy into both base and patch worktrees after creation and
   * before running the test command. Required when the test command
   * references a file that lives outside the commit history (e.g. the
   * pre-worker-synthesized regression test, which the orchestrator
   * writes to the run's scratch space rather than committing to either
   * branch). Without the overlay, the test file is absent from the
   * detached worktrees and the command fails because the file is
   * missing rather than because the regression failed to catch the bug.
   */
  overlayFiles?: readonly OverlayFile[];
}

export interface DifferentialGateResult {
  status: DifferentialGateStatus;
  reason: string;
  base?: VerificationCommandResult;
  patch?: VerificationCommandResult;
  durationMs: number;
  findings: Finding[];
}

function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();
}

function addDetachedWorktree(repoPath: string, worktreePath: string, ref: string): void {
  execFileSync('git', ['worktree', 'add', '--detach', worktreePath, ref], {
    cwd: repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

function removeWorktree(repoPath: string, worktreePath: string): void {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  try {
    execFileSync('git', ['worktree', 'prune'], {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // Cleanup is best-effort after the target worktree is already gone.
  }
}

function summaryFinding(ruleId: string, reason: string): Finding {
  return createFinding({
    scope: 'summary',
    producerId: 'differential-gate',
    ruleId,
    severity: 'high',
    message: reason.length <= 200 ? reason : `${reason.slice(0, 197)}...`,
  });
}

function commandFinding(
  ruleId: string,
  result: VerificationCommandResult,
  worktreePath: string,
  fallbackMessage: string,
): Finding {
  const output = `${result.stdout}\n${result.stderr}`;
  const location = extractSourceLocations(output, worktreePath)[0];
  if (location) {
    return createFinding({
      scope: 'line',
      producerId: 'differential-gate',
      ruleId,
      severity: 'high',
      filePath: location.filePath,
      line: location.line,
      message: fallbackMessage,
    });
  }
  return summaryFinding(ruleId, fallbackMessage);
}

/**
 * Copy each overlay file into the freshly-created worktree. Missing
 * source files are skipped silently — the gate should still report the
 * downstream "test command exits non-zero because the file isn't there"
 * result rather than throwing in setup. Parent directories of the
 * destination are created as needed.
 *
 * Confined to paths inside the worktree: any destination that escapes
 * via `..` or absolute prefix is skipped. The orchestrator's caller
 * is trusted (this is not a user-facing API) but the guard is cheap
 * and keeps a malformed input from writing outside the worktree.
 */
function applyOverlayFiles(
  worktreePath: string,
  files: readonly OverlayFile[] | undefined,
): void {
  if (!files || files.length === 0) return;
  for (const file of files) {
    if (
      file.relativeDestination.startsWith('/') ||
      path.normalize(file.relativeDestination).startsWith('..')
    ) {
      continue;
    }
    if (!fs.existsSync(file.absoluteSource)) continue;
    const dest = path.join(worktreePath, file.relativeDestination);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file.absoluteSource, dest);
  }
}

function setupFailure(started: number, reason: string): DifferentialGateResult {
  return {
    status: 'FAIL',
    reason,
    durationMs: Date.now() - started,
    findings: [summaryFinding('differential-setup-failed', reason)],
  };
}

/**
 * Run a differential intent gate for one synthesized or SWE-bench test.
 *
 * The gate runs the same command against a detached worktree at `baseCommit`
 * and a detached worktree at `agentBranch`. The test must fail at the base
 * and pass at the patch. If it passes at the base, the test is invalid because
 * it does not prove the stated bug or feature.
 *
 * @param input - Repository path, test command, base commit, and patch branch.
 * @returns Structured base/patch command evidence and gate status.
 */
export async function runDifferentialGate(
  input: DifferentialGateInput,
): Promise<DifferentialGateResult> {
  const started = Date.now();
  const repoPath = path.resolve(input.repoPath);
  const timeoutMs = input.timeoutMs ?? 120_000;
  const root = input.worktreeRoot
    ? path.resolve(input.worktreeRoot)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-diff-gate-'));
  const baseWorktree = path.join(root, 'base');
  const patchWorktree = path.join(root, 'patch');

  if (!input.testCommand.trim()) {
    return setupFailure(started, 'differential gate requires a non-empty test command');
  }

  try {
    git(repoPath, ['rev-parse', '--is-inside-work-tree']);
    git(repoPath, ['rev-parse', '--verify', input.baseCommit]);
    git(repoPath, ['rev-parse', '--verify', input.agentBranch]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return setupFailure(started, `differential gate git setup failed: ${message}`);
  }

  let base: VerificationCommandResult | undefined;
  let patch: VerificationCommandResult | undefined;

  try {
    fs.mkdirSync(root, { recursive: true });
    addDetachedWorktree(repoPath, baseWorktree, input.baseCommit);
    applyOverlayFiles(baseWorktree, input.overlayFiles);

    base = await runVerificationCommand(input.testCommand, baseWorktree, timeoutMs);
    if (base.exitCode === 0) {
      return {
        status: 'INVALID_TEST',
        reason: 'test command passed against the base commit',
        base,
        durationMs: Date.now() - started,
        findings: [commandFinding(
          'invalid-regression-test',
          base,
          baseWorktree,
          'Regression test already passes at the base commit.',
        )],
      };
    }

    addDetachedWorktree(repoPath, patchWorktree, input.agentBranch);
    applyOverlayFiles(patchWorktree, input.overlayFiles);
    patch = await runVerificationCommand(input.testCommand, patchWorktree, timeoutMs);

    if (patch.exitCode === 0) {
      return {
        status: 'PASS',
        reason: 'test failed at base and passed at patch',
        base,
        patch,
        durationMs: Date.now() - started,
        findings: [],
      };
    }

    return {
      status: 'FAIL',
      reason: 'test command failed against the patch',
      base,
      patch,
      durationMs: Date.now() - started,
      findings: [commandFinding(
        'patch-regression-test-failed',
        patch,
        patchWorktree,
        'Regression test still fails against the patch.',
      )],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'FAIL',
      reason: `differential gate execution failed: ${message}`,
      ...(base ? { base } : {}),
      ...(patch ? { patch } : {}),
      durationMs: Date.now() - started,
      findings: [summaryFinding('differential-execution-failed', 'Differential gate execution failed.')],
    };
  } finally {
    if (fs.existsSync(baseWorktree)) removeWorktree(repoPath, baseWorktree);
    if (fs.existsSync(patchWorktree)) removeWorktree(repoPath, patchWorktree);
    if (!input.worktreeRoot) fs.rmSync(root, { recursive: true, force: true });
  }
}
