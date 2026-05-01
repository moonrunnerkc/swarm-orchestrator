import parseDiff = require('parse-diff');
import type { LineFinding } from '../types/finding';

export type ParsedPullRequestDiff = parseDiff.File[];

export interface DiffPositionResolution {
  path: string;
  position: number;
  line: number;
  originalLine: number;
  relocated: boolean;
}

interface IndexedDiffLine {
  path: string;
  line: number;
  position: number;
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
  let position = 0;
  for (const chunk of file.chunks) {
    for (const change of chunk.changes) {
      position += 1;
      if (change.type === 'normal') {
        indexed.push({ path, line: change.ln2, position });
      } else if (change.type === 'add') {
        indexed.push({ path, line: change.ln, position });
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
 * Resolve a line-scoped finding to the GitHub review API diff position.
 *
 * GitHub review `position` values count hunk body lines within a file diff,
 * including deleted lines, while comments can only target added or context
 * lines in the new file.
 *
 * @param finding - Line-scoped finding with repo-relative path and 1-indexed line.
 * @param diff - Parsed PR diff.
 * @returns Inline comment position, relocated position, or null when no nearby hunk line exists.
 */
export function resolveDiffPosition(
  finding: LineFinding,
  diff: ParsedPullRequestDiff,
): DiffPositionResolution | null {
  const targetPath = normalizePath(finding.filePath);
  if (!targetPath) return null;

  const lines = diff.flatMap(indexFileLines)
    .filter(line => line.path === targetPath);
  if (lines.length === 0) return null;

  const exact = lines.find(line => line.line === finding.line);
  if (exact) {
    return {
      path: exact.path,
      position: exact.position,
      line: exact.line,
      originalLine: finding.line,
      relocated: false,
    };
  }

  const nearest = lines
    .filter(line => Math.abs(line.line - finding.line) <= 5)
    .sort(compareNearest(finding.line))[0];
  if (!nearest) return null;

  return {
    path: nearest.path,
    position: nearest.position,
    line: nearest.line,
    originalLine: finding.line,
    relocated: true,
  };
}
