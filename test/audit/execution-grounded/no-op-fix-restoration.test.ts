import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import {
  classifyNoOpFixRestoration,
  extractSourceRevertPatch,
  selectAffectedTestFiles,
  type NoOpFixVerdict,
} from '../../../src/audit/execution-grounded/no-op-fix-restoration';

// A PR that claims a fix: it edits one source file and one (unrelated) test
// file. Reverting the source hunk is the counterfactual: if no affected test
// fails with the "fix" gone, the suite never verified it.
const PR_DIFF = [
  'diff --git a/src/calc.ts b/src/calc.ts',
  'index 1111111..2222222 100644',
  '--- a/src/calc.ts',
  '+++ b/src/calc.ts',
  '@@ -10,3 +10,3 @@',
  ' export function add(a: number, b: number): number {',
  '-  return a + b;',
  '+  return a + b; // tidy',
  ' }',
  'diff --git a/test/unrelated.test.ts b/test/unrelated.test.ts',
  'index 3333333..4444444 100644',
  '--- a/test/unrelated.test.ts',
  '+++ b/test/unrelated.test.ts',
  '@@ -5,2 +5,3 @@',
  " it('still true', () => {",
  '+  assert.ok(true);',
  ' });',
  '',
].join('\n');

const TEST_ONLY_DIFF = [
  'diff --git a/test/unrelated.test.ts b/test/unrelated.test.ts',
  'index 3333333..4444444 100644',
  '--- a/test/unrelated.test.ts',
  '+++ b/test/unrelated.test.ts',
  '@@ -5,2 +5,3 @@',
  " it('still true', () => {",
  '+  assert.ok(true);',
  ' });',
  '',
].join('\n');

describe('execution-grounded / no-op-fix-restoration (pure core)', () => {
  describe('extractSourceRevertPatch', () => {
    it('lifts only the non-test source hunks as a round-tripping unified diff', () => {
      const patch = extractSourceRevertPatch(PR_DIFF);
      assert.notEqual(patch, null);
      assert.ok(patch!.includes('src/calc.ts'), 'the source file is present');
      assert.ok(!patch!.includes('test/unrelated.test.ts'), 'the test file is absent');
      assert.ok(patch!.endsWith('\n'), 'patch ends with a newline so git apply accepts it');
      const reparsed = parseDiff(patch!);
      assert.equal(reparsed.length, 1, 'only the one source file');
      assert.equal(reparsed[0]!.to, 'src/calc.ts');
    });

    it('returns null when the PR changed no non-test source', () => {
      assert.equal(extractSourceRevertPatch(TEST_ONLY_DIFF), null);
    });
  });

  describe('classifyNoOpFixRestoration', () => {
    const verdict = (c: {
      suitePassesAsSubmitted: boolean;
      revertedRun1Passed: boolean;
      revertedRun2Passed: boolean;
    }): NoOpFixVerdict => classifyNoOpFixRestoration(c).verdict;

    it('is suite-already-failing when the PR suite does not pass as submitted', () => {
      assert.equal(
        verdict({ suitePassesAsSubmitted: false, revertedRun1Passed: true, revertedRun2Passed: true }),
        'not-proven:suite-already-failing',
      );
    });

    it('is proven when the affected tests still pass twice with the fix reverted', () => {
      assert.equal(
        verdict({ suitePassesAsSubmitted: true, revertedRun1Passed: true, revertedRun2Passed: true }),
        'proven',
      );
    });

    it('is refuted when reverting the fix breaks an affected test (the fix is verified)', () => {
      assert.equal(
        verdict({ suitePassesAsSubmitted: true, revertedRun1Passed: false, revertedRun2Passed: false }),
        'refuted',
      );
    });

    it('is flaky when the two reverted runs disagree', () => {
      assert.equal(
        verdict({ suitePassesAsSubmitted: true, revertedRun1Passed: true, revertedRun2Passed: false }),
        'not-proven:flaky',
      );
    });
  });

  describe('selectAffectedTestFiles', () => {
    let repoRoot: string;

    beforeEach(() => {
      repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-noop-closure-'));
      fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, 'test'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'src', 'calc.ts'), 'export const add = (a, b) => a + b;\n');
      fs.writeFileSync(path.join(repoRoot, 'src', 'other.ts'), 'export const sub = (a, b) => a - b;\n');
      // Reaches src/calc.ts.
      fs.writeFileSync(
        path.join(repoRoot, 'test', 'calc.test.ts'),
        "import { add } from '../src/calc';\nadd(1, 2);\n",
      );
      // Reaches src/other.ts only.
      fs.writeFileSync(
        path.join(repoRoot, 'test', 'other.test.ts'),
        "import { sub } from '../src/other';\nsub(2, 1);\n",
      );
    });

    afterEach(() => {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('selects only the tests whose closure reaches a reverted source file', () => {
      const result = selectAffectedTestFiles(repoRoot, ['src/calc.ts']);
      assert.deepEqual(result.affected, ['test/calc.test.ts']);
      assert.equal(result.capped, false);
    });

    it('returns no affected tests when none reach the reverted source', () => {
      const result = selectAffectedTestFiles(repoRoot, ['src/nonexistent.ts']);
      assert.deepEqual(result.affected, []);
    });

    it('returns [] for a repoRoot that does not exist (fail closed)', () => {
      const result = selectAffectedTestFiles(path.join(repoRoot, 'gone'), ['src/calc.ts']);
      assert.deepEqual(result.affected, []);
    });
  });
});
