import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import {
  buildReproduceCommand,
  buildTestCommand,
  classifyRestoration,
  executeTestRun,
  extractTestHunkPatch,
  parseFailingTests,
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
  const PATCH =
    '--- a/test/calc.test.ts\n+++ b/test/calc.test.ts\n@@ -1,2 +1,1 @@\n test\n-  assert.equal(add(1, 1), 2);';
  const opts = {
    prRef: 'octo/calc#42',
    prHeadSha: 'deadbeefcafe',
    testFiles: ['test/calc.test.ts', 'test/calc-extra.test.ts'],
    revertedHunkPatch: PATCH,
  };

  it('builds a self-contained jest command that embeds the restore patch', () => {
    const cmd = buildReproduceCommand({ ...opts, testRunner: 'jest' });
    assert.equal(
      cmd,
      'git fetch origin pull/42/head && git checkout deadbeefcafe && ' +
        "git apply -R <<'SWARM_RESTORE_PATCH' && " +
        'npx jest --runTestsByPath test/calc.test.ts test/calc-extra.test.ts\n' +
        PATCH +
        '\nSWARM_RESTORE_PATCH',
    );
    assert.equal(cmd, buildReproduceCommand({ ...opts, testRunner: 'jest' }), 'deterministic');
  });

  it('builds a self-contained vitest command that embeds the restore patch', () => {
    const cmd = buildReproduceCommand({ ...opts, testRunner: 'vitest' });
    assert.equal(
      cmd,
      'git fetch origin pull/42/head && git checkout deadbeefcafe && ' +
        "git apply -R <<'SWARM_RESTORE_PATCH' && " +
        'npx vitest run test/calc.test.ts test/calc-extra.test.ts\n' +
        PATCH +
        '\nSWARM_RESTORE_PATCH',
    );
  });

  it('builds a self-contained mocha command that embeds the restore patch', () => {
    const cmd = buildReproduceCommand({ ...opts, testRunner: 'mocha' });
    assert.equal(
      cmd,
      'git fetch origin pull/42/head && git checkout deadbeefcafe && ' +
        "git apply -R <<'SWARM_RESTORE_PATCH' && " +
        'npx mocha test/calc.test.ts test/calc-extra.test.ts\n' +
        PATCH +
        '\nSWARM_RESTORE_PATCH',
    );
  });

  it('needs no external file: the embedded heredoc carries the patch', () => {
    const cmd = buildReproduceCommand({ ...opts, testRunner: 'mocha' });
    assert.ok(!cmd.includes('restoration-test-hunks.patch'), 'no external patch file referenced');
    assert.ok(cmd.includes(PATCH.trimEnd()), 'the restore patch is embedded inline');
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

// Captured-shape runner output samples. Each failing sample carries exactly
// two named failures; each passing sample carries none. The shapes follow the
// runners' default reporters (jest writes its report to stderr; mocha and
// vitest write to stdout).
const JEST_PASSING_STDERR = [
  'PASS test/calc.test.js',
  '  calc',
  '    ✓ adds (2 ms)',
  '    ✓ subtracts (1 ms)',
  '',
  'Test Suites: 1 passed, 1 total',
  'Tests:       2 passed, 2 total',
  'Snapshots:   0 total',
  'Time:        0.412 s',
  'Ran all test suites.',
  '',
].join('\n');

const JEST_FAILING_STDERR = [
  'FAIL test/calc.test.js',
  '  calc',
  '    ✓ multiplies (1 ms)',
  '    ✕ adds (3 ms)',
  '    ✕ subtracts (1 ms)',
  '',
  '  ● calc › adds',
  '',
  '    expect(received).toBe(expected) // Object.is equality',
  '',
  '    Expected: 4',
  '    Received: 5',
  '',
  "       6 |   it('adds', () => {",
  '    >  7 |     expect(add(2, 2)).toBe(4);',
  '         |                       ^',
  '',
  '      at Object.<anonymous> (test/calc.test.js:7:23)',
  '',
  '  ● calc › subtracts',
  '',
  '    expect(received).toBe(expected) // Object.is equality',
  '',
  '    Expected: 0',
  '    Received: 1',
  '',
  '      at Object.<anonymous> (test/calc.test.js:12:28)',
  '',
  'Test Suites: 1 failed, 1 total',
  'Tests:       2 failed, 1 passed, 3 total',
  'Snapshots:   0 total',
  'Time:        0.689 s',
  'Ran all test suites.',
  '',
].join('\n');

const MOCHA_PASSING_STDOUT = [
  '',
  '',
  '  calc',
  '    ✓ adds',
  '    ✓ subtracts',
  '',
  '',
  '  2 passing (8ms)',
  '',
].join('\n');

const MOCHA_FAILING_STDOUT = [
  '',
  '',
  '  calc',
  '    ✓ multiplies',
  '    1) adds',
  '    2) subtracts',
  '',
  '',
  '  1 passing (10ms)',
  '  2 failing',
  '',
  '  1) calc',
  '       adds:',
  '',
  '      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
  '',
  '5 !== 4',
  '',
  '      + expected - actual',
  '',
  '      -5',
  '      +4',
  '',
  '      at Context.<anonymous> (test/calc.test.js:7:12)',
  '',
  '  2) calc',
  '       subtracts:',
  '     Error: boom',
  '      at Context.<anonymous> (test/calc.test.js:11:11)',
  '',
  '',
].join('\n');

const VITEST_PASSING_STDOUT = [
  ' RUN  v1.6.0 /tmp/project',
  '',
  ' ✓ test/calc.test.js (2 tests) 3ms',
  '',
  ' Test Files  1 passed (1)',
  '      Tests  2 passed (2)',
  '   Start at  12:00:00',
  '   Duration  312ms',
  '',
].join('\n');

const VITEST_FAILING_STDOUT = [
  ' RUN  v1.6.0 /tmp/project',
  '',
  ' ❯ test/calc.test.js (3 tests | 2 failed) 7ms',
  '   × calc > adds 4ms',
  '   × calc > subtracts 2ms',
  '',
  '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯',
  '',
  ' FAIL  test/calc.test.js > calc > adds',
  'AssertionError: expected 5 to be 4 // Object.is equality',
  '',
  '- Expected',
  '+ Received',
  '',
  '- 4',
  '+ 5',
  '',
  ' ❯ test/calc.test.js:7:21',
  '',
  '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯',
  '',
  ' FAIL  test/calc.test.js > calc > subtracts',
  'AssertionError: expected 1 to be 0 // Object.is equality',
  '',
  ' ❯ test/calc.test.js:11:23',
  '',
  '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯',
  '',
  ' Test Files  1 failed (1)',
  '      Tests  2 failed | 1 passed (3)',
  '   Start at  12:00:01',
  '   Duration  354ms',
  '',
].join('\n');

describe('execution-grounded / test-restoration parseFailingTests', () => {
  it('jest: a passing run yields no identities', () => {
    assert.deepEqual(parseFailingTests('jest', '', JEST_PASSING_STDERR), []);
  });

  it('jest: a failing run yields both identities from the ● blocks, deduped and sorted', () => {
    assert.deepEqual(parseFailingTests('jest', '', JEST_FAILING_STDERR), [
      'calc › adds',
      'calc › subtracts',
    ]);
  });

  it('jest: identities are stable across two identical runs', () => {
    assert.deepEqual(
      parseFailingTests('jest', '', JEST_FAILING_STDERR),
      parseFailingTests('jest', '', JEST_FAILING_STDERR),
    );
  });

  it('jest: ANSI color codes are stripped before parsing', () => {
    const colored = JEST_FAILING_STDERR.replace(
      '  ● calc › adds',
      '  \u001b[1m\u001b[31m● calc › adds\u001b[39m\u001b[22m',
    ).replace('    ✕ adds (3 ms)', '    \u001b[31m✕\u001b[39m \u001b[2madds (3 ms)\u001b[22m');
    assert.deepEqual(parseFailingTests('jest', '', colored), ['calc › adds', 'calc › subtracts']);
  });

  it('jest: a suite that failed to run yields no identities (fails closed)', () => {
    const stderr = [
      'FAIL test/calc.test.js',
      '  ● Test suite failed to run',
      '',
      "    Cannot find module './missing' from 'test/calc.test.js'",
      '',
      'Test Suites: 1 failed, 1 total',
      'Tests:       0 total',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('jest', '', stderr), []);
  });

  it('jest: falls back to ✕ lines when no ● failure blocks are present', () => {
    const stderr = ['  calc', '    ✕ adds (3 ms)', '    ✕ subtracts (1 ms)', ''].join('\n');
    assert.deepEqual(parseFailingTests('jest', '', stderr), ['adds', 'subtracts']);
  });

  it('jest: a config validation warning plus a suite that failed to run yields no identities', () => {
    // jest-validate prints its warning bullet at column 0 before the report;
    // it describes the config, not a test, and must never become an identity.
    const stderr = [
      '● Validation Warning:',
      '',
      '  Unknown option "testPathPatern" with value "calc" was found.',
      '  This is probably a typing mistake. Fixing it will remove this message.',
      '',
      '  Configuration Documentation:',
      '  https://jestjs.io/docs/configuration',
      '',
      'FAIL test/calc.test.js',
      '  ● Test suite failed to run',
      '',
      "    Cannot find module './missing' from 'test/calc.test.js'",
      '',
      'Test Suites: 1 failed, 1 total',
      'Tests:       0 total',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('jest', '', stderr), []);
  });

  it('jest: validation, deprecation, and multi-config bullets are excluded at any accepted indent', () => {
    const stderr = [
      '  ● Validation Warning:',
      '  ● Validation Error:',
      '  ● Deprecation Warning:',
      '  ● Multiple configurations found:',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('jest', '', stderr), []);
  });

  it('jest: console-reindented decoy ● lines are not harvested', () => {
    // jest re-indents captured console output to four-or-deeper under a
    // '  console.log' header; only the two-space failure-block bullets are
    // reporter-authored.
    const stderr = [
      'FAIL test/calc.test.js',
      '  console.log',
      '    ● fake › test',
      '',
      '      at Object.log (test/calc.test.js:3:11)',
      '',
      '  ● calc › adds',
      '',
      '    expect(received).toBe(expected) // Object.is equality',
      '',
      'Tests:       1 failed, 1 total',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('jest', '', stderr), ['calc › adds']);
  });

  it('jest: the ✕ fallback only accepts reporter-shaped indentation', () => {
    // Real leaf lines sit at 2 + 2·depth spaces; zero, one, and three-space
    // decoys are code-under-test output, not the reporter.
    const stderr = [
      '✕ fake zero-indent',
      ' ✕ fake one-space',
      '   ✕ fake three-space',
      '    ✕ adds (3 ms)',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('jest', '', stderr), ['adds']);
  });

  it('mocha: a passing run yields no identities', () => {
    assert.deepEqual(parseFailingTests('mocha', MOCHA_PASSING_STDOUT, ''), []);
  });

  it('mocha: a failing run yields both identities from the epilogue, not the in-run markers', () => {
    assert.deepEqual(parseFailingTests('mocha', MOCHA_FAILING_STDOUT, ''), [
      'calc › adds',
      'calc › subtracts',
    ]);
  });

  it('mocha: identities are stable across two identical runs', () => {
    assert.deepEqual(
      parseFailingTests('mocha', MOCHA_FAILING_STDOUT, ''),
      parseFailingTests('mocha', MOCHA_FAILING_STDOUT, ''),
    );
  });

  it('mocha: nested suites join every level of the epilogue block', () => {
    const stdout = [
      '  1 passing (10ms)',
      '  1 failing',
      '',
      '  1) outer',
      '       inner',
      '         deep test:',
      '     Error: boom',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('mocha', stdout, ''), ['outer › inner › deep test']);
  });

  it('mocha: numbered-colon lines inside an error body do not invent identities', () => {
    // An assertion message quoting '      2) some detail:' sits deeper than
    // the two-space epilogue column; it must not become an identity.
    const stdout = [
      '  1 passing (10ms)',
      '  1 failing',
      '',
      '  1) calc',
      '       adds:',
      '     Error: expected the payload to contain:',
      '      2) some detail:',
      '      at Context.<anonymous> (test/calc.test.js:7:12)',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('mocha', stdout, ''), ['calc › adds']);
  });

  it('mocha: in-run markers and deeper-indented decoy blocks are not harvested', () => {
    // The spec reporter prints in-run failure markers at four-or-deeper
    // ('    1) adds'); only the two-space epilogue entries carry identities,
    // so a code-under-test decoy printed at in-run depth contributes nothing.
    const stdout = [
      '  calc',
      '    1) adds',
      '    4) fake decoy',
      '         fake deep:',
      '',
      '  1 failing',
      '',
      '  1) calc',
      '       adds:',
      '     Error: boom',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('mocha', stdout, ''), ['calc › adds']);
  });

  it('vitest: a passing run yields no identities', () => {
    assert.deepEqual(parseFailingTests('vitest', VITEST_PASSING_STDOUT, ''), []);
  });

  it('vitest: a failing run yields both identities from the FAIL headers', () => {
    assert.deepEqual(parseFailingTests('vitest', VITEST_FAILING_STDOUT, ''), [
      'test/calc.test.js > calc > adds',
      'test/calc.test.js > calc > subtracts',
    ]);
  });

  it('vitest: identities are stable across two identical runs', () => {
    assert.deepEqual(
      parseFailingTests('vitest', VITEST_FAILING_STDOUT, ''),
      parseFailingTests('vitest', VITEST_FAILING_STDOUT, ''),
    );
  });

  it('vitest: falls back to × lines when no per-test FAIL headers are present', () => {
    const stdout = [
      ' ❯ test/calc.test.js (3 tests | 2 failed) 7ms',
      '   × calc > adds 4ms',
      '   × calc > subtracts 2ms',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('vitest', stdout, ''), ['calc > adds', 'calc > subtracts']);
  });

  it('vitest: a file-level FAIL line without a test path yields no identities (fails closed)', () => {
    const stdout = [' FAIL  test/calc.test.js [ unhandled error ]', ''].join('\n');
    assert.deepEqual(parseFailingTests('vitest', stdout, ''), []);
  });

  it('vitest: decoy FAIL and × lines at wrong indent are not harvested', () => {
    // vitest forwards code-under-test stdout verbatim under a 'stdout |'
    // header; reporter-authored FAIL headers sit at exactly one leading
    // space, so zero- and two-space decoys are rejected.
    const stdout = [
      ' RUN  v1.6.0 /tmp/project',
      '',
      'stdout | test/calc.test.js > calc > adds',
      'FAIL fake/file.test.js > fake > test',
      '  FAIL  fake/file.test.js > fake > test',
      '× fake > test 1ms',
      '     × fake > test 1ms',
      '',
      ' ❯ test/calc.test.js (1 test | 1 failed) 7ms',
      '   × calc > adds 4ms',
      '',
      ' FAIL  test/calc.test.js > calc > adds',
      'AssertionError: expected 5 to be 4 // Object.is equality',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('vitest', stdout, ''), ['test/calc.test.js > calc > adds']);
  });

  it('vitest: the × fallback only accepts the reporter three-space indent', () => {
    const stdout = [
      '× fake > test 1ms',
      '  × fake > test 1ms',
      '    × fake > test 1ms',
      '   × calc > adds 4ms',
      '',
    ].join('\n');
    assert.deepEqual(parseFailingTests('vitest', stdout, ''), ['calc > adds']);
  });

  it('a runner with no locked parser yields no identities (fails closed)', () => {
    assert.deepEqual(parseFailingTests('ava', 'anything', '1 test failed'), []);
  });
});

describe('execution-grounded / test-restoration buildTestCommand', () => {
  const files = ['test/calc.test.ts', 'test/calc-extra.test.ts'];

  it('builds the jest argv form', () => {
    assert.deepEqual(buildTestCommand('jest', files), {
      command: 'npx',
      args: ['jest', '--runTestsByPath', 'test/calc.test.ts', 'test/calc-extra.test.ts'],
    });
  });

  it('builds the vitest argv form', () => {
    assert.deepEqual(buildTestCommand('vitest', files), {
      command: 'npx',
      args: ['vitest', 'run', 'test/calc.test.ts', 'test/calc-extra.test.ts'],
    });
  });

  it('builds the mocha argv form', () => {
    assert.deepEqual(buildTestCommand('mocha', files), {
      command: 'npx',
      args: ['mocha', 'test/calc.test.ts', 'test/calc-extra.test.ts'],
    });
  });

  it('matches the human-facing reproduce command rendering exactly', () => {
    for (const runner of ['jest', 'vitest', 'mocha'] as const) {
      const { command, args } = buildTestCommand(runner, files);
      const reproduce = buildReproduceCommand({
        prRef: 'octo/calc#42',
        prHeadSha: 'deadbeefcafe',
        testFiles: files,
        testRunner: runner,
        revertedHunkPatch: '--- a/test/calc.test.ts\n+++ b/test/calc.test.ts\n',
      });
      assert.ok(
        reproduce.includes(`&& ${command} ${args.join(' ')}\n`),
        `reproduce command for ${runner} must render the same invocation`,
      );
    }
  });

  it('throws for runners with no locked file-scoped invocation', () => {
    assert.throws(() => buildTestCommand('ava', files), /ava/);
    assert.throws(() => buildTestCommand('node-test', files), /node-test/);
  });
});

describe('execution-grounded / test-restoration executeTestRun', () => {
  // executeTestRun resolves its runner binary through SWARM_EG_NODE_BIN (the
  // exec-env contract), so pointing that at a directory with a fake `npx`
  // exercises the full spawn path deterministically: no network, no real
  // runner install, and proof the pinned-bin-dir env var is honored.
  const tempDirs: string[] = [];
  let savedNodeBin: string | undefined;

  beforeEach(() => {
    savedNodeBin = process.env.SWARM_EG_NODE_BIN;
  });

  afterEach(() => {
    if (savedNodeBin === undefined) delete process.env.SWARM_EG_NODE_BIN;
    else process.env.SWARM_EG_NODE_BIN = savedNodeBin;
  });

  after(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeFakeNpx(script: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-test-restoration-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'npx'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return dir;
  }

  function runWithFakeNpx(
    script: string,
    extra?: { timeoutMs?: number; recipe?: { env?: Record<string, string> } },
  ): ReturnType<typeof executeTestRun> {
    const dir = makeFakeNpx(script);
    process.env.SWARM_EG_NODE_BIN = dir;
    return executeTestRun({
      runner: 'mocha',
      files: ['t.test.js'],
      cwd: dir,
      timeoutMs: extra?.timeoutMs ?? 30_000,
      ...(extra?.recipe !== undefined ? { recipe: extra.recipe } : {}),
    });
  }

  it('a zero-exit run is passed with no failing tests', () => {
    const result = runWithFakeNpx('exit 0');
    assert.deepEqual(result, {
      passed: true,
      failingTests: [],
      rawOutput: '',
      timedOut: false,
      spawnFailed: false,
    });
  });

  it('a nonzero-exit run with parseable output yields the failing-test identities', () => {
    const escaped = MOCHA_FAILING_STDOUT;
    const script = ["cat <<'SWARM_EOF'", escaped, 'SWARM_EOF', 'exit 1'].join('\n');
    const result = runWithFakeNpx(script);
    assert.equal(result.passed, false);
    assert.equal(result.timedOut, false);
    assert.equal(result.spawnFailed, false, 'a nonzero exit is a real run, not a spawn failure');
    assert.deepEqual(result.failingTests, ['calc › adds', 'calc › subtracts']);
    assert.ok(result.rawOutput.includes('2 failing'), 'raw output must be captured');
  });

  it('a nonzero-exit run with unparseable output is passed:false with empty identities, not a throw', () => {
    const result = runWithFakeNpx("echo 'segmentation fault'; exit 139");
    assert.equal(result.passed, false);
    assert.equal(result.timedOut, false);
    assert.equal(result.spawnFailed, false, 'the child exited under its own exit code');
    assert.deepEqual(result.failingTests, []);
    assert.ok(result.rawOutput.includes('segmentation fault'), 'output must not be discarded');
  });

  it('threads recipe env into the child process', () => {
    const result = runWithFakeNpx('echo "canary=$SWARM_RESTORATION_CANARY"; exit 1', {
      recipe: { env: { SWARM_RESTORATION_CANARY: 'tamper-proof' } },
    });
    assert.equal(result.passed, false);
    assert.ok(result.rawOutput.includes('canary=tamper-proof'), 'recipe env must reach the child');
  });

  it('a spawn-level error (nonexistent binary) returns passed:false with spawnFailed:true', () => {
    process.env.SWARM_EG_NODE_BIN = '/nonexistent-swarm-eg-bin-dir';
    const result = executeTestRun({
      runner: 'mocha',
      files: ['t.test.js'],
      cwd: os.tmpdir(),
      timeoutMs: 5_000,
    });
    assert.equal(result.passed, false);
    assert.equal(result.timedOut, false);
    assert.equal(result.spawnFailed, true, 'nothing executed: the flag callers key on must be set');
    assert.deepEqual(result.failingTests, []);
    assert.ok(result.rawOutput.length > 0, 'the spawn error message must surface in rawOutput');
  });

  it('a spawn-level error (nonexistent cwd) returns spawnFailed:true with the error message', () => {
    const dir = makeFakeNpx('exit 0');
    process.env.SWARM_EG_NODE_BIN = dir;
    const result = executeTestRun({
      runner: 'mocha',
      files: ['t.test.js'],
      cwd: '/nonexistent-swarm-restoration-workspace',
      timeoutMs: 5_000,
    });
    assert.equal(result.passed, false);
    assert.equal(result.timedOut, false);
    assert.equal(result.spawnFailed, true);
    assert.deepEqual(result.failingTests, []);
    assert.ok(result.rawOutput.length > 0, 'the spawn error message must surface in rawOutput');
  });

  it('a hung run times out: timedOut:true, passed:false, no identities', () => {
    const result = runWithFakeNpx('sleep 30', { timeoutMs: 500 });
    assert.equal(result.passed, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.spawnFailed, false, 'a timeout is its own anomaly, not a spawn failure');
    assert.deepEqual(result.failingTests, []);
  });
});
