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
