// Run off-the-shelf static analyzers (Semgrep, ESLint security rules)
// against the same code the auditor judged, so the report can show what
// each tool catches that the others do not. The analyzers work on whole
// files, not diffs, so for each PR we fetch the post-merge content of the
// changed source files at the PR's head SHA, run the tools on them, and
// keep only findings that land on a line the PR actually introduced or
// modified. That keeps the comparison like-for-like: every finding, from
// the auditor or from a competitor, points at code this PR changed.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { getLogger } from '../../../src/logger';
import { isSourceFile } from './github';
import type { DifferentialFinding } from './types';

const log = getLogger('real-prs:differential');

/** Per-file set of new-side line numbers the PR added or changed. */
export type ChangedLines = Map<string, Set<number>>;

/** Parse a unified diff into the set of added new-side lines per file. */
export function changedNewLines(unifiedDiff: string): ChangedLines {
  const out: ChangedLines = new Map();
  for (const file of parseDiff(unifiedDiff)) {
    const to = file.to;
    if (to === undefined || to === '/dev/null') continue;
    const lines = out.get(to) ?? new Set<number>();
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type === 'add') lines.add(change.ln);
      }
    }
    if (lines.size > 0) out.set(to, lines);
  }
  return out;
}

/** The changed source files of a PR, materialized on disk for the tools. */
export interface MaterializedPr {
  dir: string;
  files: Array<{ relPath: string; changedLines: Set<number> }>;
  cleanup(): void;
}

const MAX_FILES_PER_PR = 60;
const MAX_FILE_BYTES = 512 * 1024;

/**
 * Fetch the post-merge content of each changed source file at `headSha`
 * and write it into a temp dir under its repo-relative path. Returns the
 * dir and the per-file changed-line sets. Non-source files (tests,
 * fixtures, .d.ts) are skipped: the analyzers target source.
 */
