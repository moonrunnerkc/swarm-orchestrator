import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import {
  buildReproduceCommand,
  classifyRestoration,
  extractTestHunkPatch,
} from '../../../src/audit/execution-grounded/test-restoration';

// A PR that touches one source file and one test file; the test file has
// two hunks, each deleting an assertion. This is the canonical tampering
// shape the restoration engine reverts.
const PR_DIFF = [
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
  '@@ -20,4 +19,3 @@',
  " it('adds negatives', () => {",
  '-  assert.equal(add(-1, -1), -2);',
  '-  assert.equal(add(-2, 3), 1);',
  '+  assert.ok(true);',
  ' });',
  '',
].join('\n');

interface ChunkShape {
  header: string;
  changes: string[];
}

function chunkShapes(diff: string, file: string): ChunkShape[] {
  const parsed = parseDiff(diff).find((f) => (f.to ?? f.from) === file);
  assert.ok(parsed, `expected ${file} in parsed diff`);
  return parsed.chunks.map((c) => ({
    header: c.content,
    changes: c.changes.map((ch) => ch.content),
  }));
}

describe('execution-grounded / test-restoration extractTestHunkPatch', () => {
  it('extracts only the test file hunks as a standalone unified diff that round-trips', () => {
    const patch = extractTestHunkPatch(PR_DIFF, 'test/calc.test.ts');

    assert.notEqual(patch, null);
    assert.ok(!patch!.includes('src/calc.ts'), 'source file must be absent from the patch');
    assert.ok(patch!.endsWith('\n'), 'patch must end with a newline so git apply accepts it');

    const reparsed = parseDiff(patch!);
    assert.equal(reparsed.length, 1, 'patch must contain exactly one file');
    assert.equal(reparsed[0]!.to, 'test/calc.test.ts');
    // Structural round-trip: re-parsing yields the same hunks as the original.
    assert.deepEqual(
      chunkShapes(patch!, 'test/calc.test.ts'),
      chunkShapes(PR_DIFF, 'test/calc.test.ts'),
    );
  });

  it('returns null when the finding file is not present in the diff', () => {
    assert.equal(extractTestHunkPatch(PR_DIFF, 'test/missing.test.ts'), null);
  });

  it('returns null when the finding file is not a test file', () => {
    // src/calc.ts is in the diff but is a source file; isTestFile gates it out.
    assert.equal(extractTestHunkPatch(PR_DIFF, 'src/calc.ts'), null);
  });

  it('preserves every hunk of a multi-hunk test file with correct @@ headers', () => {
    const patch = extractTestHunkPatch(PR_DIFF, 'test/calc.test.ts');

    assert.notEqual(patch, null);
    const chunks = parseDiff(patch!)[0]!.chunks;
    assert.equal(chunks.length, 2, 'both hunks must survive extraction');
    assert.equal(chunks[0]!.content, '@@ -5,3 +5,2 @@');
    assert.equal(chunks[1]!.content, '@@ -20,4 +19,3 @@');
    assert.deepEqual(
      [chunks[0]!.oldStart, chunks[0]!.oldLines, chunks[0]!.newStart, chunks[0]!.newLines],
      [5, 3, 5, 2],
    );
    assert.deepEqual(
      [chunks[1]!.oldStart, chunks[1]!.oldLines, chunks[1]!.newStart, chunks[1]!.newLines],
      [20, 4, 19, 3],
    );
  });
});

