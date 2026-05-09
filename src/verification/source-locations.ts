import * as fs from 'fs';
import * as path from 'path';

export interface SourceLocation {
  filePath: string;
  line: number;
}

const SOURCE_LOCATION_RE = /((?:[A-Za-z]:)?(?:\.{0,2}\/|\/)?[A-Za-z0-9_.@/-]+\.(?:[cm]?[jt]sx?|py|java)):(\d+)(?::\d+)?/g;

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * Resolve symlinks in `value` if it exists on disk; otherwise return the
 * input unchanged. Defends against the macOS `/var` -> `/private/var`
 * divergence: Node stack traces contain the realpath form, but callers
 * usually hand us the un-resolved tmpdir form, and `path.relative` between
 * the two produces a `../`-prefixed string that downstream filters drop.
 */
function tryRealpath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return value;
  }
}

function normalizeLocationPath(
  rawPath: string,
  repoPath: string,
  repoPathReal: string,
): string | undefined {
  const trimmed = rawPath.replace(/^[([]/, '').replace(/[),\]]$/, '');
  let relative: string;
  if (path.isAbsolute(trimmed)) {
    const trimmedReal = tryRealpath(trimmed);
    const candidates = [
      path.relative(repoPath, trimmed),
      path.relative(repoPathReal, trimmed),
      path.relative(repoPath, trimmedReal),
      path.relative(repoPathReal, trimmedReal),
    ];
    const inside = candidates.find(
      (c) => c !== '' && !c.startsWith('..' + path.sep) && c !== '..',
    );
    relative = inside ?? candidates[0] ?? trimmed;
  } else {
    relative = trimmed.replace(/^\.\//, '');
  }
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
  const repoPathReal = tryRealpath(repoPath);

  for (const match of output.matchAll(SOURCE_LOCATION_RE)) {
    const rawPath = match[1];
    const rawLine = match[2];
    if (!rawPath || !rawLine) continue;
    const filePath = normalizeLocationPath(rawPath, repoPath, repoPathReal);
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
