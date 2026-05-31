// Discovery helper for manifest files in monorepo layouts. Each
// ecosystem reader uses this to find every instance of its manifest
// filename under `repoRoot`, not just the root-level one. The v10.3
// real-corpus run showed that the dominant `mock-of-hallucination`
// false-positive class on enterprise/* monorepos was a root manifest
// that doesn't declare the packages the tests under `enterprise/`
// actually import — the relevant `pyproject.toml` lives one or two
// levels down at `enterprise/pyproject.toml`.

import * as fs from 'fs';
import * as path from 'path';

// Directories we never descend into. node_modules and .git are the
// obvious ones; the rest are language-specific build/cache directories
// that can contain vendored manifests we should not count.
const SKIP_DIRS = new Set<string>([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'venv',
  '.venv',
  'env',
  '.env',
  '.gradle',
  '.idea',
  '.vscode',
  'coverage',
]);

// Sensible cap on how deep we descend. Real monorepos rarely nest
// subprojects more than a couple of levels; capping at 5 keeps the
// walk cheap on huge trees and bounds worst-case latency.
const MAX_DEPTH = 5;

// Per-call cap on manifest matches. A repo with thousands of
// package.json files (e.g. a misconfigured `node_modules`-shaped
// tree) should never push the audit into a multi-second fs walk.
const MAX_MATCHES = 64;

/**
 * Returns every absolute path under `repoRoot` whose basename matches
 * `filename`, up to MAX_MATCHES. Skips SKIP_DIRS and stops descending
 * past MAX_DEPTH. The root-level file (if present) is included.
 *
 * Silent on individual readdir failures — a permission-denied
 * subdirectory in a monorepo should not crash the entire audit.
 */
export function findManifestFiles(repoRoot: string, filename: string): string[] {
  const out: string[] = [];
  walk(repoRoot, filename, 0, out);
  return out;
}

function walk(
  dir: string,
  filename: string,
  depth: number,
  out: string[],
): void {
  if (out.length >= MAX_MATCHES) return;
  if (depth > MAX_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= MAX_MATCHES) return;
    const name = entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      if (name.startsWith('.') && name !== '.github') continue;
      walk(path.join(dir, name), filename, depth + 1, out);
    } else if (entry.isFile() && name === filename) {
      out.push(path.join(dir, name));
    }
  }
}
