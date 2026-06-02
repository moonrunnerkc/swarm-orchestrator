// Helpers over parse-diff output. Each detector walks the same parsed
// diff; centralizing the iteration prevents drift between detectors.

import parseDiff from 'parse-diff';
import type { File as ParsedDiffFile, Chunk, Change, AddChange, DeleteChange } from 'parse-diff';

export interface AddedLine {
  file: string;
  lineNumber: number;
  content: string;
}

export interface DeletedLine {
  file: string;
  // Line number in the *pre-image* (where the line lived before deletion).
  lineNumber: number;
  content: string;
}

export interface HunkPair {
  file: string;
  chunk: Chunk;
  added: AddedLine[];
  deleted: DeletedLine[];
}

// A line is "comment-only" if its first non-whitespace characters
// open or continue a single-line or block comment. Comments are prose
// describing code, not the code itself — a detector looking for a
// `jest.mock(...)` call should not fire on `// jest.mock('foo') is a
// cheat`. The exact set of opener tokens here covers JS/TS, Python,
// SQL/Lua (--), block comments (/* */), and continuations (*).
const COMMENT_ONLY_RE = /^\s*(\/\/|#|--|\/\*|\*\/|\*(?!\*))/;

export function isCommentOnlyLine(content: string): boolean {
  return COMMENT_ONLY_RE.test(content);
}

const SUPPORTED_FILE_KINDS = ['add', 'modify', 'rename'] as const;

export function fileKind(file: ParsedDiffFile): 'add' | 'modify' | 'delete' | 'rename' | 'unknown' {
  if (file.deleted === true) return 'delete';
  if (file.new === true) return 'add';
  if (file.from !== file.to && file.from !== undefined && file.to !== undefined) return 'rename';
  if (file.from !== undefined || file.to !== undefined) return 'modify';
  return 'unknown';
}

export function filePath(file: ParsedDiffFile): string {
  return file.to ?? file.from ?? '<unknown>';
}

export function shouldInspect(file: ParsedDiffFile): boolean {
  const kind = fileKind(file);
  return (SUPPORTED_FILE_KINDS as readonly string[]).includes(kind);
}

export function walkHunks(files: ParsedDiffFile[]): HunkPair[] {
  const out: HunkPair[] = [];
  for (const file of files) {
    if (!shouldInspect(file)) continue;
    const path = filePath(file);
    for (const chunk of file.chunks) {
      const added: AddedLine[] = [];
      const deleted: DeletedLine[] = [];
      for (const change of chunk.changes) {
        if (isAdd(change)) {
          added.push({ file: path, lineNumber: change.ln, content: change.content.slice(1) });
        } else if (isDel(change)) {
          deleted.push({ file: path, lineNumber: change.ln, content: change.content.slice(1) });
        }
      }
      out.push({ file: path, chunk, added, deleted });
    }
  }
  return out;
}

/** A contiguous run of post-image line numbers, inclusive on both ends. */
export interface LineRange {
  start: number;
  end: number;
}

/** Per-file post-image line ranges the diff added or modified. */
export type ChangedLineRanges = Record<string, LineRange[]>;

function coalesce(lines: number[]): LineRange[] {
  if (lines.length === 0) return [];
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges: LineRange[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i += 1) {
    const n = sorted[i]!;
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    ranges.push({ start, end: prev });
    start = n;
    prev = n;
  }
  ranges.push({ start, end: prev });
  return ranges;
}

/**
 * Extract the post-image line ranges a diff added or modified, per file.
 * These are the lines a mutation- or coverage-scoped tool should target:
 * the code the PR actually introduced, not the surrounding context. Only
 * added/modified lines (post-image line numbers) are reported; pure
 * deletions have no post-image line and are not mutable.
 *
 * `filter` (default: every inspected file) narrows the set, e.g. to source
 * files Stryker can mutate. Returns a map keyed by the post-image path.
 */
export function changedLineRangesFromFiles(
  files: ParsedDiffFile[],
  filter: (path: string) => boolean = () => true,
): ChangedLineRanges {
  const byFile: Record<string, number[]> = {};
  for (const file of files) {
    if (!shouldInspect(file)) continue;
    const path = filePath(file);
    if (!filter(path)) continue;
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (isAdd(change)) {
          (byFile[path] ??= []).push(change.ln);
        }
      }
    }
  }
  const out: ChangedLineRanges = {};
  for (const [path, lines] of Object.entries(byFile)) {
    const ranges = coalesce(lines);
    if (ranges.length > 0) out[path] = ranges;
  }
  return out;
}

