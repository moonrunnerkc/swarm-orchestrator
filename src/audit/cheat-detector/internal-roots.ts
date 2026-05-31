// Discovery of "internal module roots" in a project tree: top-level
// directories that look like a code package (Python, JS, Go, etc.)
// so the mock-of-hallucination detector can tell an internal dotted
// path like `enterprise.integrations.foo` from a hallucinated package
// reference.
//
// The wild-PR scan surfaced this gap: OpenHands enterprise tests mock
// modules like `integrations.jira_dc.jira_dc_v1_callback_processor`,
// which is a real internal module at `enterprise/integrations/...`
// inside the repo. The detector previously read manifests and found
// nothing called `integrations` declared as a pypi dep, so it flagged
// the mock as a hallucination. That was a false positive.
//
// The fix is local: enumerate the directories in the repo tree that
// look like code packages, and treat a mocked target as "internal"
// if its top-level dotted segment matches one of those directories.

import * as fs from 'fs';
import * as path from 'path';
import type { File as ParsedDiffFile } from 'parse-diff';

// Directories we never descend into when discovering roots. Same set
// as the manifest finder; replicated here to avoid an import cycle.
const SKIP_DIRS = new Set<string>([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'vendor',
  'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit',
  '.cache', '.turbo', '.parcel-cache', '__pycache__', '.pytest_cache',
  '.mypy_cache', '.tox', 'venv', '.venv', 'env', '.env', '.gradle',
  '.idea', '.vscode', 'coverage',
]);

// Bounded depth. We only need a couple of levels to capture both
// repo-root packages and monorepo subprojects.
const MAX_DEPTH = 3;
const MAX_ROOTS = 256;

// Optional sidecar file produced by `--pr` audits. When the audit
// can't access the target repo locally (e.g. cwd is a different
// project), the audit-handler fetches the repo's tree via the GitHub
// API and writes the list of directory names here so this collector
// has something to work with.
const SIDECAR_FILE = '.swarm-internal-roots.txt';

/**
 * Returns the set of directory names found under `repoRoot` that
 * plausibly host code packages, plus any names listed in the
 * `.swarm-internal-roots.txt` sidecar (written by `--pr` audits).
 *
 * Each entry is a bare directory name (no path), e.g. `enterprise`,
 * `server`, `integrations`. Used by mock-of-hallucination to decide
 * whether a dotted mock target resolves against the project's own
 * internal module layout rather than against a published package.
 */
export function collectInternalRoots(repoRoot: string): Set<string> {
  const out = new Set<string>();
  walk(repoRoot, 0, out);
  readSidecar(repoRoot, out);
  return out;
}

/**
 * Returns internal roots derived purely from the paths touched by the
 * diff under audit. Every directory segment of every changed file is a
 * candidate root, so a mock target like `routers.servers.os.makedirs`
 * resolves as internal whenever the PR also touches a `routers/`
 * directory.
 *
 * This complements `collectInternalRoots`, which reads the filesystem:
 * the filesystem is the target repo only for `--repo-root` audits and
 * the sidecar-backed `--pr` path. When the scorer or a bare `--diff-file`
 * run points `repoRoot` at an unrelated directory, the diff is the only
 * trustworthy source of the project's own module layout.
 */
export function collectInternalRootsFromFiles(files: readonly ParsedDiffFile[]): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    const p = file.to ?? file.from ?? '';
    if (p.length === 0) continue;
    const segments = p.split(/[/\\]/);
    // Drop the final segment (the filename) and keep directory names.
    for (let i = 0; i < segments.length - 1; i += 1) {
      const name = segments[i];
      if (name === undefined) continue;
      if (name.length === 0 || name === '.' || name === '..') continue;
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      out.add(name);
      if (out.size >= MAX_ROOTS) return out;
    }
  }
  return out;
}

function readSidecar(repoRoot: string, out: Set<string>): void {
  try {
    const file = path.join(repoRoot, SIDECAR_FILE);
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const name = raw.trim();
      if (name.length > 0) out.add(name);
    }
  } catch {
    // Sidecar is an optimization; silent on read failure.
  }
}

function walk(dir: string, depth: number, out: Set<string>): void {
  if (out.size >= MAX_ROOTS) return;
  if (depth > MAX_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.size >= MAX_ROOTS) return;
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith('.')) continue;
    out.add(name);
    walk(path.join(dir, name), depth + 1, out);
  }
}

/**
 * Returns true if the dotted-or-slashed module target resolves
 * against one of the project's internal directory roots. Compares
 * the top-level segment (the first component before the first dot,
 * slash, or colon) against the discovered root set.
 */
export function resolvesToInternalRoot(target: string, roots: Set<string>): boolean {
  if (roots.size === 0) return false;
  const top = topLevelSegment(target);
  if (top.length === 0) return false;
  return roots.has(top);
}

function topLevelSegment(target: string): string {
  // Strip a leading `@scope/` style prefix; only the second component
  // would meaningfully match an internal directory anyway, and the
  // existing detector logic already routes `@scope/` paths to npm.
  if (target.startsWith('@')) return '';
  const idx = target.search(/[./\\:]/);
  return idx < 0 ? target : target.slice(0, idx);
}
