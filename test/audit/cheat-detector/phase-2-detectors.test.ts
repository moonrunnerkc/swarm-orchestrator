import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import { coverageErosionDetector } from '../../../src/audit/cheat-detector/coverage-erosion';
import { fakeRefactorDetector } from '../../../src/audit/cheat-detector/fake-refactor';
import { commentOnlyFixDetector } from '../../../src/audit/cheat-detector/comment-only-fix';
import { errorSwallowDetector } from '../../../src/audit/cheat-detector/error-swallow';
import { exceptionRethrowLostContextDetector } from '../../../src/audit/cheat-detector/exception-rethrow-lost-context';
import { deadBranchInsertionDetector } from '../../../src/audit/cheat-detector/dead-branch-insertion';

function run(
  detector: { run: (ctx: { files: ReturnType<typeof parseDiff>; repoRoot: string }) => unknown },
  diff: string,
): unknown[] {
  return detector.run({ files: parseDiff(diff), repoRoot: '.' }) as unknown[];
}

describe('cheat-detector / coverage-erosion', () => {
  it('warns when a source branch is added with no test addition', () => {
    const diff = `diff --git a/src/feat.ts b/src/feat.ts
--- a/src/feat.ts
+++ b/src/feat.ts
@@ -1,3 +1,4 @@
 function f(x) {
+  if (x < 0) return -1;
   return x * 2;
 }
`;
    assert.equal(run(coverageErosionDetector, diff).length, 1);
  });

  it('does not fire when a matching test was added', () => {
    const diff = `diff --git a/src/feat.ts b/src/feat.ts
--- a/src/feat.ts
+++ b/src/feat.ts
@@ -1,3 +1,4 @@
 function f(x) {
+  if (x < 0) return -1;
   return x * 2;
 }
diff --git a/src/feat.test.ts b/src/feat.test.ts
--- a/src/feat.test.ts
+++ b/src/feat.test.ts
@@ -1,1 +1,2 @@
 it('positive', () => { expect(f(2)).toBe(4); });
+it('negative', () => { expect(f(-1)).toBe(-1); });
`;
    assert.equal(run(coverageErosionDetector, diff).length, 0);
  });
});

describe('cheat-detector / fake-refactor', () => {
  it('blocks a rename whose callers were not updated', () => {
    // v2.0 (TS compiler-API closure) fires when a caller reference to
    // the old name is visible anywhere in the diff (added or unchanged
    // context). The caller below is a context line in src/caller.ts
    // that the PR forgot to rename.
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,3 @@
-export function compute(x: number): number {
+export function computeV2(x: number): number {
   return x;
 }
diff --git a/src/caller.ts b/src/caller.ts
--- a/src/caller.ts
+++ b/src/caller.ts
@@ -1,2 +1,2 @@
 import { compute } from './x';
-const r = compute(1);
+const r = compute(2);
`;
    const f = run(fakeRefactorDetector, diff);
    assert.equal(f.length, 1);
  });

  it('does not fire when callers are also updated in the same PR', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,3 @@
-export function compute(x: number): number {
+export function computeV2(x: number): number {
   return x;
 }
diff --git a/src/caller.ts b/src/caller.ts
--- a/src/caller.ts
+++ b/src/caller.ts
@@ -1,1 +1,1 @@
-import { compute } from './x';
+import { computeV2 } from './x';
`;
    assert.equal(run(fakeRefactorDetector, diff).length, 0);
  });
});

describe('cheat-detector / comment-only-fix', () => {
  it('warns when the only source addition is a comment', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,4 @@
 function f() {
+  // FIXME: still broken
   return 1;
 }
`;
    assert.equal(run(commentOnlyFixDetector, diff).length, 1);
  });

  it('does not fire when real code was added', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,2 +1,3 @@
 function f() {
+  return 42;
 }
`;
    // Body matches a top-level "return" addition, which is non-comment.
    assert.equal(run(commentOnlyFixDetector, diff).length, 0);
  });
});

describe('cheat-detector / error-swallow', () => {
  it('blocks an added empty catch block', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,5 @@
 function f() {
+  try {
   doIt();
+  } catch {}
 }
`;
    assert.equal(run(errorSwallowDetector, diff).length, 1);
  });

  it('does not fire when the catch logs and rethrows', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,7 @@
 function f() {
+  try {
   doIt();
+  } catch (err) {
+    logger.error('inner failed');
+    throw err;
+  }
 }
`;
    assert.equal(run(errorSwallowDetector, diff).length, 0);
  });
});

describe('cheat-detector / exception-rethrow-lost-context', () => {
  it('blocks throw err → throw new Error without cause', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,5 +1,5 @@
 function f() {
   try { inner(); } catch (err) {
-    throw err;
+    throw new Error('inner failed');
   }
 }
`;
    assert.equal(run(exceptionRethrowLostContextDetector, diff).length, 1);
  });

  it('does not fire when { cause } is preserved', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,5 +1,5 @@
 function f() {
   try { inner(); } catch (err) {
-    throw err;
+    throw new Error('inner failed', { cause: err });
   }
 }
`;
    assert.equal(run(exceptionRethrowLostContextDetector, diff).length, 0);
  });
});

describe('cheat-detector / dead-branch-insertion', () => {
  it('blocks an added if (false) block', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,4 @@
 function f() {
+  if (false) { return -1; }
   return 1;
 }
`;
    assert.equal(run(deadBranchInsertionDetector, diff).length, 1);
  });

  it('does not fire on a meaningful condition', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,4 @@
 function f(x) {
+  if (x < 0) { return -1; }
   return x;
 }
`;
    assert.equal(run(deadBranchInsertionDetector, diff).length, 0);
  });
});
