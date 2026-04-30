export interface ParsedDiffLine {
  kind: 'add' | 'remove' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface ParsedDiffFile {
  oldPath: string;
  newPath: string;
  lines: ParsedDiffLine[];
}

const TEST_FILE_RE = /(^|\/)(test|tests|__tests__)(\/|$)|(?:\.test|\.spec)\.[cm]?[jt]sx?$|(^|\/)test_.*\.py$|_test\.py$/;

function parsePath(raw: string): string {
  return raw === '/dev/null' ? raw : raw.replace(/^[ab]\//, '');
}

/**
 * Return true when a repo-relative path is a common test file path.
 *
 * @param filePath - Repo-relative file path.
 * @returns Whether the file is test-owned.
 */
export function isTestFilePath(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath);
}

/**
 * Parse a unified git diff into per-file line records.
 *
 * @param diffText - Unified diff text.
 * @returns Parsed file sections with added and removed line numbers.
 */
export function parseUnifiedDiff(diffText: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diffText.split('\n')) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header?.[1] && header[2]) {
      current = { oldPath: header[1], newPath: header[2], lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (line.startsWith('--- ')) {
      current.oldPath = parsePath(line.slice(4).trim());
      continue;
    }
    if (line.startsWith('+++ ')) {
      current.newPath = parsePath(line.slice(4).trim());
      continue;
    }

    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk?.[1] && hunk[2]) {
      oldLine = Number.parseInt(hunk[1], 10);
      newLine = Number.parseInt(hunk[2], 10);
      continue;
    }

    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) {
      continue;
    }

    if (line.startsWith('+')) {
      current.lines.push({ kind: 'add', content: line.slice(1), newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.lines.push({ kind: 'remove', content: line.slice(1), oldLine });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      current.lines.push({ kind: 'context', content: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return files;
}

/**
 * Extract simple string and numeric literals from one source line.
 *
 * @param line - Source line.
 * @returns Literal values without quotes.
 */
export function extractLiterals(line: string): string[] {
  const literals = new Set<string>();
  for (const match of line.matchAll(/(['"`])([^'"`]{2,})\1/g)) {
    if (match[2]) literals.add(match[2]);
  }
  for (const match of line.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    if (match[0]) literals.add(match[0]);
  }
  return [...literals];
}
