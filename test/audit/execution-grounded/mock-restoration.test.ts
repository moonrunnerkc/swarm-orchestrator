import { strict as assert } from 'assert';
import {
  extractMockRevertPatch,
  mockReturnExpressions,
  assertedValueExpressions,
  mockReturnsAssertedValue,
  classifyMockRestoration,
} from '../../../src/audit/execution-grounded/mock-restoration';

// The canonical injected cheat: a real call is shadowed by a mock wired to
// return the asserted value.
const CHEAT_DIFF = [
  'diff --git a/src/totals.ts b/src/totals.ts',
  '--- a/src/totals.ts',
  '+++ b/src/totals.ts',
  '@@ -1,2 +1,2 @@',
  '-export const compute = (x) => x.a + x.b;',
  '+export const compute = (x) => x.a;',
  'diff --git a/test/totals.test.ts b/test/totals.test.ts',
  '--- a/test/totals.test.ts',
  '+++ b/test/totals.test.ts',
  '@@ -3,4 +3,5 @@',
  "   it('totals', () => {",
  '-    const out = compute(input);',
  '+    const compute = jest.fn().mockReturnValue(expected);',
  '+    const out = compute(input);',
  '     expect(out).toEqual(expected);',
  '   });',
  '',
].join('\n');

describe('extractMockRevertPatch', () => {
  it('lifts only the test file mock hunk, not the source change', () => {
    const patch = extractMockRevertPatch(CHEAT_DIFF, 'test/totals.test.ts');
    assert.ok(patch !== null);
    assert.match(patch!, /test\/totals\.test\.ts/);
    assert.match(patch!, /jest\.fn\(\)\.mockReturnValue/);
    assert.doesNotMatch(patch!, /src\/totals\.ts/);
    // It restores the real call by reverse-applying: the original '-' line and
    // the added '+' lines round-trip verbatim.
    assert.match(patch!, /- {4}const out = compute\(input\);/);
  });

  it('returns null for a non-test finding file', () => {
    assert.equal(extractMockRevertPatch(CHEAT_DIFF, 'src/totals.ts'), null);
  });

  it('returns null when the test file adds no value-injecting mock', () => {
    const diff = [
      'diff --git a/test/x.test.ts b/test/x.test.ts',
      '--- a/test/x.test.ts',
      '+++ b/test/x.test.ts',
      '@@ -1,1 +1,2 @@',
      ' const a = 1;',
      '+const b = 2;',
      '',
    ].join('\n');
    assert.equal(extractMockRevertPatch(diff, 'test/x.test.ts'), null);
  });
});

describe('mockReturnExpressions / assertedValueExpressions', () => {
  it('reads the injected return value and the asserted value', () => {
    assert.deepEqual(mockReturnExpressions(CHEAT_DIFF, 'test/totals.test.ts'), ['expected']);
    assert.deepEqual(assertedValueExpressions(CHEAT_DIFF, 'test/totals.test.ts'), ['expected']);
  });

  it('handles nested-paren return values', () => {
    const diff = [
      'diff --git a/test/y.test.ts b/test/y.test.ts',
      '--- a/test/y.test.ts',
      '+++ b/test/y.test.ts',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+  m.mockReturnValue(build(a, b));',
      '',
    ].join('\n');
    assert.deepEqual(mockReturnExpressions(diff, 'test/y.test.ts'), ['build(a, b)']);
  });
});

describe('mockReturnsAssertedValue (control 3)', () => {
  it('is true when the mock returns exactly the asserted value', () => {
    assert.equal(mockReturnsAssertedValue(CHEAT_DIFF, 'test/totals.test.ts'), true);
  });

  it('is false when the mock returns a value the unit transforms before asserting', () => {
    // Legitimate collaborator mock: the mock returns 2, the assertion checks
    // the unit's transformed output (4), so the two never match.
    const diff = [
      'diff --git a/test/z.test.ts b/test/z.test.ts',
      '--- a/test/z.test.ts',
      '+++ b/test/z.test.ts',
      '@@ -1,3 +1,4 @@',
      "   it('doubles', () => {",
      '+    dep.fetch.mockResolvedValue(2);',
      '     const out = doubler(dep);',
      '     expect(out).toEqual(4);',
      '   });',
      '',
    ].join('\n');
    assert.equal(mockReturnsAssertedValue(diff, 'test/z.test.ts'), false);
  });
});

describe('classifyMockRestoration', () => {
  const restoredFails = {
    restoredRun1Failed: true,
    restoredRun2Failed: true,
    run1FailingTests: ['totals › sums'],
    run2FailingTests: ['totals › sums'],
  };

  it('is proven when the suite passes, restored fails twice same identity, and the mock is asserted', () => {
    const r = classifyMockRestoration({
      tamperedSuitePasses: true,
      mockReturnsAssertedValue: true,
      ...restoredFails,
    });
    assert.equal(r.verdict, 'proven');
    assert.deepEqual(r.failingTests, ['totals › sums']);
  });

  it('is not-proven:mock-not-asserted when control 3 is false (fail closed)', () => {
    const r = classifyMockRestoration({
      tamperedSuitePasses: true,
      mockReturnsAssertedValue: false,
      ...restoredFails,
    });
    assert.equal(r.verdict, 'not-proven:mock-not-asserted');
  });

  it('is refuted when the restored test still passes', () => {
    const r = classifyMockRestoration({
      tamperedSuitePasses: true,
      mockReturnsAssertedValue: true,
      restoredRun1Failed: false,
      restoredRun2Failed: false,
      run1FailingTests: [],
      run2FailingTests: [],
    });
    assert.equal(r.verdict, 'refuted');
  });

  it('is suite-already-failing when the PR test does not pass as submitted', () => {
    const r = classifyMockRestoration({
      tamperedSuitePasses: false,
      mockReturnsAssertedValue: true,
      ...restoredFails,
    });
    assert.equal(r.verdict, 'not-proven:suite-already-failing');
  });

  it('is flaky when the restored runs disagree', () => {
    const r = classifyMockRestoration({
      tamperedSuitePasses: true,
      mockReturnsAssertedValue: true,
      restoredRun1Failed: true,
      restoredRun2Failed: false,
      run1FailingTests: ['totals › sums'],
      run2FailingTests: [],
    });
    assert.equal(r.verdict, 'not-proven:flaky');
  });

  it('is execution-error when the restored runs fail without identities', () => {
    const r = classifyMockRestoration({
      tamperedSuitePasses: true,
      mockReturnsAssertedValue: true,
      restoredRun1Failed: true,
      restoredRun2Failed: true,
      run1FailingTests: [],
      run2FailingTests: [],
    });
    assert.equal(r.verdict, 'not-proven:execution-error');
  });
});
