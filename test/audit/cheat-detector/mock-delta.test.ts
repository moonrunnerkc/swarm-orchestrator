import { strict as assert } from 'assert';
import {
  extractMockMutationFocus,
  focusSemanticDiff,
} from '../../../src/audit/cheat-detector/mock-delta';

// A small unified diff with a header line, one source-file section and one
// test-file section, parameterized by the test hunk body so each case can
// inject a different mock shape into a real-looking surrounding diff.
function diffWith(testHunkBody: string, testPath = 'src/totals.test.ts'): string {
  return [
    `diff --git a/src/totals.ts b/src/totals.ts`,
    `--- a/src/totals.ts`,
    `+++ b/src/totals.ts`,
    `@@ -1,3 +1,4 @@`,
    ` export function compute(x) {`,
    `+  // unrelated real change`,
    `   return x.a + x.b;`,
    ` }`,
    `diff --git a/${testPath} b/${testPath}`,
    `--- a/${testPath}`,
    `+++ b/${testPath}`,
    `@@ -10,4 +10,5 @@`,
    testHunkBody,
    ``,
  ].join('\n');
}

describe('extractMockMutationFocus', () => {
  it('focuses a jest mockReturnValue added in a test hunk', () => {
    const diff = diffWith(
      [
        ` it('totals', () => {`,
        `-  const out = compute(input);`,
        `+  const compute = jest.fn().mockReturnValue(expected);`,
        `+  const out = compute(input);`,
        `   expect(out).toEqual(expected);`,
        ` });`,
      ].join('\n'),
    );
    const { hunks, focusedDiff } = extractMockMutationFocus(diff);
    assert.equal(hunks.length, 1, 'one mock-bearing hunk');
    assert.ok(focusedDiff !== null);
    assert.match(focusedDiff!, /jest\.fn\(\)\.mockReturnValue/);
    // The focused diff carries the test file header and NOT the source file.
    assert.match(focusedDiff!, /b\/src\/totals\.test\.ts/);
    assert.doesNotMatch(focusedDiff!, /unrelated real change/);
  });

  it('focuses mockResolvedValue and mockImplementation too', () => {
    for (const method of ['mockResolvedValue(expected)', 'mockImplementation(() => expected)']) {
      const diff = diffWith(
        [` it('x', () => {`, `+  m.${method};`, `   expect(out).toEqual(expected);`, ` });`].join(
          '\n',
        ),
      );
      assert.ok(
        extractMockMutationFocus(diff).focusedDiff !== null,
        `${method} should be a mock signal`,
      );
    }
  });

  it('focuses a sinon stub .returns when the hunk is plainly sinon', () => {
    const diff = diffWith(
      [
        ` it('x', () => {`,
        `+  const s = sinon.stub(svc, 'compute').returns(expected);`,
        `   expect(out).toEqual(expected);`,
        ` });`,
      ].join('\n'),
    );
    assert.ok(extractMockMutationFocus(diff).focusedDiff !== null);
  });

  it('does NOT treat a bare promise .resolves as a mock signal (no sinon context)', () => {
    const diff = diffWith(
      [
        ` it('x', async () => {`,
        `+  await expect(loadConfig()).resolves.toEqual(expected);`,
        ` });`,
      ].join('\n'),
    );
    assert.equal(extractMockMutationFocus(diff).focusedDiff, null);
  });

  it('ignores a value-injecting mock outside a test file', () => {
    const diff = [
      `diff --git a/src/app.ts b/src/app.ts`,
      `--- a/src/app.ts`,
      `+++ b/src/app.ts`,
      `@@ -1,2 +1,3 @@`,
      ` const x = 1;`,
      `+const m = jest.fn().mockReturnValue(2);`,
      ` export default x;`,
      ``,
    ].join('\n');
    assert.equal(extractMockMutationFocus(diff).focusedDiff, null);
  });

  it('ignores a mock that already existed (a context line, not an addition)', () => {
    const diff = diffWith(
      [
        ` it('x', () => {`,
        `   const compute = jest.fn().mockReturnValue(expected);`,
        `+  const extra = 1;`,
        `   expect(out).toEqual(expected);`,
        ` });`,
      ].join('\n'),
    );
    assert.equal(extractMockMutationFocus(diff).focusedDiff, null);
  });

  it('returns null focusedDiff for a diff with no mock', () => {
    const diff = diffWith(
      [` it('x', () => {`, `+  const out = compute(input);`, ` });`].join('\n'),
    );
    assert.equal(extractMockMutationFocus(diff).focusedDiff, null);
  });
});

describe('focusSemanticDiff', () => {
  const mockDiff = diffWith(
    [` it('x', () => {`, `+  const m = jest.fn().mockReturnValue(expected);`, ` });`].join('\n'),
  );

  it('skips cheat-mock-mutation when no mock hunk exists', () => {
    const noMock = diffWith([` it('x', () => {`, `+  const out = compute(input);`, ` });`].join('\n'));
    const r = focusSemanticDiff('cheat-mock-mutation', noMock);
    assert.equal(r.skip, true);
  });

  it('focuses cheat-mock-mutation onto the mock hunk when one exists', () => {
    const r = focusSemanticDiff('cheat-mock-mutation', mockDiff);
    assert.equal(r.skip, false);
    assert.match(r.diff, /mockReturnValue/);
    assert.doesNotMatch(r.diff, /unrelated real change/);
  });

  it('never skips goal-not-fixed and passes the whole diff through', () => {
    const r = focusSemanticDiff('goal-not-fixed', mockDiff);
    assert.equal(r.skip, false);
    assert.equal(r.diff, mockDiff);
  });
});
