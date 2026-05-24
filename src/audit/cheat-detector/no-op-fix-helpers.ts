// Helpers extracted from `no-op-fix.ts` so the main file stays under
// the 300-LOC convention after the v2.0 judge composition lands. No
// behaviour change in this file relative to the v1.1.0 inline code.

import * as fs from 'fs';
import * as path from 'path';
import type { Finding } from '../types';
import type { DetectorContext } from './detector-types';
import { filePath, shouldInspect } from './diff-walker';
import { isTestFile } from './diff-walker';

const SYMBOL_RE = /\b([A-Za-z_][A-Za-z0-9_]{1,})\b/g;
export const COMMON_NOISE = new Set([
  'if', 'else', 'return', 'const', 'let', 'var', 'function', 'class', 'true',
  'false', 'null', 'undefined', 'import', 'from', 'export', 'default', 'new',
  'this', 'await', 'async', 'for', 'while', 'switch', 'case', 'break', 'continue',
  'try', 'catch', 'finally', 'throw', 'instanceof', 'typeof', 'void', 'in', 'of',
  'expect', 'it', 'test', 'describe', 'beforeEach', 'afterEach', 'beforeAll',
  'afterAll', 'toBe', 'toEqual', 'toBeDefined', 'toBeTruthy', 'toBeFalsy',
  'mock', 'fn', 'spy', 'string', 'number', 'boolean', 'any', 'object',
]);

export function collectSymbolsFromAddedLines(
  ctx: DetectorContext,
  predicate: (p: string) => boolean,
): Set<string> {
  const out = new Set<string>();
  for (const file of ctx.files) {
    if (!shouldInspect(file)) continue;
    const p = filePath(file);
    if (!predicate(p)) continue;
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type !== 'add') continue;
        for (const sym of extractSymbols(change.content)) out.add(sym);
      }
    }
  }
  return out;
}

export function extractSymbols(line: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  SYMBOL_RE.lastIndex = 0;
  while ((m = SYMBOL_RE.exec(line)) !== null) {
    const sym = m[1];
    if (sym === undefined) continue;
    if (sym.length < 3) continue;
    if (COMMON_NOISE.has(sym)) continue;
    out.push(sym);
  }
  return out;
}

export function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const v of a) if (b.has(v)) out.add(v);
  return out;
}

export function enumerateRepoTestFiles(repoRoot: string): string[] {
  if (!fs.existsSync(repoRoot)) return [];
  const out: string[] = [];
  walkRepo(repoRoot, repoRoot, out, 0);
  return out;
}

function walkRepo(repoRoot: string, dir: string, out: string[], depth: number): void {
  if (depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRepo(repoRoot, full, out, depth + 1);
    } else if (entry.isFile()) {
      const rel = path.relative(repoRoot, full);
      if (isTestFile(rel)) out.push(full);
    }
  }
}

export function pushDegradationNotices(
  findings: Finding[],
  closure: { capped: boolean; unresolvedSpecCount: number },
  fileForLocation: string,
): void {
  if (closure.capped) {
    findings.push({
      category: 'no-op-fix',
      severity: 'info',
      message:
        `Import-graph closure hit the 5000-node BFS cap; no-op-fix coverage ` +
        `checks were treated as optimistically reaching every touched source ` +
        `file for this audit run.`,
      location: { file: fileForLocation, line: 1 },
      evidence: '(closure capped)',
    });
  }
  if (closure.unresolvedSpecCount > 0) {
    findings.push({
      category: 'no-op-fix',
      severity: 'info',
      message:
        `Import-graph resolver could not follow ${closure.unresolvedSpecCount} ` +
        `import specifier(s) (bare specs, workspace mappings the resolver could ` +
        `not read, or unsupported syntax). Reachability is conservative.`,
      location: { file: fileForLocation, line: 1 },
      evidence: `(unresolved: ${closure.unresolvedSpecCount})`,
    });
  }
}
