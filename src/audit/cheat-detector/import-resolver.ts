// Local import-spec resolver for `test-import-closure.ts`. Turns a
// textual import specifier (`./foo`, `@scope/pkg/x`, `package.module`)
// into an absolute file path on disk, honoring TypeScript path mappings
// and npm/Yarn workspace roots for TS/JS files, and `__init__.py`
// package boundaries for Python.
//
// Lives in its own module to keep `test-import-closure.ts` under the
// per-file LOC budget. The resolver is intentionally separate from the
// v8 verification path's `tracked-file lookup` resolver — they answer
// different questions (does this on-disk file exist? vs does this
// patch include this file?) and shared abstractions would couple
// unrelated subsystems.

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../logger';

const log = getLogger('import-resolver');

const TS_LIKE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;
const PY_EXT = '.py';

export interface TsPathsMapping {
  baseUrl: string;
  paths: Record<string, string[]>;
}

export interface RepoConfig {
  tsPaths: TsPathsMapping | undefined;
  workspaceRoots: string[];
}

export function resolveSpec(
  importerAbs: string,
  spec: string,
  repoRoot: string,
  config: RepoConfig,
): string | undefined {
  const ext = path.extname(importerAbs).toLowerCase();
  if (ext === PY_EXT) return resolvePythonSpec(importerAbs, spec, repoRoot);
  return resolveTsSpec(importerAbs, spec, config);
}

function resolveTsSpec(
  importerAbs: string,
  spec: string,
  config: RepoConfig,
): string | undefined {
  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    return probeTsTarget(path.resolve(path.dirname(importerAbs), spec));
  }
  if (config.tsPaths) {
    for (const candidate of applyTsPaths(spec, config.tsPaths)) {
      const hit = probeTsTarget(candidate);
      if (hit !== undefined) return hit;
    }
  }
  if (config.workspaceRoots.length > 0) {
    const hit = resolveWorkspaceSpec(spec, config.workspaceRoots);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function probeTsTarget(base: string): string | undefined {
  if (path.extname(base) !== '' && isFile(base)) return base;
  for (const ext of TS_LIKE_EXTS) {
    if (isFile(base + ext)) return base + ext;
  }
  if (isDir(base)) {
    for (const ext of TS_LIKE_EXTS) {
      const candidate = path.join(base, 'index' + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function applyTsPaths(spec: string, mapping: TsPathsMapping): string[] {
  const out: string[] = [];
  for (const [pattern, targets] of Object.entries(mapping.paths)) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (spec === pattern) {
        for (const t of targets) out.push(path.resolve(mapping.baseUrl, t));
      }
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
    const captured = spec.slice(prefix.length, spec.length - suffix.length);
    for (const t of targets) {
      const expanded = t.includes('*') ? t.replace('*', captured) : t;
      out.push(path.resolve(mapping.baseUrl, expanded));
    }
  }
  return out;
}

function resolveWorkspaceSpec(
  spec: string,
  workspaceRoots: readonly string[],
): string | undefined {
  for (const wsRoot of workspaceRoots) {
    const pkgJson = path.join(wsRoot, 'package.json');
    if (!isFile(pkgJson)) continue;
    let pkg: { name?: string };
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as { name?: string };
    } catch (err) {
      log.warn(`workspace package.json unreadable at ${pkgJson}: ${(err as Error).message}`);
      continue;
    }
    if (typeof pkg.name !== 'string') continue;
    if (spec === pkg.name) {
      return probeTsTarget(path.join(wsRoot, 'index'))
        ?? probeTsTarget(path.join(wsRoot, 'src', 'index'));
    }
    if (spec.startsWith(pkg.name + '/')) {
      const rest = spec.slice(pkg.name.length + 1);
      return probeTsTarget(path.join(wsRoot, rest))
        ?? probeTsTarget(path.join(wsRoot, 'src', rest));
    }
  }
  return undefined;
}

function resolvePythonSpec(
  importerAbs: string,
  spec: string,
  repoRoot: string,
): string | undefined {
  if (spec === '') return undefined;
  let dots = 0;
  while (dots < spec.length && spec[dots] === '.') dots++;
  const moduleTail = spec.slice(dots);
  let baseDir: string;
  if (dots > 0) {
    baseDir = path.dirname(importerAbs);
    for (let i = 1; i < dots; i++) baseDir = path.dirname(baseDir);
  } else {
    baseDir = repoRoot;
  }
  if (moduleTail === '') {
    const init = path.join(baseDir, '__init__.py');
    return isFile(init) ? init : undefined;
  }
  const parts = moduleTail.split('.');
  let current = baseDir;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined || part === '') return undefined;
    const next = path.join(current, part);
    if (!isDir(next)) return undefined;
    current = next;
  }
  const leaf = parts[parts.length - 1];
  if (leaf === undefined || leaf === '') return undefined;
  const fileCandidate = path.join(current, leaf + '.py');
  if (isFile(fileCandidate)) return fileCandidate;
  const pkgInit = path.join(current, leaf, '__init__.py');
  if (isFile(pkgInit)) return pkgInit;
  return undefined;
}

export function loadRepoConfig(repoRoot: string): RepoConfig {
  return {
    tsPaths: loadTsPaths(repoRoot),
    workspaceRoots: loadWorkspaceRoots(repoRoot),
  };
}

function loadTsPaths(repoRoot: string): TsPathsMapping | undefined {
  const tsconfigPath = path.join(repoRoot, 'tsconfig.json');
  if (!isFile(tsconfigPath)) return undefined;
  let raw: string;
  try {
    raw = fs.readFileSync(tsconfigPath, 'utf8');
  } catch (err) {
    log.warn(`tsconfig.json unreadable at ${tsconfigPath}: ${(err as Error).message}`);
    return undefined;
  }
  let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (err) {
    log.warn(`tsconfig.json is malformed at ${tsconfigPath}: ${(err as Error).message}`);
    return undefined;
  }
  const paths = parsed.compilerOptions?.paths;
  if (paths === undefined) return undefined;
  const baseUrl = parsed.compilerOptions?.baseUrl ?? '.';
  return { baseUrl: path.resolve(repoRoot, baseUrl), paths };
}

function loadWorkspaceRoots(repoRoot: string): string[] {
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!isFile(pkgPath)) return [];
  let pkg: { workspaces?: string[] | { packages?: string[] } };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      workspaces?: string[] | { packages?: string[] };
    };
  } catch (err) {
    log.warn(`root package.json malformed at ${pkgPath}: ${(err as Error).message}`);
    return [];
  }
  const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
  const out: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = path.join(repoRoot, pattern.slice(0, -2));
      if (!isDir(parent)) continue;
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) out.push(path.join(parent, entry.name));
      }
    } else {
      const full = path.join(repoRoot, pattern);
      if (isDir(full)) out.push(full);
    }
  }
  return out;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function stripJsonComments(input: string): string {
  // Minimal `//` and `/* */` stripper, string-literal aware. Sufficient
  // for tsconfig.json which permits comments but not exotic JSON5 forms.
  let out = '';
  let i = 0;
  let inString = false;
  let quote = '';
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\' && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch as string;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length - 1 && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