export async function materializeChangedFiles(
  token: string,
  repo: string,
  headSha: string,
  unifiedDiff: string,
): Promise<MaterializedPr> {
  const changed = changedNewLines(unifiedDiff);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-diff-'));
  const files: MaterializedPr['files'] = [];
  let fetched = 0;
  for (const [relPath, changedLines] of changed) {
    if (fetched >= MAX_FILES_PER_PR) break;
    if (!isSourceFile(relPath)) continue;
    const content = await fetchRawFile(token, repo, headSha, relPath);
    if (content === null || content.length > MAX_FILE_BYTES) continue;
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    files.push({ relPath, changedLines });
    fetched += 1;
  }
  return {
    dir,
    files,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

async function fetchRawFile(
  token: string,
  repo: string,
  sha: string,
  relPath: string,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repo}/${sha}/${relPath}`;
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    log.debug(`raw fetch failed for ${repo}@${sha}:${relPath}: ${(err as Error).message}`);
    return null;
  }
}

/** Keep only findings that land on a line the PR introduced (±2 lines of
 *  slack for tools that report the enclosing statement's start). */
function onChangedLine(file: string, line: number, changed: ChangedLines): boolean {
  const set = changed.get(file);
  if (set === undefined) return false;
  for (let d = -2; d <= 2; d += 1) if (set.has(line + d)) return true;
  return false;
}

interface SemgrepResult {
  results?: Array<{
    check_id?: string;
    path?: string;
    start?: { line?: number };
    extra?: { severity?: string; message?: string };
  }>;
}

/** Run Semgrep over the materialized dir with the JS/TS and OWASP rule
 *  packs. Returns findings restricted to PR-introduced lines. */
/** Resolve the semgrep binary: PATH first, then the common pip user-site
 *  and Homebrew locations, since pip installs land outside the default
 *  PATH a node child process inherits. */
export function resolveSemgrepBin(): string | null {
  const candidates = [
    'semgrep',
    path.join(os.homedir(), 'Library', 'Python', '3.9', 'bin', 'semgrep'),
    path.join(os.homedir(), '.local', 'bin', 'semgrep'),
    '/opt/homebrew/bin/semgrep',
    '/usr/local/bin/semgrep',
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function runSemgrep(mat: MaterializedPr, semgrepBin: string): DifferentialFinding[] {
  const changed = mapChanged(mat);
  let raw: string;
  try {
    raw = execFileSync(
      semgrepBin,
      [
        'scan',
        '--config=p/javascript',
        '--config=p/typescript',
        '--config=p/owasp-top-ten',
        '--config=p/security-audit',
        '--json',
        '--quiet',
        '--no-git-ignore',
        '--metrics=off',
        '--timeout=30',
        mat.dir,
      ],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (err) {
    // Semgrep exits non-zero when findings exist; stdout still holds JSON.
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout === 'string' && stdout.length > 0) raw = stdout;
    else {
      log.warn(`semgrep failed on ${mat.dir}: ${(err as Error).message}`);
      return [];
    }
  }
  let parsed: SemgrepResult;
  try {
    parsed = JSON.parse(raw) as SemgrepResult;
  } catch {
    return [];
  }
  const out: DifferentialFinding[] = [];
  for (const r of parsed.results ?? []) {
    const rel = r.path === undefined ? '' : path.relative(mat.dir, r.path);
    const line = r.start?.line ?? 0;
    if (!onChangedLine(rel, line, changed)) continue;
    out.push({
      tool: 'semgrep',
      ruleId: r.check_id ?? 'unknown',
      severity: r.extra?.severity ?? 'INFO',
      file: rel,
      line,
      message: (r.extra?.message ?? '').slice(0, 300),
    });
  }
  return out;
}

interface EslintFile {
  filePath: string;
  messages?: Array<{ line?: number; ruleId?: string | null; severity?: number; message?: string }>;
}

/** Absolute paths to the isolated ESLint 9 differential toolchain. It is
 *  pinned in its own directory because eslint-plugin-security 3.x still
 *  calls an API ESLint 10 removed; see eslint-runner/package.json. */
export function eslintRunnerPaths(): { dir: string; bin: string; config: string } {
  const dir = path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'real-prs', 'eslint-runner');
  return {
    dir,
    bin: path.join(dir, 'node_modules', '.bin', 'eslint'),
    config: path.join(dir, 'eslint.config.mjs'),
  };
}

/** True when the isolated ESLint toolchain is installed. */
export function eslintRunnerReady(): boolean {
  return fs.existsSync(eslintRunnerPaths().bin);
}

/**
 * Run ESLint's security rule set over the materialized dir. ESLint 10
 * ignores files outside the config's base path, so the run uses the temp
 * dir as cwd and references the isolated config by absolute path; the
 * config's plugin imports still resolve from the runner's node_modules.
 */
export function runEslint(mat: MaterializedPr): DifferentialFinding[] {
  const changed = mapChanged(mat);
  const { bin, config } = eslintRunnerPaths();
  let raw: string;
  try {
    raw = execFileSync(bin, ['--no-config-lookup', '--config', config, '-f', 'json', '.'], {
      cwd: mat.dir,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout === 'string' && stdout.length > 0) raw = stdout;
    else {
      log.warn(`eslint failed on ${mat.dir}: ${(err as Error).message}`);
      return [];
    }
  }
  let parsed: EslintFile[];
  try {
    parsed = JSON.parse(raw) as EslintFile[];
  } catch {
    return [];
  }
  const out: DifferentialFinding[] = [];
  for (const f of parsed) {
    const rel = path.relative(mat.dir, f.filePath);
    for (const m of f.messages ?? []) {
      if (m.ruleId === undefined || m.ruleId === null) continue;
      const line = m.line ?? 0;
      if (!onChangedLine(rel, line, changed)) continue;
      out.push({
        tool: 'eslint-security',
        ruleId: m.ruleId,
        severity: m.severity === 2 ? 'error' : 'warning',
        file: rel,
        line,
        message: (m.message ?? '').slice(0, 300),
      });
    }
  }
  return out;
}

function mapChanged(mat: MaterializedPr): ChangedLines {
  const m: ChangedLines = new Map();
  for (const f of mat.files) m.set(f.relPath, f.changedLines);
  return m;
}
