// Monorepo package scoping. The checks run the repo's test suite, but in a
// pnpm/yarn/npm workspace the suite and its runner config live per package,
// not at the repo root. Running Stryker or coverage at the root would mutate
// a package's file while running no tests that import it. This groups a PR's
// changed lines by their owning package (the nearest ancestor package.json)
// so each check runs inside the right package with that package's runner.

import * as fs from 'fs';
import * as path from 'path';
import type { ChangedLineRanges, LineRange } from '../cheat-detector/diff-walker';

export interface PackageScope {
  /** Package directory relative to the workspace root ('' for the root). */
  packageDir: string;
  /** Changed line ranges keyed by path relative to `packageDir`. */
  changedLines: ChangedLineRanges;
}

/** Walk up from a file to the nearest directory containing a package.json,
 *  bounded by the workspace root. Returns the workspace-relative package dir
 *  ('' when the only package.json is at the root or none is found). */
function nearestPackageDir(workspacePath: string, fileRel: string): string {
  let dir = path.dirname(fileRel);
  while (true) {
    const abs = dir === '.' ? workspacePath : path.join(workspacePath, dir);
    if (fs.existsSync(path.join(abs, 'package.json'))) {
      return dir === '.' ? '' : dir;
    }
    if (dir === '.' || dir === '' || dir === path.dirname(dir)) return '';
    dir = path.dirname(dir);
  }
}

/**
 * Group changed line ranges by the package that owns each file. The returned
 * scopes have package-relative file keys, ready to hand to a check whose cwd
 * is the package directory. Files whose package cannot be located fall under
 * the root scope.
 */
export function groupChangedLinesByPackage(
  workspacePath: string,
  changed: ChangedLineRanges,
): PackageScope[] {
  const byPackage = new Map<string, ChangedLineRanges>();
  for (const [fileRel, ranges] of Object.entries(changed)) {
    const pkgDir = nearestPackageDir(workspacePath, fileRel);
    const rel = pkgDir === '' ? fileRel : path.relative(pkgDir, fileRel);
    const normalized = rel.split(path.sep).join('/');
    const bucket = byPackage.get(pkgDir) ?? {};
    bucket[normalized] = ranges as LineRange[];
    byPackage.set(pkgDir, bucket);
  }
  return [...byPackage.entries()].map(([packageDir, changedLines]) => ({ packageDir, changedLines }));
}

/** Re-root a package-relative file path back to workspace-relative, for
 *  reporting a finding against the path the PR diff used. */
export function rerootToRepo(packageDir: string, fileRel: string): string {
  return packageDir === '' ? fileRel : `${packageDir}/${fileRel}`;
}
