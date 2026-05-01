import parseDiff = require('parse-diff');
import type { LineFinding } from '../types/finding';

export type ParsedPullRequestDiff = parseDiff.File[];

export type DiffSide = 'RIGHT';

export interface DiffLineResolution {
  line: number;
  side: DiffSide;
  originalLine: number;
  relocated: boolean;
}

interface IndexedDiffLine {
  path: string;
  line: number;
}

function normalizePath(filePath: string | undefined): string | undefined {
  if (!filePath || filePath === '/dev/null') return undefined;
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function filePath(file: parseDiff.File): string | undefined {
  return normalizePath(file.to) ?? normalizePath(file.from);
}

function indexFileLines(file: parseDiff.File): IndexedDiffLine[] {
  const path = filePath(file);
  if (!path) return [];

  const indexed: IndexedDiffLine[] = [];
  for (const chunk of file.chunks) {
    for (const change of chunk.changes) {
      if (change.type === 'normal') {
        indexed.push({ path, line: change.ln2 });
      } else if (change.type === 'add') {
        indexed.push({ path, line: change.ln });
      }
    }
  }
  return indexed;
}

function compareNearest(targetLine: number): (a: IndexedDiffLine, b: IndexedDiffLine) => number {
  return (a, b) => {
    const distance = Math.abs(a.line - targetLine) - Math.abs(b.line - targetLine);
    if (distance !== 0) return distance;
    return a.line - b.line;
  };
}

/**
 * Parse unified PR diff text into structured files.
 *
 * @param diffText - Unified diff text from the GitHub API.
 * @returns Parsed diff files.
 */
export function parsePullRequestDiff(diffText: string): ParsedPullRequestDiff {
  return parseDiff(diffText);
}

/**
 * Resolve a line-scoped finding to the GitHub review API line and side anchor.
 *
 * GitHub review `line` and `side` values target file line numbers on the
 * pull request diff. Findings always target the post-patch side.
 *
 * @param finding - Line-scoped finding with repo-relative path and 1-indexed line.
 * @param diff - Parsed PR diff.
 * @returns Inline comment anchor, relocated anchor, or null when no nearby hunk line exists.
 */
export function resolveDiffPosition(
  finding: LineFinding,
  diff: ParsedPullRequestDiff,
): DiffLineResolution | null {
  const targetPath = normalizePath(finding.filePath);
  if (!targetPath) return null;

  const lines = diff.flatMap(indexFileLines)
    .filter(line => line.path === targetPath);
  if (lines.length === 0) return null;

  const exact = lines.find(line => line.line === finding.line);
  if (exact) {
    return {
      line: exact.line,
      side: 'RIGHT',
      originalLine: finding.line,
      relocated: false,
    };
  }

  const nearest = lines
    .filter(line => Math.abs(line.line - finding.line) <= 5)
    .sort(compareNearest(finding.line))[0];
  if (!nearest) return null;

  return {
    line: nearest.line,
    side: 'RIGHT',
    originalLine: finding.line,
    relocated: true,
  };
}
