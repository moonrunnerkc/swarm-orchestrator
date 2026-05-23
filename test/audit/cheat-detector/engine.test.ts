import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCheatDetectors, DETECTORS } from '../../../src/audit/cheat-detector';

const CLEAN_DIFF = `diff --git a/src/add.ts b/src/add.ts
--- a/src/add.ts
+++ b/src/add.ts
@@ -1,3 +1,4 @@
 export function add(a: number, b: number): number {
+  if (a < 0 || b < 0) throw new Error('non-negative only');
   return a + b;
 }
diff --git a/test/add.test.ts b/test/add.test.ts
--- a/test/add.test.ts
+++ b/test/add.test.ts
@@ -1,4 +1,6 @@
 import { add } from '../src/add';
 it('adds positives', () => {
   expect(add(2, 3)).toBe(5);
+  expect(add(0, 0)).toBe(0);
 });
+it('rejects negatives', () => { expect(() => add(-1, 0)).toThrow(); });
`;

const RELAXED_DIFF = `diff --git a/test/add.test.ts b/test/add.test.ts
--- a/test/add.test.ts
+++ b/test/add.test.ts
@@ -1,3 +1,3 @@
 it('adds', () => {
-  expect(add(2,3)).toBe(5);
+  expect(add(2,3)).toBeDefined();
 });
`;

describe('cheat-detector engine', () => {
  it('exposes a stable, non-empty detector registry', () => {
    assert.ok(DETECTORS.length >= 10);
    const names = DETECTORS.map((d) => d.name);
    assert.deepEqual(
      names.sort(),
      [
        'assertion-strip',
        'comment-only-fix',
        'coverage-erosion',
        'dead-branch-insertion',
        'error-swallow',
        'exception-rethrow-lost-context',
        'fake-refactor',
        'mock-of-hallucination',
        'no-op-fix',
        'test-relaxation',
      ].sort(),
    );
  });

  it('returns pass:true on a clean PR', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-engine-'));
    const result = runCheatDetectors({ unifiedDiff: CLEAN_DIFF, repoRoot: repo });
    assert.equal(result.pass, true);
  });

  it('returns pass:false when any detector reports a blocking finding', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-engine-'));
    const result = runCheatDetectors({ unifiedDiff: RELAXED_DIFF, repoRoot: repo });
    assert.equal(result.pass, false);
    assert.ok(result.findings.some((f) => f.category === 'test-relaxation'));
  });

  it('carries detectorVersions into the result', () => {
    const result = runCheatDetectors({ unifiedDiff: CLEAN_DIFF, repoRoot: '.' });
    for (const det of DETECTORS) {
      assert.equal(result.detectorVersions[det.name], det.version);
    }
  });

  it('attaches agent attribution and PR metadata when provided', () => {
    const result = runCheatDetectors({
      unifiedDiff: CLEAN_DIFF,
      repoRoot: '.',
      agent: { vendor: 'claude-code', confidence: 'high', source: 'bot-author' },
      pr: {
        number: 123,
        headSha: 'abc',
        baseSha: 'def',
        title: 'fix: test',
        body: 'Generated with Claude Code',
        author: 'claude-code[bot]',
        headRef: 'claude/fix-1',
        repository: 'owner/repo',
      },
    });
    assert.equal(result.agent?.vendor, 'claude-code');
    assert.equal(result.pr?.number, 123);
  });
});
