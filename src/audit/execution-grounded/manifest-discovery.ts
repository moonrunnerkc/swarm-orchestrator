// Subdirectory manifest discovery for the sandbox provisioner. The B1
// instrumentation measured the dominant install-failure class as npm exit 254,
// ENOENT no package.json at the clone root: repos whose manifest lives in a
// subdirectory (an app/ or packages/x tree with no root manifest). This module
// finds candidate manifest directories below the root and picks the one that
// owns the PR's changed files, the same ownership idea monorepo.ts uses to
// locate a workspace package. Pure directory walking and path arithmetic; the
// caller supplies the "is this a manifest dir" predicate and acts on the choice.

import * as fs from 'fs';
import * as path from 'path';

/** Directory names never descended into: dependency trees, vendored code, and
 *  dot-directories (VCS metadata, tool caches). */
const SKIPPED_DIR_NAMES = new Set(['node_modules', 'bower_components', 'vendor']);

const DEFAULT_MAX_DEPTH = 4;
/** Hard cap on directories visited, so a pathological tree stays bounded. */
const MAX_DIRS_VISITED = 2000;

/**
 * Breadth-first discovery of manifest directories below a workspace root. The
 * root itself is never returned (the caller only discovers when the root has no
 * manifest). Skips node_modules, vendor trees, and dot-directories; bounded by
 * depth and by total directories visited.
 *
 * @param workspacePath the clone root.
 * @param isManifestDir predicate deciding whether an absolute directory carries
 *   a provisionable manifest (package.json, go.mod, or a pytest-capable Python
 *   project, per the caller's ecosystem support).
 * @param opts.maxDepth how many levels below the root to search (default 4).
 * @returns repo-relative POSIX paths of manifest directories, sorted.
 */
export function discoverManifestDirs(
  workspacePath: string,
  isManifestDir: (absDir: string) => boolean,
  opts?: { maxDepth?: number },
): string[] {
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const found: string[] = [];
  let visited = 0;
  const queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }];
  while (queue.length > 0) {
    const { rel, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    const abs = rel === '' ? workspacePath : path.join(workspacePath, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || SKIPPED_DIR_NAMES.has(entry.name)) continue;
      if (visited >= MAX_DIRS_VISITED) return found.sort();
      visited += 1;
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (isManifestDir(path.join(workspacePath, childRel))) found.push(childRel);
      queue.push({ rel: childRel, depth: depth + 1 });
    }
  }
  return found.sort();
}

/** How the choice was made, recorded for provenance and the tests. */
export type ManifestChoiceStrategy = 'sole-owner' | 'deepest-common-owner' | 'most-owned-files';

export type ManifestResolution =
  | {
      kind: 'chosen';
      /** Repo-relative POSIX path of the manifest directory to provision in. */
      manifestDir: string;
      strategy: ManifestChoiceStrategy;
      /** How many of the PR's changed files fall under a discovered manifest. */
      ownedChangedFiles: number;
    }
  | { kind: 'no-manifest-found' }
  | { kind: 'no-manifest-for-diff'; candidates: string[] };

function depthOf(dir: string): number {
  return dir.split('/').length;
}

function isUnder(file: string, dir: string): boolean {
  return file.startsWith(`${dir}/`);
}

/**
 * Choose the manifest directory that owns the PR's changed files. A file's
 * owner is its deepest candidate ancestor. With one owning candidate the choice
 * is direct; with several, the deepest candidate that is an ancestor of every
 * owned file wins (the enclosing workspace); when the owners are disjoint, the
 * candidate owning the most changed files wins, tie-broken lexicographically so
 * the choice is deterministic.
 *
 * @param candidates repo-relative manifest directories from discovery.
 * @param changedFiles repo-relative paths the PR changed; undefined or empty
 *   means ownership cannot be established, which resolves to
 *   `no-manifest-for-diff` (the spec forbids provisioning an unowned guess).
 * @returns the resolution: a chosen directory or one of the two miss buckets.
 */
export function chooseManifestDir(
  candidates: readonly string[],
  changedFiles: readonly string[] | undefined,
): ManifestResolution {
  if (candidates.length === 0) return { kind: 'no-manifest-found' };
  const files = (changedFiles ?? []).map((f) => f.split(path.sep).join('/'));
  const ownedFiles = files.filter((f) => candidates.some((c) => isUnder(f, c)));
  if (ownedFiles.length === 0) return { kind: 'no-manifest-for-diff', candidates: [...candidates] };

  const deepestOwnedCount = new Map<string, number>();
  for (const file of ownedFiles) {
    const owner = candidates
      .filter((c) => isUnder(file, c))
      .reduce((best, c) => (depthOf(c) > depthOf(best) ? c : best));
    deepestOwnedCount.set(owner, (deepestOwnedCount.get(owner) ?? 0) + 1);
  }
  const owners = [...deepestOwnedCount.keys()];
  if (owners.length === 1) {
    return {
      kind: 'chosen',
      manifestDir: owners[0]!,
      strategy: 'sole-owner',
      ownedChangedFiles: ownedFiles.length,
    };
  }
  // Several packages own changed files: prefer the deepest candidate that
  // encloses every owned file (typically the workspace directory above them).
  const commonOwners = candidates.filter((c) => ownedFiles.every((f) => isUnder(f, c)));
  if (commonOwners.length > 0) {
    const deepestCommon = commonOwners.reduce((best, c) => (depthOf(c) > depthOf(best) ? c : best));
    return {
      kind: 'chosen',
      manifestDir: deepestCommon,
      strategy: 'deepest-common-owner',
      ownedChangedFiles: ownedFiles.length,
    };
  }
  const mostOwned = owners.reduce((best, c) => {
    const cn = deepestOwnedCount.get(c)!;
    const bn = deepestOwnedCount.get(best)!;
    if (cn !== bn) return cn > bn ? c : best;
    return c < best ? c : best;
  });
  return {
    kind: 'chosen',
    manifestDir: mostOwned,
    strategy: 'most-owned-files',
    ownedChangedFiles: ownedFiles.length,
  };
}
