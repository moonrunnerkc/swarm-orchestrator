// No-op-fix: the PR claims to fix a failing test, but the modified
// non-test code has no plausible relationship to any test in the repo.
// Two independent signals run; either is enough to flag.
//
// (1) Import-graph reachability. We compute the closure of every
//     test file touched in the PR (or, when no test changed but
//     source did, every touched source file's reverse problem: do
//     *any* repo tests reach it?). The closure is delegated to
//     `reachableSourceFiles` in `test-import-closure.ts`, which uses
//     `extractImports` from `src/verification/ast-imports.ts`. Python
//     parsing requires `python3` on PATH; the underlying extractor
//     falls back to regex when python3 is missing, which can lose a
//     few edges but never crashes the audit.
//
// (2) Symbol overlap. When both source and tests are touched in the
//     same PR, the added lines on each side must share at least one
//     identifier. If they share none the test changes can't possibly
//     exercise the source changes, regardless of import structure.
//
// Both signals replace the v10 basename `text.includes(stem)`
// heuristic, which false-positived on common names (`utils`,
// `index`, `helpers`, `config`) and silently suppressed real no-op
// fixes by claiming "the test mentions the word `utils`, so the
// source file is covered."

import * as fs from 'fs';
import * as path from 'path';
import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { filePath, fileKind, isTestFile, shouldInspect } from './diff-walker';
import { reachableSourceFiles } from './test-import-closure';

const VERSION = '1.1.0';

const SYMBOL_RE = /\b([A-Za-z_][A-Za-z0-9_]{1,})\b/g;
const COMMON_NOISE = new Set([
  'if', 'else', 'return', 'const', 'let', 'var', 'function', 'class', 'true',
  'false', 'null', 'undefined', 'import', 'from', 'export', 'default', 'new',
  'this', 'await', 'async', 'for', 'while', 'switch', 'case', 'break', 'continue',
  'try', 'catch', 'finally', 'throw', 'instanceof', 'typeof', 'void', 'in', 'of',
  'expect', 'it', 'test', 'describe', 'beforeEach', 'afterEach', 'beforeAll',
  'afterAll', 'toBe', 'toEqual', 'toBeDefined', 'toBeTruthy', 'toBeFalsy',
  'mock', 'fn', 'spy', 'string', 'number', 'boolean', 'any', 'object',
]);

export const noOpFixDetector: Detector = {
  name: 'no-op-fix',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const sourceTouched: string[] = [];
    const testTouched: string[] = [];
    for (const file of ctx.files) {
      if (!shouldInspect(file)) continue;
      if (fileKind(file) === 'delete') continue;
      const p = filePath(file);
      if (isTestFile(p)) testTouched.push(p);
      else sourceTouched.push(p);
    }

    if (sourceTouched.length === 0 && testTouched.length === 0) return [];

    const sourceSymbols = collectSymbolsFromAddedLines(ctx, (p) => !isTestFile(p));
    const testSymbols = collectSymbolsFromAddedLines(ctx, (p) => isTestFile(p));

    const findings: Finding[] = [];

    if (testTouched.length === 0 && sourceTouched.length > 0) {
      // No test changed; ask the import-graph whether *any* test in
      // the repo transitively reaches each touched source file.
      const allRepoTests = enumerateRepoTestFiles(ctx.repoRoot);
      const closure = reachableSourceFiles(allRepoTests, ctx.repoRoot);
      pushDegradationNotices(findings, closure, sourceTouched[0] ?? '<repo>');

      if (sourceSymbols.size === 0) return findings;
      for (const file of sourceTouched) {
        const abs = path.resolve(ctx.repoRoot, file);
        if (closure.reachable.has(abs)) continue;
        if (closure.capped) continue; // optimistic when cap hit
        findings.push({
          category: 'no-op-fix',
          severity: 'warn',
          message:
            `Source file ${file} was modified but no test file in the repository ` +
            `imports it, directly or transitively. If this PR claimed to fix a ` +
            `failing test, the fix likely missed the failing code path.`,
          location: { file, line: 1 },
          evidence: `(touched: ${sourceTouched.join(', ')})`,
        });
      }
      return findings;
    }

    if (testTouched.length > 0 && sourceTouched.length === 0) {
      for (const file of testTouched) {
        findings.push({
          category: 'no-op-fix',
          severity: 'block',
          message:
            `Test file ${file} was modified but no source file changed in this PR. ` +
            `If the PR claims to fix a failing test, the change likely edits the ` +
            `test rather than the failing implementation.`,
          location: { file, line: 1 },
          evidence: `(touched: ${testTouched.join(', ')})`,
        });
      }
      return findings;
    }

    // Both source and tests touched: symbol overlap is the relevant
    // signal. The import-graph reachability check is implied (the
    // same PR touched both sides, so they're co-located in intent).
    const overlap = intersect(sourceSymbols, testSymbols);
    if (overlap.size === 0 && testSymbols.size > 0 && sourceSymbols.size > 0) {
      for (const file of testTouched) {
        findings.push({
          category: 'no-op-fix',
          severity: 'warn',
          message:
            `Test changes in ${file} share no identifier with the source changes ` +
            `in this PR. The modified test may not exercise the modified code.`,
          location: { file, line: 1 },
          evidence: `(source touched: ${sourceTouched.join(', ')})`,
        });
      }
    }
    return findings;
  },
};

function collectSymbolsFromAddedLines(
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

function extractSymbols(line: string): string[] {
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

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const v of a) if (b.has(v)) out.add(v);
  return out;
}

function enumerateRepoTestFiles(repoRoot: string): string[] {
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

function pushDegradationNotices(
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
