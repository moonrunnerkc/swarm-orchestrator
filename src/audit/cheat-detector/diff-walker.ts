// Helpers over parse-diff output. Each detector walks the same parsed
// diff; centralizing the iteration prevents drift between detectors.

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