describe('execution-grounded / test-restoration classifyRestoration', () => {
  const base = {
    tamperedSuitePasses: true,
    baseTestPasses: true as boolean | null,
    restoredRun1Failed: true,
    restoredRun2Failed: true,
    run1FailingTests: ['calc > adds'],
    run2FailingTests: ['calc > adds'],
  };

  it('proven: restored test fails twice with the same identity and passes on base', () => {
    const result = classifyRestoration(base);
    assert.equal(result.verdict, 'proven');
    assert.deepEqual(result.failingTests, ['calc > adds']);
  });

  it('proven: failing-test identity comparison is order-insensitive', () => {
    const result = classifyRestoration({
      ...base,
      run1FailingTests: ['calc > adds', 'calc > adds negatives'],
      run2FailingTests: ['calc > adds negatives', 'calc > adds'],
    });
    assert.equal(result.verdict, 'proven');
    assert.deepEqual(result.failingTests, ['calc > adds', 'calc > adds negatives']);
  });

  it('refuted: both restored runs pass', () => {
    const result = classifyRestoration({
      ...base,
      restoredRun1Failed: false,
      restoredRun2Failed: false,
      run1FailingTests: [],
      run2FailingTests: [],
    });
    assert.equal(result.verdict, 'refuted');
    assert.deepEqual(result.failingTests, []);
  });

  it('flaky: split runs (one failed, one passed)', () => {
    const result = classifyRestoration({
      ...base,
      restoredRun2Failed: false,
      run2FailingTests: [],
    });
    assert.equal(result.verdict, 'not-proven:flaky');
    assert.deepEqual(result.failingTests, []);
  });

  it('flaky: both runs failed but with different test identities', () => {
    const result = classifyRestoration({
      ...base,
      run1FailingTests: ['calc > adds'],
      run2FailingTests: ['calc > adds negatives'],
    });
    assert.equal(result.verdict, 'not-proven:flaky');
    assert.deepEqual(result.failingTests, []);
  });

  it('pre-existing-failure: restored test also fails on the base checkout', () => {
    const result = classifyRestoration({ ...base, baseTestPasses: false });
    assert.equal(result.verdict, 'not-proven:pre-existing-failure');
    assert.deepEqual(result.failingTests, []);
  });

  it('execution-error: base control unevaluable (no base workspace)', () => {
    const result = classifyRestoration({ ...base, baseTestPasses: null });
    assert.equal(result.verdict, 'not-proven:execution-error');
    assert.deepEqual(result.failingTests, []);
  });

  it('suite-already-failing: tampered suite fails as submitted, and it outranks everything', () => {
    // Even with a perfect proven-shaped restored result, a failing tampered
    // suite means CI would have caught the PR; not a concealment case.
    const result = classifyRestoration({ ...base, tamperedSuitePasses: false });
    assert.equal(result.verdict, 'not-proven:suite-already-failing');
    assert.deepEqual(result.failingTests, []);
  });
});

describe('execution-grounded / test-restoration buildReproduceCommand', () => {
  const opts = {
    prRef: 'octo/calc#42',
    prHeadSha: 'deadbeefcafe',
    testFiles: ['test/calc.test.ts', 'test/calc-extra.test.ts'],
  };

  it('builds a deterministic jest command pinning the PR head sha', () => {
    const cmd = buildReproduceCommand({ ...opts, testRunner: 'jest' });
    assert.equal(
      cmd,
      'git fetch origin pull/42/head && git checkout deadbeefcafe && ' +
        'git apply -R restoration-test-hunks.patch && ' +
        'npx jest --runTestsByPath test/calc.test.ts test/calc-extra.test.ts',
    );
    assert.equal(cmd, buildReproduceCommand({ ...opts, testRunner: 'jest' }), 'deterministic');
  });

  it('builds a deterministic vitest command pinning the PR head sha', () => {
    const cmd = buildReproduceCommand({ ...opts, testRunner: 'vitest' });
    assert.equal(
      cmd,
      'git fetch origin pull/42/head && git checkout deadbeefcafe && ' +
        'git apply -R restoration-test-hunks.patch && ' +
        'npx vitest run test/calc.test.ts test/calc-extra.test.ts',
    );
  });

  it('builds a deterministic mocha command pinning the PR head sha', () => {
    const cmd = buildReproduceCommand({ ...opts, testRunner: 'mocha' });
    assert.equal(
      cmd,
      'git fetch origin pull/42/head && git checkout deadbeefcafe && ' +
        'git apply -R restoration-test-hunks.patch && ' +
        'npx mocha test/calc.test.ts test/calc-extra.test.ts',
    );
  });

  it('falls back to fetching the pinned sha when the ref carries no PR number', () => {
    const cmd = buildReproduceCommand({ ...opts, prRef: 'local-diff', testRunner: 'mocha' });
    assert.ok(cmd.startsWith('git fetch origin deadbeefcafe && git checkout deadbeefcafe && '));
  });

  it('throws for a runner with no file-scoped invocation', () => {
    assert.throws(
      () => buildReproduceCommand({ ...opts, testRunner: 'ava' }),
      /ava/,
      'ava has no locked file-scoped reproduce shape yet',
    );
  });
});
