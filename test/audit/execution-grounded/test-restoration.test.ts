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

  it('extracts a deleted test file so the reverse patch restores it', () => {
    const diff = [
      'diff --git a/test/gone.test.js b/test/gone.test.js',
      'deleted file mode 100644',
      'index 1111111..0000000',
      '--- a/test/gone.test.js',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      "-it('gone', () => {",
      '-  assert.ok(true);',
      '-});',
      '',
    ].join('\n');

    const patch = extractTestHunkPatch(diff, 'test/gone.test.js');

    assert.notEqual(patch, null, 'a deleted test file must still be extractable');
    const lines = patch!.split('\n');
    assert.ok(lines.includes('--- a/test/gone.test.js'), 'old side must carry the real path');
    assert.ok(lines.includes('+++ /dev/null'), 'new side must be /dev/null for a deletion');
    assert.ok(lines.includes('deleted file mode 100644'), 'deleted-file header must survive');
    assert.ok(lines.includes("-it('gone', () => {"));
    assert.ok(lines.includes('-  assert.ok(true);'));
    assert.ok(lines.includes('-});'));

    const reparsed = parseDiff(patch!);
    assert.equal(reparsed.length, 1);
    assert.equal(reparsed[0]!.deleted, true, 're-parsing must yield a deletion');
    assert.equal(reparsed[0]!.from, 'test/gone.test.js');
    assert.equal(reparsed[0]!.to, '/dev/null');
  });

  it('extracts a new test file with /dev/null on the old side', () => {
    const diff = [
      'diff --git a/test/fresh.test.ts b/test/fresh.test.ts',
      'new file mode 100644',
      'index 0000000..1234567',
      '--- /dev/null',
      '+++ b/test/fresh.test.ts',
      '@@ -0,0 +1,3 @@',
      "+it('fresh', () => {",
      '+  assert.ok(true);',
      '+});',
      '',
    ].join('\n');

    const patch = extractTestHunkPatch(diff, 'test/fresh.test.ts');

    assert.notEqual(patch, null);
    const lines = patch!.split('\n');
    assert.equal(lines[0], 'diff --git a/test/fresh.test.ts b/test/fresh.test.ts');
    assert.ok(lines.includes('new file mode 100644'), 'new-file header must survive');
    assert.ok(lines.includes('--- /dev/null'), 'old side must be /dev/null for a new file');
    assert.ok(lines.includes('+++ b/test/fresh.test.ts'), 'new side must carry the real path');

    const reparsed = parseDiff(patch!);
    assert.equal(reparsed.length, 1);
    assert.equal(reparsed[0]!.new, true, 're-parsing must yield a new file');
    assert.deepEqual(
      chunkShapes(patch!, 'test/fresh.test.ts'),
      chunkShapes(diff, 'test/fresh.test.ts'),
    );
  });

  it('extracts a renamed-and-modified test file with both paths in the headers', () => {
    const diff = [
      'diff --git a/test/old-name.test.ts b/test/new-name.test.ts',
      'similarity index 90%',
      'rename from test/old-name.test.ts',
      'rename to test/new-name.test.ts',
      'index 1111111..2222222 100644',
      '--- a/test/old-name.test.ts',
      '+++ b/test/new-name.test.ts',
      '@@ -5,3 +5,3 @@',
      " it('renamed', () => {",
      '-  assert.equal(add(2, 2), 4);',
      '+  assert.equal(add(2, 2), 5);',
      ' });',
      '',
    ].join('\n');

    const patch = extractTestHunkPatch(diff, 'test/new-name.test.ts');

    assert.notEqual(patch, null);
    const lines = patch!.split('\n');
    assert.equal(lines[0], 'diff --git a/test/old-name.test.ts b/test/new-name.test.ts');
    assert.ok(lines.includes('--- a/test/old-name.test.ts'), 'old side keeps the pre-rename path');
    assert.ok(lines.includes('+++ b/test/new-name.test.ts'), 'new side keeps the post-rename path');
    assert.deepEqual(
      chunkShapes(patch!, 'test/new-name.test.ts'),
      chunkShapes(diff, 'test/new-name.test.ts'),
      'the modification hunks must be preserved through the rename',
    );
  });

  it('preserves a trailing "\\ No newline at end of file" marker verbatim', () => {
    const diff = [
      'diff --git a/test/eol.test.ts b/test/eol.test.ts',
      'index 1111111..2222222 100644',
      '--- a/test/eol.test.ts',
      '+++ b/test/eol.test.ts',
      '@@ -1,3 +1,2 @@',
      " it('eol', () => {",
      '-  assert.equal(add(1, 1), 2);',
      ' });',
      '\\ No newline at end of file',
      '',
    ].join('\n');

    const patch = extractTestHunkPatch(diff, 'test/eol.test.ts');

    assert.notEqual(patch, null);
    assert.ok(
      patch!.split('\n').includes('\\ No newline at end of file'),
      'the no-newline marker must survive extraction byte-for-byte',
    );
    assert.deepEqual(
      chunkShapes(patch!, 'test/eol.test.ts'),
      chunkShapes(diff, 'test/eol.test.ts'),
    );
  });

  it('preserves an omitted-count hunk header "@@ -1 +1 @@" verbatim', () => {
    const diff = [
      'diff --git a/test/one.test.ts b/test/one.test.ts',
      'index 1111111..2222222 100644',
      '--- a/test/one.test.ts',
      '+++ b/test/one.test.ts',
      '@@ -1 +1 @@',
      '-assert.ok(false);',
      '+assert.ok(true);',
      '',
    ].join('\n');

    const patch = extractTestHunkPatch(diff, 'test/one.test.ts');

    assert.notEqual(patch, null);
    const lines = patch!.split('\n');
    assert.ok(lines.includes('@@ -1 +1 @@'), 'omitted-count header must not be rewritten');
    assert.ok(lines.includes('-assert.ok(false);'));
    assert.ok(lines.includes('+assert.ok(true);'));
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

  it('execution-error: both runs failed but neither yielded a failing-test identity', () => {
    // A restored test that fails without parseable identities (e.g. a compile
    // error after a legitimate rename) is an execution anomaly, not proof.
    const result = classifyRestoration({
      ...base,
      run1FailingTests: [],
      run2FailingTests: [],
    });
    assert.equal(result.verdict, 'not-proven:execution-error');
    assert.deepEqual(result.failingTests, []);
  });

  it('flaky: one run yields identities and the other yields none', () => {
    // The identity-mismatch check precedes the empty-identity guard.
    const result = classifyRestoration({
      ...base,
      run1FailingTests: ['calc > adds'],
      run2FailingTests: [],
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

  it('throws on a test file path containing a backtick', () => {
    assert.throws(() =>
      buildReproduceCommand({
        ...opts,
        testFiles: ['test/`touch pwned`.test.ts'],
        testRunner: 'jest',
      }),
    );
  });

  it('throws on a test file path containing a semicolon', () => {
    assert.throws(() =>
      buildReproduceCommand({
        ...opts,
        testFiles: ['test/calc.test.ts;rm -rf .'],
        testRunner: 'jest',
      }),
    );
  });

  it('throws on a test file path containing a space', () => {
    assert.throws(() =>
      buildReproduceCommand({
        ...opts,
        testFiles: ['test/calc.test.ts --reporter evil'],
        testRunner: 'jest',
      }),
    );
  });

  it('throws on a path-traversal test file path', () => {
    assert.throws(() =>
      buildReproduceCommand({ ...opts, testFiles: ['../escape.test.ts'], testRunner: 'jest' }),
    );
    assert.throws(() =>
      buildReproduceCommand({ ...opts, testFiles: ['/etc/passwd'], testRunner: 'jest' }),
    );
  });

  it('throws on a head sha that is uppercase, too short, or not hex', () => {
    assert.throws(() =>
      buildReproduceCommand({ ...opts, prHeadSha: 'DEADBEEFCAFE', testRunner: 'jest' }),
    );
    assert.throws(() =>
      buildReproduceCommand({ ...opts, prHeadSha: 'abc123', testRunner: 'jest' }),
    );
    assert.throws(() =>
      buildReproduceCommand({ ...opts, prHeadSha: 'deadbeef$(id)', testRunner: 'jest' }),
    );
  });

  it('throws on a PR ref whose owner/repo part is not conservatively shaped', () => {
    assert.throws(() =>
      buildReproduceCommand({ ...opts, prRef: 'octo/calc;rm -rf .#42', testRunner: 'jest' }),
    );
  });
});
