// Content-addressed cache for the expensive execution-grounded checks. A
// mutation run or a coverage run can take minutes; corroboration cannot run on
// every PR without skipping the work when the inputs have not changed. Modeled
// on the LLM-judge cache: one JSON file per key, keyed only on content, so the
// same (repo, head sha, changed-line ranges, toolchain) returns the same result
// across runs.
//
// On by default; SWARM_EG_NO_CACHE opts out. The cache lives outside the
// throwaway workspace (default `.swarm/eg-cache/`, which is gitignored) so it
// survives the run that produced it.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ChangedLineRanges } from '../cheat-detector/diff-walker';

export interface EgCacheContext {
  /** "owner/name" of the audited repo. */
  repo: string;
  /** Head commit sha of the audited PR. */
  headSha: string;
  /** Directory the cache files live in, persistent across runs. */
  dir: string;
}

/** Cache is on unless SWARM_EG_NO_CACHE is set to a non-empty value. */
export function egCacheEnabled(): boolean {
  const value = process.env.SWARM_EG_NO_CACHE;
  return value === undefined || value.length === 0;
}

export interface EgCacheKeyInput {
  repo: string;
  headSha: string;
  changedLines: ChangedLineRanges;
  /** Package manager plus test runner, e.g. `npm/mocha`. Two toolchains can
   *  produce different results on the same code. */
  toolchain: string;
  check: 'mutation' | 'coverage';
}

/** The cache key: a sha256 over the content tuple. Order-independent in the
 *  changed-line ranges so two equivalent diffs hash identically. */
export function computeEgCacheKey(input: EgCacheKeyInput): string {
  const rangesSha = sha256(canonicalRanges(input.changedLines));
  return sha256(`${input.repo}|${input.headSha}|${rangesSha}|${input.toolchain}|${input.check}`);
}

interface EgCacheFile<T> {
  schemaVersion: 1;
  recordedAt: string;
  key: string;
  value: T;
}

/** Read a cached value, or undefined on a miss or an unreadable/old-schema file. */
export function readEgCache<T>(ctx: EgCacheContext, key: string): T | undefined {
  const file = path.join(ctx.dir, `${key}.json`);
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as EgCacheFile<T>;
    if (parsed.schemaVersion !== 1) return undefined;
    return parsed.value;
  } catch {
    return undefined;
  }
}

/** Write a value under the key. Creates the cache directory as needed. */
export function writeEgCache<T>(ctx: EgCacheContext, key: string, value: T): void {
  const file = path.join(ctx.dir, `${key}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out: EgCacheFile<T> = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    key,
    value,
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
}

/** Stable string for a changed-line-range map: files sorted, ranges sorted. */
function canonicalRanges(ranges: ChangedLineRanges): string {
  return Object.keys(ranges)
    .sort()
    .map((file) => {
      const rs = (ranges[file] ?? [])
        .map((r) => `${r.start}-${r.end}`)
        .sort()
        .join(',');
      return `${file}:${rs}`;
    })
    .join(';');
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
