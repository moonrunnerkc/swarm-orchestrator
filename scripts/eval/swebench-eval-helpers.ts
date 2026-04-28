import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Override-able shape of the test-execution shell-out used by the synth hook. */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a shell command synchronously via bash and capture stdout/stderr/exit.
 *
 * @param command - Shell command to execute.
 * @param cwd - Working directory.
 * @param timeoutMs - Hard timeout before SIGTERM.
 * @returns Captured exit code and output.
 */
export function defaultRunCommand(command: string, cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const result = spawnSync('bash', ['-lc', command], {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    resolve({
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    });
  });
}

/**
 * Create a detached git worktree at the given ref and pass its path to fn.
 * The worktree is unconditionally cleaned up on exit, even if fn throws.
 *
 * @param repoPath - Source repository.
 * @param ref - Git ref the worktree should check out.
 * @param fn - Callback receiving the worktree path.
 * @returns Result of fn.
 */
export async function defaultWithWorktree<T>(
  repoPath: string,
  ref: string,
  fn: (worktreePath: string) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-eval-worktree-'));
  const worktreePath = path.join(root, 'worktree');
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktreePath, ref], {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return await fn(worktreePath);
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Apply a unified-diff patch text to a worktree using `git apply`.
 *
 * @param worktreePath - Target working tree.
 * @param patchText - Unified diff to apply.
 * @throws When git apply rejects the patch.
 */
export function defaultApplyPatch(worktreePath: string, patchText: string): void {
  const tempPatch = path.join(os.tmpdir(), `swarm-eval-patch-${Date.now()}.diff`);
  fs.writeFileSync(tempPatch, patchText, 'utf8');
  try {
    const result = spawnSync('git', ['apply', '--whitespace=nowarn', tempPatch], {
      cwd: worktreePath,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`git apply failed: ${result.stderr || result.stdout || 'unknown error'}`);
    }
  } finally {
    fs.rmSync(tempPatch, { force: true });
  }
}

/**
 * Append one record as a single JSON line to a JSONL file.
 *
 * @param filePath - Absolute path of the JSONL file.
 * @param record - Record to append.
 */
export function appendJsonlRecord(filePath: string, record: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}
