import { strict as assert } from 'assert';
import * as path from 'path';
import {
  changedNonTestSourceFiles,
  closureLinksChangedSource,
  closureRefutesRestoration,
} from '../../../src/audit/execution-grounded/test-restoration';
import type { ClosureResult } from '../../../src/audit/cheat-detector/test-import-closure';

// Protocol 1 enhancement: the restored (strict) test is only proof of a
// concealed failure when the test actually guards production code the PR
// changed. The relevance gate uses the test's import-graph closure to confirm
// that link. These are the pure pieces of that gate, tested without a sandbox;
// the orchestrator applies them only when a repoRoot is threaded in, so every
// existing caller (which passes none) keeps byte-identical behavior.

// A PR that changes one source file and weakens one test file.
const SOURCE_AND_TEST_DIFF = [
  'diff --git a/src/calc.ts b/src/calc.ts',
  'index 1111111..2222222 100644',
  '--- a/src/calc.ts',
  '+++ b/src/calc.ts',
  '@@ -10,3 +10,3 @@',
  ' export function add(a: number, b: number): number {',
  '-  return a + b;',
  '+  return a + b + 0;',
  ' }',
  'diff --git a/test/calc.test.ts b/test/calc.test.ts',
  'index 3333333..4444444 100644',
  '--- a/test/calc.test.ts',
  '+++ b/test/calc.test.ts',
  '@@ -5,3 +5,2 @@',
  " it('adds', () => {",
  '-  assert.equal(add(2, 2), 4);',
  ' });',
  '',
].join('\n');

const TEST_ONLY_DIFF = [
  'diff --git a/test/calc.test.ts b/test/calc.test.ts',
  'index 3333333..4444444 100644',
  '--- a/test/calc.test.ts',
  '+++ b/test/calc.test.ts',
  '@@ -5,3 +5,2 @@',
  " it('adds', () => {",
  '-  assert.equal(add(2, 2), 4);',
  ' });',
  '',
].join('\n');

describe('execution-grounded / restoration closure-link (Protocol 1 relevance gate)', () => {
  describe('changedNonTestSourceFiles', () => {
    it('returns the non-test production files the PR changed', () => {
      assert.deepEqual(changedNonTestSourceFiles(SOURCE_AND_TEST_DIFF), ['src/calc.ts']);
    });

    it('excludes the changed test files', () => {
      assert.ok(!changedNonTestSourceFiles(SOURCE_AND_TEST_DIFF).includes('test/calc.test.ts'));
    });

    it('returns [] when only test files changed', () => {
      assert.deepEqual(changedNonTestSourceFiles(TEST_ONLY_DIFF), []);
    });
  });

  describe('closureLinksChangedSource', () => {
    const repoRoot = '/repo';

    it('is true when a changed source file is inside the closure', () => {
      const reachable = new Set([path.resolve(repoRoot, 'src/calc.ts')]);
      assert.equal(closureLinksChangedSource(reachable, ['src/calc.ts'], repoRoot), true);
    });

    it('is false when no changed source file is inside the closure', () => {
      const reachable = new Set([path.resolve(repoRoot, 'src/other.ts')]);
      assert.equal(closureLinksChangedSource(reachable, ['src/calc.ts'], repoRoot), false);
    });

    it('is false when the PR changed no production source (fail closed)', () => {
      const reachable = new Set([path.resolve(repoRoot, 'src/calc.ts')]);
      assert.equal(closureLinksChangedSource(reachable, [], repoRoot), false);
    });
  });

  describe('closureRefutesRestoration (safe refuter)', () => {
    const repoRoot = '/repo';
    const closure = (
      reachableRel: string[],
      overrides: Partial<ClosureResult> = {},
    ): ClosureResult => ({
      reachable: new Set(reachableRel.map((r) => path.resolve(repoRoot, r))),
      capped: false,
      unresolvedSpecCount: 0,
      ...overrides,
    });

    it('refutes only when the closure confidently reaches no changed source', () => {
      // Not capped, the PR did change source, and none of it is reachable.
      assert.equal(
        closureRefutesRestoration(closure(['src/other.ts']), ['src/calc.ts'], repoRoot),
        true,
      );
    });

    it('does not refute when the closure reaches a changed source file', () => {
      assert.equal(
        closureRefutesRestoration(closure(['src/calc.ts']), ['src/calc.ts'], repoRoot),
        false,
      );
    });

    it('abstains (no refute) when the closure BFS was capped', () => {
      // A capped closure has optimistic membership; it cannot confidently deny
      // a link, so the behavioral proof stands.
      assert.equal(
        closureRefutesRestoration(closure(['src/other.ts'], { capped: true }), ['src/calc.ts'], repoRoot),
        false,
      );
    });

    it('abstains (no refute) when the PR changed no production source', () => {
      // Nothing to link to; the proof rests on the base/restored controls.
      assert.equal(closureRefutesRestoration(closure(['src/other.ts']), [], repoRoot), false);
    });
  });
});
