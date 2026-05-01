import * as path from 'path';

export interface SourceLocation {
  filePath: string;
  line: number;
}

const SOURCE_LOCATION_RE = /((?:[A-Za-z]:)?(?:\.{0,2}\/|\/)?[A-Za-z0-9_.@/-]+\.(?:[cm]?[jt]sx?|py|java)):(\d+)(?::\d+)?/g;

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeLocationPath(rawPath: string, repoPath: string): string | undefined {
  const trimmed = rawPath.replace(/^[([]/, '').replace(/[),\]]$/, '');
  const relative = path.isAbsolute(trimmed)
    ? path.relative(repoPath, trimmed)
    : trimmed.replace(/^\.\//, '');
  const normalized = normalizeSlashes(relative);
  if (normalized === '' || normalized.startsWith('../') || normalized === '..') {
    return undefined;
  }
  return normalized;
}

function matchesCandidate(filePath: string, candidateFiles: readonly string[] | undefined): boolean {
  if (!candidateFiles || candidateFiles.length === 0) return true;
  return candidateFiles.some(candidate => {
    const normalized = normalizeSlashes(candidate);
    return filePath === normalized || filePath.endsWith(`/${normalized}`);
  });
}

/**
 * Extract source file locations from command output.
 *
 * @param output - Combined stdout and stderr from a verification command.
 * @param repoPath - Repository root used to normalize absolute paths.
 * @param candidateFiles - Optional repo-relative files to keep.
 * @returns Deduplicated repo-relative source locations.
 */
export function extractSourceLocations(
  output: string,
  repoPath: string,
  candidateFiles?: readonly string[],
): SourceLocation[] {
  const locations: SourceLocation[] = [];
  const seen = new Set<string>();

  for (const match of output.matchAll(SOURCE_LOCATION_RE)) {
    const rawPath = match[1];
    const rawLine = match[2];
    if (!rawPath || !rawLine) continue;
    const filePath = normalizeLocationPath(rawPath, repoPath);
    const line = Number.parseInt(rawLine, 10);
    if (!filePath || !Number.isInteger(line) || line < 1) continue;
    if (!matchesCandidate(filePath, candidateFiles)) continue;
    const key = `${filePath}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({ filePath, line });
  }

  return locations;
}
