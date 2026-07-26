// Pure subdirectory-manifest candidate selection over a git tree listing, for
// the static EG-viability screen. Mirrors the provisioner's manifest discovery
// (src/audit/execution-grounded/manifest-discovery.ts): bounded depth, skip
// node_modules, vendor trees, and dot-directories, a manifest is package.json,
// go.mod, or a Python project with a pytest signal. The screen has no PR diff,
// so it cannot apply the ownership rule; it screens candidates as an upper
// bound on what the provisioner could choose, and says so in its reason.

const SKIPPED_SEGMENTS = new Set(['node_modules', 'bower_components', 'vendor']);
const MAX_DEPTH = 4;

const PY_PROJECT = new Set(['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt']);
const PY_PYTEST = new Set(['pytest.ini', 'tox.ini', 'conftest.py']);

export interface SubdirManifestCandidate {
  /** Repo-relative POSIX directory. */
  dir: string;
  ecosystem: 'node' | 'python' | 'go';
}

function isSkippedPath(dir: string): boolean {
  return dir
    .split('/')
    .some((seg) => seg.startsWith('.') || SKIPPED_SEGMENTS.has(seg));
}

/**
 * Find subdirectory manifest candidates in a repo tree listing, mirroring the
 * provisioner's discovery rules. The repo root ('' dir) is never a candidate:
 * the screen only reaches here when the root already screened manifest-less.
 *
 * @param treePaths repo-relative POSIX file paths (blobs only) from a recursive
 *   git tree listing.
 * @returns candidates sorted shallowest-first, then lexicographically; Node
 *   before Go before Python within one directory (a dir carrying both a
 *   package.json and a go.mod resolves Node-first, matching provisionEcosystem).
 */
export function subdirManifestCandidates(treePaths: readonly string[]): SubdirManifestCandidate[] {
  const filesByDir = new Map<string, Set<string>>();
  const dirsWithSubdirTests = new Set<string>();
  for (const p of treePaths) {
    const slash = p.lastIndexOf('/');
    if (slash < 0) continue;
    const dir = p.slice(0, slash);
    if (dir === '' || isSkippedPath(dir)) continue;
    const depth = dir.split('/').length;
    if (depth <= MAX_DEPTH) {
      const name = p.slice(slash + 1);
      const set = filesByDir.get(dir) ?? new Set<string>();
      set.add(name);
      filesByDir.set(dir, set);
    }
    // A tests/ or test/ directory anywhere below a dir is that dir's pytest
    // signal, matching detectNonNodeRunner's directory check.
    const segments = dir.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      if (segments[i] === 'tests' || segments[i] === 'test') {
        dirsWithSubdirTests.add(segments.slice(0, i).join('/'));
      }
    }
  }
  const out: SubdirManifestCandidate[] = [];
  for (const [dir, names] of filesByDir) {
    if (names.has('package.json')) out.push({ dir, ecosystem: 'node' });
    else if (names.has('go.mod')) out.push({ dir, ecosystem: 'go' });
    else if ([...PY_PROJECT].some((f) => names.has(f))) {
      const pytestSignal =
        [...PY_PYTEST].some((f) => names.has(f)) || dirsWithSubdirTests.has(dir);
      if (pytestSignal) out.push({ dir, ecosystem: 'python' });
    }
  }
  return out.sort((a, b) => {
    const da = a.dir.split('/').length;
    const db = b.dir.split('/').length;
    if (da !== db) return da - db;
    return a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0;
  });
}
