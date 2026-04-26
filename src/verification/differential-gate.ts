import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runVerificationCommand, VerificationCommandResult } from './command-runner';

export type DifferentialGateStatus = 'PASS' | 'FAIL' | 'INVALID_TEST';

export interface DifferentialGateInput {
  repoPath: string;
  testCommand: string;
  baseCommit: string;
  agentBranch: string;
  timeoutMs?: number;
  worktreeRoot?: string;
}

export interface DifferentialGateResult {
  status: DifferentialGateStatus;
  reason: string;
  base?: VerificationCommandResult;
  patch?: VerificationCommandResult;
  durationMs: number;
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

function setupFailure(started: number, reason: string): DifferentialGateResult {
  return {
    status: 'FAIL',
    reason,
    durationMs: Date.now() - started,
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

    base = await runVerificationCommand(input.testCommand, baseWorktree, timeoutMs);
    if (base.exitCode === 0) {
      return {
        status: 'INVALID_TEST',
        reason: 'test command passed against the base commit',
        base,
        durationMs: Date.now() - started,
      };
    }

    addDetachedWorktree(repoPath, patchWorktree, input.agentBranch);
    patch = await runVerificationCommand(input.testCommand, patchWorktree, timeoutMs);

    if (patch.exitCode === 0) {
      return {
        status: 'PASS',
        reason: 'test failed at base and passed at patch',
        base,
        patch,
        durationMs: Date.now() - started,
      };
    }

    return {
      status: 'FAIL',
      reason: 'test command failed against the patch',
      base,
      patch,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'FAIL',
      reason: `differential gate execution failed: ${message}`,
      ...(base ? { base } : {}),
      ...(patch ? { patch } : {}),
      durationMs: Date.now() - started,
    };
  } finally {
    if (fs.existsSync(baseWorktree)) removeWorktree(repoPath, baseWorktree);
    if (fs.existsSync(patchWorktree)) removeWorktree(repoPath, patchWorktree);
    if (!input.worktreeRoot) fs.rmSync(root, { recursive: true, force: true });
  }
}
