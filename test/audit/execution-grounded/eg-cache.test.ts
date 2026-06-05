import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeEgCacheKey,
  egCacheEnabled,
  readEgCache,
  writeEgCache,
  type EgCacheContext,
} from '../../../src/audit/execution-grounded/eg-cache';
import { runMutationCheck, type MutationRunOutcome } from '../../../src/audit/execution-grounded/mutation-check';
import { computeCoverageDelta } from '../../../src/audit/execution-grounded/coverage-delta';
import type { ChangedLineRanges } from '../../../src/audit/cheat-detector/diff-walker';

function ctx(): EgCacheContext {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-eg-cache-'));
  return { repo: 'o/r', headSha: 'a'.repeat(40), dir };
}

const CHANGED: ChangedLineRanges = { 'src/a.ts': [{ start: 1, end: 5 }] };

describe('execution-grounded / eg-cache', () => {
  describe('computeEgCacheKey', () => {
    it('is stable for identical inputs and order-independent in the ranges', () => {
      const a = computeEgCacheKey({ repo: 'o/r', headSha: 'h', changedLines: { 'a.ts': [{ start: 1, end: 2 }], 'b.ts': [{ start: 3, end: 4 }] }, toolchain: 'npm/mocha', check: 'mutation' });
      const b = computeEgCacheKey({ repo: 'o/r', headSha: 'h', changedLines: { 'b.ts': [{ start: 3, end: 4 }], 'a.ts': [{ start: 1, end: 2 }] }, toolchain: 'npm/mocha', check: 'mutation' });
      assert.equal(a, b);
    });
    it('differs on repo, sha, ranges, toolchain, and check', () => {
      const base = { repo: 'o/r', headSha: 'h', changedLines: CHANGED, toolchain: 'npm/mocha', check: 'mutation' as const };
      const k = computeEgCacheKey(base);
      assert.notEqual(k, computeEgCacheKey({ ...base, repo: 'o/x' }));
      assert.notEqual(k, computeEgCacheKey({ ...base, headSha: 'g' }));
      assert.notEqual(k, computeEgCacheKey({ ...base, toolchain: 'pnpm/vitest' }));
      assert.notEqual(k, computeEgCacheKey({ ...base, check: 'coverage' }));
      assert.notEqual(k, computeEgCacheKey({ ...base, changedLines: { 'src/a.ts': [{ start: 1, end: 6 }] } }));
    });
  });

  describe('read/write', () => {
    it('round-trips a value and misses on an unknown key', () => {
      const c = ctx();
      assert.equal(readEgCache(c, 'nope'), undefined);
      writeEgCache(c, 'k1', { hello: 'world', n: 7 });
      assert.deepEqual(readEgCache(c, 'k1'), { hello: 'world', n: 7 });
    });
  });

  describe('egCacheEnabled', () => {
    const saved = process.env.SWARM_EG_NO_CACHE;
    afterEach(() => {
      if (saved === undefined) delete process.env.SWARM_EG_NO_CACHE;
      else process.env.SWARM_EG_NO_CACHE = saved;
    });
    it('is on by default and off when SWARM_EG_NO_CACHE is set', () => {
      delete process.env.SWARM_EG_NO_CACHE;
      assert.equal(egCacheEnabled(), true);
      process.env.SWARM_EG_NO_CACHE = '1';
      assert.equal(egCacheEnabled(), false);
    });
  });

  // The acceptance: a second run with identical inputs returns the cached
  // result without spawning. The workspace path does not exist, so a real run
  // could only ever produce ran:false; a ran:true sentinel proves the hit.
  describe('runMutationCheck cache hit skips the spawn', () => {
    const saved = process.env.SWARM_EG_NO_CACHE;
    afterEach(() => {
      if (saved === undefined) delete process.env.SWARM_EG_NO_CACHE;
      else process.env.SWARM_EG_NO_CACHE = saved;
    });

    it('returns the cached outcome instead of running Stryker', () => {
      delete process.env.SWARM_EG_NO_CACHE;
      const c = ctx();
      const sentinel: MutationRunOutcome = {
        ran: true,
        results: [{ file: 'src/a.ts', line: 3, mutator: 'BlockStatement', killed: false, status: 'Survived' }],
        summary: { total: 1, killed: 0, survived: 1, noCoverage: 0, errored: 0 },
        scope: { patterns: ['src/a.ts:1-5'], includedLines: 5, droppedLines: 0 },
      };
      const key = computeEgCacheKey({ repo: c.repo, headSha: c.headSha, changedLines: CHANGED, toolchain: 'npm/mocha', check: 'mutation' });
      writeEgCache(c, key, sentinel);

      const outcome = runMutationCheck({
        workspacePath: '/does/not/exist',
        changedLines: CHANGED,
        testRunner: 'mocha',
        packageManager: 'npm',
        cache: c,
      });
      assert.equal(outcome.ran, true, 'cache hit, not a fresh run on the missing workspace');
      assert.deepEqual(outcome.results, sentinel.results);
    });

    it('does not hit the cache when SWARM_EG_NO_CACHE is set', () => {
      process.env.SWARM_EG_NO_CACHE = '1';
      const c = ctx();
      const key = computeEgCacheKey({ repo: c.repo, headSha: c.headSha, changedLines: CHANGED, toolchain: 'npm/mocha', check: 'mutation' });
      writeEgCache(c, key, { ran: true, results: [], summary: { total: 0, killed: 0, survived: 0, noCoverage: 0, errored: 0 }, scope: { patterns: [], includedLines: 0, droppedLines: 0 } });

      const outcome = runMutationCheck({
        workspacePath: '/does/not/exist',
        changedLines: CHANGED,
        testRunner: 'mocha',
        packageManager: 'npm',
        cache: c,
      });
      // Opt-out forces a real run, which fails to install on the missing
      // workspace and reports ran:false rather than serving the cached ran:true.
      assert.equal(outcome.ran, false);
    });
  });

  describe('computeCoverageDelta cache hit reconstructs the coverage map', () => {
    it('returns a deserialized outcome with a rebuilt CoverageMap', () => {
      delete process.env.SWARM_EG_NO_CACHE;
      const c = ctx();
      const key = computeEgCacheKey({ repo: c.repo, headSha: c.headSha, changedLines: CHANGED, toolchain: 'npm/mocha', check: 'coverage' });
      // The stored shape is the serialized outcome (Sets flattened to arrays).
      writeEgCache(c, key, {
        ran: true,
        deltas: [{ file: 'src/a.ts', line: 3, addedOrModified: true, coveredAfter: false }],
        coverage: [['src/a.ts', { instrumented: [1, 2, 3], covered: [1, 2] }]],
      });

      const outcome = computeCoverageDelta({
        workspacePath: '/does/not/exist',
        testRunner: 'mocha',
        changedLines: CHANGED,
        packageManager: 'npm',
        cache: c,
      });
      assert.equal(outcome.ran, true);
      assert.deepEqual(outcome.deltas, [{ file: 'src/a.ts', line: 3, addedOrModified: true, coveredAfter: false }]);
      assert.ok(outcome.coverage instanceof Map, 'CoverageMap rebuilt from the cache');
      assert.deepEqual([...(outcome.coverage!.get('src/a.ts')?.covered ?? [])], [1, 2]);
    });
  });
});
