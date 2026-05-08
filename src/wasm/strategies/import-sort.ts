/**
 * `import-sort` strategy: sort the import section at the top of a
 * TypeScript / JavaScript / Python file alphabetically. When the file
 * doesn't exist this strategy fails (the contract compiler should pair
 * `import-sort` with another strategy or with synthesis for creation
 * obligations); the §8 misclassification recovery path then reroutes
 * the obligation to synthesis.
 *
 * The implementation is deliberately language-aware in a tiny way: it
 * recognizes ESM/CJS imports for TS/JS and `import` lines for Python.
 * The sort is stable, case-insensitive, and preserves blank lines and
 * non-import content below the import block.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ensureInsideRepoRoot } from '../wasm-runtime';
import type { DeterministicStrategy, StrategyContext, StrategyResult } from '../types';

interface SortPlan {
  before: string[];
  imports: string[];
  after: string[];
  language: 'ts-js' | 'python';
}

const TS_JS_IMPORT_RE =
  /^\s*(?:import\b[\s\S]*?(?:from\s+["'][^"']+["'])?\s*;?|(?:const|let|var)\s+[\s\S]*?=\s*require\([^)]+\)\s*;?)\s*$/;
const PY_IMPORT_RE = /^\s*(?:import\s+\S+|from\s+\S+\s+import\s+.+)\s*$/;

function detectLanguage(relPath: string): 'ts-js' | 'python' | null {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    return 'ts-js';
  }
  if (ext === '.py') return 'python';
  return null;
}

function planSort(content: string, language: 'ts-js' | 'python'): SortPlan {
  const lines = content.split('\n');
  const before: string[] = [];
  const imports: string[] = [];
  const after: string[] = [];

  // Phase 1: collect leading non-import lines (preserve license headers,
  // shebangs, top-of-file comments).
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      before.push(line);
      i += 1;
      continue;
    }
    if (line.startsWith('#!') || line.startsWith('//') || line.startsWith('/*')) {
      before.push(line);
      i += 1;
      continue;
    }
    if (language === 'python' && (line.startsWith('"""') || line.startsWith('#'))) {
      before.push(line);
      i += 1;
      continue;
    }
    break;
  }

  // Phase 2: collect contiguous import lines.
  const importRe = language === 'python' ? PY_IMPORT_RE : TS_JS_IMPORT_RE;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (importRe.test(line)) {
      imports.push(line);
      i += 1;
      continue;
    }
    if (line.trim() === '' && imports.length > 0) {
      // Allow blank lines between imports without ending the block;
      // remember them for re-emission after the sort.
      let j = i;
      while (j < lines.length && (lines[j] ?? '').trim() === '') j += 1;
      const peek = lines[j] ?? '';
      if (j < lines.length && importRe.test(peek)) {
        i = j;
        continue;
      }
    }
    break;
  }

  // Phase 3: everything else.
  while (i < lines.length) {
    after.push(lines[i] ?? '');
    i += 1;
  }

  return { before, imports, after, language };
}

function renderSorted(plan: SortPlan): string {
  const sortedImports = plan.imports
    .slice()
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const out: string[] = [];
  out.push(...plan.before);
  out.push(...sortedImports);
  if (plan.after.length > 0) out.push(...plan.after);
  return out.join('\n');
}

/** Pure function: sort a content string. Used by tests. */
export function sortImports(content: string, relPath: string): string {
  const language = detectLanguage(relPath);
  if (language === null) {
    throw new Error(
      `import-sort: unsupported file type "${relPath}"; expected .ts/.tsx/.js/.jsx/.mjs/.cjs/.py`,
    );
  }
  const plan = planSort(content, language);
  if (plan.imports.length === 0) {
    return content;
  }
  return renderSorted(plan);
}

/** The strategy implementation. */
export const importSortStrategy: DeterministicStrategy = {
  name: 'import-sort',
  description: 'Alphabetize imports at the top of a TS/JS/Python file in place.',
  handles: ['file-must-exist'] as const,
  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const obligation = ctx.obligation;
    if (obligation.type !== 'file-must-exist') {
      throw new Error(
        `import-sort only handles file-must-exist; got ${obligation.type}`,
      );
    }
    const relPath = obligation.path;
    const language = detectLanguage(relPath);
    if (language === null) {
      throw new Error(
        `import-sort: unsupported file type "${relPath}"; expected .ts/.tsx/.js/.jsx/.mjs/.cjs/.py`,
      );
    }
    const abs = ensureInsideRepoRoot(ctx.repoRoot, relPath);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `import-sort: file ${relPath} does not exist; pair the obligation with a creation strategy or use synthesis`,
      );
    }
    const before = fs.readFileSync(abs, 'utf8');
    const after = sortImports(before, relPath);
    if (after === before) {
      return {
        applied: false,
        detail: `${relPath} imports already sorted`,
        filesAffected: [],
      };
    }
    fs.writeFileSync(abs, after, 'utf8');
    return {
      applied: true,
      detail: `sorted imports in ${relPath}`,
      filesAffected: [relPath],
    };
  },
};

/** Auto-tagger helper: should this obligation be tagged `import-sort`? */
export function isImportSortable(relPath: string): boolean {
  return detectLanguage(relPath) !== null;
}
