import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import { testRelaxationDetector } from '../../../src/audit/cheat-detector/test-relaxation';
import type { Finding } from '../../../src/audit/types';

function runOn(unifiedDiff: string): Finding[] {
  const files = parseDiff(unifiedDiff);
  // testRelaxationDetector.run is synchronous; the Detector interface widens
  // the return to `Finding[] | Promise<Finding[]>` for the async-capable
  // no-op-fix detector. Narrow back here since this detector is synchronous.
  return testRelaxationDetector.run({ files, repoRoot: '.' }) as Finding[];
}

describe('cheat-detector / test-relaxation', () => {
  it('flags strict matcher replaced with loose matcher in same hunk', () => {
    const diff = `diff --git a/src/foo.test.ts b/src/foo.test.ts
--- a/src/foo.test.ts
+++ b/src/foo.test.ts
@@ -1,3 +1,3 @@
 it('does X', () => {
-  expect(result).toBe(5);
+  expect(result).toBeDefined();
 });
`;
    const findings = runOn(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.category, 'test-relaxation');
    assert.equal(findings[0]?.severity, 'block');
    assert.equal(findings[0]?.location.file, 'src/foo.test.ts');
  });

  it('flags removed describe block when no replacement exists in same chunk', () => {
    const diff = `diff --git a/src/foo.spec.ts b/src/foo.spec.ts
--- a/src/foo.spec.ts
+++ b/src/foo.spec.ts
@@ -1,5 +1,2 @@
-describe('Adder', () => {
-  it('adds', () => { expect(add(1,2)).toBe(3); });
-});
 const noop = 1;
`;
    const findings = runOn(diff);
    assert.ok(findings.some((f) => f.severity === 'block'));
  });

  it('does not flag the same describe block when replaced by another describe', () => {
    const diff = `diff --git a/src/foo.spec.ts b/src/foo.spec.ts
--- a/src/foo.spec.ts
+++ b/src/foo.spec.ts
@@ -1,2 +1,2 @@
-describe('old name', () => {});
+describe('new name', () => {});
`;
    const findings = runOn(diff);
    assert.equal(findings.length, 0);
  });

  it('ignores non-test files', () => {
    const diff = `diff --git a/src/lib.ts b/src/lib.ts
--- a/src/lib.ts
+++ b/src/lib.ts
@@ -1,3 +1,3 @@
-  expect(true).toBe(true);
+  expect(true).toBeDefined();
`;
    const findings = runOn(diff);
    assert.equal(findings.length, 0);
  });

  it('flags assertion-bearing line removed with no compensating assertion (warn)', () => {
    const diff = `diff --git a/foo.test.ts b/foo.test.ts
--- a/foo.test.ts
+++ b/foo.test.ts
@@ -1,4 +1,2 @@
 it('does X', () => {
-  expect(value).foo(5);
   /* placeholder */
 });
`;
    const findings = runOn(diff);
    assert.ok(findings.some((f) => f.category === 'test-relaxation' && f.severity === 'warn'));
  });
});
