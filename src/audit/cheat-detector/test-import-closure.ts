// Compute the *import-graph closure* of a set of test files: every
// source file reachable by following TS/JS/Python import edges from
// any of the given test entry points. Used by the no-op-fix detector
// to decide whether a touched source file is actually covered by any
// test in the repo, replacing the v10 basename `text.includes(stem)`
// heuristic that false-positived on common names like `utils`.
//
// We delegate import-spec extraction to `extractImports` in
// `src/verification/ast-imports.ts` (TypeScript via the compiler API,
// Python via a `python3` subprocess that falls back to regex when
// python3 isn't on PATH) and import-spec *resolution* to the local
// `import-resolver.ts`.
//
// All caches live inside the call; no module-level state, because
// leaderboard scoring runs many audits in one process and shared
// caches would leak repo content across runs.
//
// The function is synchronous: every primitive it depends on
// (`extractImports` uses the TypeScript compiler API for TS/JS and
// `spawnSync(python3, ...)` for Python) is synchronous, and the
// cheat-detector engine's per-detector `run(ctx): Finding[]` contract
// is also sync. Promisifying for its own sake would force the entire
// engine and every existing detector test to become async for no
// real-world concurrency gain.

import * as fs from 'fs';
import * as path from 'path';
import { extractImports } from '../../verification/ast-imports';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';
import { loadRepoConfig, resolveSpec, type RepoConfig } from './import-resolver';

const log = getLogger('test-import-closure');

const DEFAULT_MAX_NODES = 5000;

export interface ClosureOptions {
  maxNodes?: number;
}

export interface ClosureResult {
  /** Absolute paths reachable from any test entry point. */
  reachable: ReadonlySet<string>;
  /** True if BFS hit `maxNodes`; membership is then optimistic. */
  capped: boolean;
  /** Count of import specs the resolver could not follow. */
  unresolvedSpecCount: number;
}

export function reachableSourceFiles(
  testFiles: readonly string[],
  repoRoot: string,
  options: ClosureOptions = {},
): ClosureResult {
  if (!fs.existsSync(repoRoot)) {
    throw new SwarmError(
      `test-import-closure: repoRoot does not exist: ${repoRoot}`,
      'TEST_IMPORT_CLOSURE_NO_REPO',
      { remediation: 'Pass an existing absolute path as repoRoot.' },
    );
  }
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const config = loadRepoConfig(repoRoot);
  const contentCache = new Map<string, string | null>();
  const importCache = new Map<string, string[]>();
  const reachable = new Set<string>();
  const queue: string[] = [];
  let unresolvedSpecCount = 0;
  let capped = false;

  for (const entry of testFiles) {
    const abs = path.isAbsolute(entry) ? entry : path.resolve(repoRoot, entry);
    if (!reachable.has(abs)) {
      reachable.add(abs);
      queue.push(abs);
    }
  }

  while (queue.length > 0) {
    if (reachable.size >= maxNodes) {
      capped = true;
      break;
    }
    const current = queue.shift() as string;
    const body = readCached(current, contentCache);
    if (body === null) continue;
    const specs = importsCached(current, body, importCache);
    for (const spec of specs) {
      const resolved = resolveSpec(current, spec, repoRoot, config);
      if (resolved === undefined) {
        unresolvedSpecCount++;
        continue;
      }
      if (reachable.has(resolved)) continue;
      reachable.add(resolved);
      queue.push(resolved);
      if (reachable.size >= maxNodes) {
        capped = true;
        break;
      }
    }
  }
  return { reachable, capped, unresolvedSpecCount };
}

function readCached(absPath: string, cache: Map<string, string | null>): string | null {
  const hit = cache.get(absPath);
  if (hit !== undefined) return hit;
  try {
    const body = fs.readFileSync(absPath, 'utf8');
    cache.set(absPath, body);
    return body;
  } catch (err) {
    log.debug(`failed to read ${absPath}: ${(err as Error).message}`);
    cache.set(absPath, null);
    return null;
  }
}

function importsCached(
  absPath: string,
  body: string,
  cache: Map<string, string[]>,
): string[] {
  const hit = cache.get(absPath);
  if (hit !== undefined) return hit;
  const result = extractImports(absPath, body);
  if (result.error !== undefined) {
    log.debug(`extractImports degraded for ${absPath}: ${result.error}`);
  }
  cache.set(absPath, result.specs);
  return result.specs;
}

// Re-export so consumers (e.g. no-op-fix) can pre-warm config if they
// ever need to, without reaching into the resolver module directly.
export type { RepoConfig };