/** Convenience wrapper that parses a raw unified diff first. */
export function extractChangedLineRanges(
  diff: string,
  filter?: (path: string) => boolean,
): ChangedLineRanges {
  return changedLineRangesFromFiles(parseDiff(diff), filter);
}

/** True when `line` falls within any of the ranges. */
export function lineInRanges(line: number, ranges: LineRange[] | undefined): boolean {
  if (ranges === undefined) return false;
  return ranges.some((r) => line >= r.start && line <= r.end);
}

function isAdd(change: Change): change is AddChange {
  return change.type === 'add';
}

function isDel(change: Change): change is DeleteChange {
  return change.type === 'del';
}

const TEST_FILE_PATTERNS: RegExp[] = [
  /(^|\/)__tests__\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)[^/]+_test\.py$/,
  /(^|\/)tests?\//,
  /(^|\/)[^/]+_test\.go$/,
  /(^|\/)[^/]+\.test\.rs$/,
  /(^|\/)spec\//,
];

export function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some((re) => re.test(path));
}

// Extensions whose files are plausibly imported by a test. Used by
// no-op-fix and coverage-erosion to gate their "no compensating test"
// findings — a docs file, config blob, lockfile, or storybook story
// can't be imported by a unit test in any reasonable repo, so flagging
// the absence of a test for one is only noise.
const TEST_REACHABLE_EXTENSIONS = new Set<string>([
  '.ts', '.tsx', '.cts', '.mts',
  '.js', '.jsx', '.cjs', '.mjs',
  '.py', '.pyi',
  '.go',
  '.rs',
  '.rb',
  '.java', '.kt', '.kts', '.scala', '.groovy',
  '.cs', '.fs',
  '.php',
  '.swift', '.m', '.mm',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.dart',
  '.ex', '.exs',
  '.elm',
  '.erl', '.hrl',
  '.clj', '.cljs', '.cljc',
  '.lua',
  '.sh', '.bash', '.zsh', '.fish',
]);

// Storybook stories, configuration blobs, lockfiles, and other file
// shapes that are not test-reachable even though their extension is a
// code extension. Examples: foo.stories.tsx, vite.config.ts (still
// code but not a test-reachable subject in the no-op-fix sense),
// turbo.json (data).
const NEVER_TEST_REACHABLE_RE: RegExp[] = [
  /\.stories\.[jt]sx?$/,
  /\.story\.[jt]sx?$/,
];

// Filenames that are never test-reachable code regardless of extension
// or absence thereof. LICENSE, .env, .gitignore class — config and
// project-metadata files.
const NEVER_TEST_REACHABLE_BASENAMES = new Set<string>([
  'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'NOTICE',
  '.gitignore', '.gitattributes', '.gitmodules',
  '.editorconfig', '.npmrc', '.yarnrc', '.nvmrc', '.node-version',
  '.prettierrc', '.prettierignore', '.eslintignore',
  '.dockerignore', 'Dockerfile', '.env', '.env.example', '.env.local',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'Pipfile.lock', 'poetry.lock', 'uv.lock',
  'Cargo.lock', 'Gemfile.lock', 'composer.lock',
]);

/**
 * Returns true when a unit test could plausibly import this file.
 * Used to gate detector findings whose entire question is "does any
 * test reach this file?" — for files outside this set, the answer is
 * "no" by definition, and the finding has no value.
 */
export function isPlausiblyTestReachable(p: string): boolean {
  if (p.length === 0) return false;
  const normalized = p.replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (NEVER_TEST_REACHABLE_BASENAMES.has(base)) return false;
  for (const re of NEVER_TEST_REACHABLE_RE) {
    if (re.test(normalized)) return false;
  }
  const dot = normalized.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = normalized.slice(dot).toLowerCase();
  return TEST_REACHABLE_EXTENSIONS.has(ext);
}

export function isManifestFile(path: string): boolean {
  return (
    path.endsWith('/package.json') ||
    path === 'package.json' ||
    path.endsWith('/go.mod') ||
    path === 'go.mod' ||
    path.endsWith('/requirements.txt') ||
    path === 'requirements.txt' ||
    path.endsWith('/pyproject.toml') ||
    path === 'pyproject.toml' ||
    path.endsWith('/Cargo.toml') ||
    path === 'Cargo.toml'
  );
}
