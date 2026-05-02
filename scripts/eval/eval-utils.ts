import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface RateSummary {
  count: number;
  total: number;
  rate: number | null;
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

export function requiredString(args: Record<string, string | boolean>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`missing required --${key} <path>`);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readJsonArray(filePath: string): unknown[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON array`);
  }
  return parsed;
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

export function rate(count: number, total: number): RateSummary {
  return { count, total, rate: total > 0 ? count / total : null };
}

export function writeReport(report: unknown, outPath?: string): void {
  const body = JSON.stringify(report, null, 2);
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, `${body}\n`, 'utf8');
  } else {
    process.stdout.write(`${body}\n`);
  }
}

export function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export async function withWorktree<T>(
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

export function applyPatchFile(repoPath: string, patchFile: string): void {
  const result = spawnSync('git', ['apply', patchFile], {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git apply failed for ${patchFile}: ${result.stderr || result.stdout}`);
  }
}

/**
 * Rewrite hardcoded absolute paths in a synthesized testCommand so it runs in
 * the worktree path instead of the original repo path.
 *
 * The synthesizer occasionally prepends `cd <abs-repo-path> && ...` to its
 * generated testCommand. When that command is then run inside a fresh git
 * worktree (e.g. the gold-applied side), the cd jumps back to the original
 * repo and the test never exercises the worktree state. Replacing every
 * literal occurrence of `fromPath` with `toPath` neutralizes that.
 *
 * @param command - The original testCommand string.
 * @param fromPath - Absolute path of the source repo to be replaced.
 * @param toPath - Absolute path of the worktree the command should target.
 * @returns The rewritten command. Unchanged when fromPath does not appear.
 */
export function rewriteCommandForWorktree(command: string, fromPath: string, toPath: string): string {
  if (!fromPath || fromPath === toPath) return command;
  return command.split(fromPath).join(toPath);
}

/**
 * Wrap a shell command so a per-instance venv is on PATH and the command's
 * working directory is on PYTHONPATH for its execution.
 *
 * `export PATH=<venvBin>:$PATH` ensures `python`, `python3`, `pip`, and
 * `pytest` resolve to the venv binary even when the testCommand contains
 * its own subshell `cd` or chain of `&&`.
 *
 * `export PYTHONPATH=<cwd>:$PYTHONPATH` ensures `import <package>` from
 * inside the gold worktree resolves to the worktree's source, not to the
 * persistent venv's editable-install `.pth` (which still points at the
 * persistent base repo). Without this, `python tests/runtests.py` in the
 * gold worktree silently imports `django` from the BASE source — `python
 * <script>` puts the script's directory on `sys.path[0]`, not the cwd, so
 * site-packages `.pth` wins. This is round-7 of harness fragility,
 * surfaced by the v7 critical-path session 2.5 multi-repo Layer 1 sweep
 * after the framework-aware placement fix made Django tests actually
 * runnable. Both base-run and gold-run get the wrap; redundant on base
 * (cwd === editable-install source), required on gold.
 *
 * @param command - The raw shell command (may contain cd, &&, env vars).
 * @param venvBin - Absolute path to the venv's bin/Scripts directory, or undefined.
 * @param cwd - Absolute path to the working directory the command runs in,
 *              used to seed PYTHONPATH. Optional; omit for cases where no
 *              python import-resolution is in play.
 * @returns The wrapped command, or the original when neither venvBin nor cwd is supplied.
 */
export function wrapCommandWithVenv(
  command: string,
  venvBin: string | undefined,
  cwd?: string,
): string {
  const exports: string[] = [];
  if (cwd) exports.push(`export PYTHONPATH=${cwd}:$PYTHONPATH`);
  if (venvBin) exports.push(`export PATH=${venvBin}:$PATH`);
  if (exports.length === 0) return command;
  return `${exports.join('; ')}; ${command}`;
}
