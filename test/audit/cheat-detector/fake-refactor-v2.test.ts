// Tests for the v2.0 TypeScript-compiler-API call-graph closure on
// fake-refactor. v1.0 used a substring scan of other-file diff lines;
// v2.0 walks the TS AST of every diff-touched file's added text and
// flags only when an Identifier with the old name remains.

import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import { fakeRefactorDetector } from '../../../src/audit/cheat-detector/fake-refactor';
import type { Finding } from '../../../src/audit/types';

function run(diff: string): Finding[] {
  return fakeRefactorDetector.run({ files: parseDiff(diff), repoRoot: '.' }) as Finding[];
}

describe('fake-refactor v2.0 (TS compiler-API closure)', () => {
  it('declares a 2.x detector version', () => {
    assert.ok(fakeRefactorDetector.version.startsWith('2.'));
  });

  it('blocks a rename whose caller in another file still references the old name (via Identifier)', () => {
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
@@ -1,1 +1,2 @@
 import { compute } from './x';
+const r = compute(1);
`;
    const findings = run(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'block');
    assert.match(findings[0]!.message, /computeV2/);
    assert.match(findings[0]!.message, /caller\.ts/);
  });

  it('does NOT fire when the caller file updates to the new name', () => {
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
@@ -1,1 +1,2 @@
-import { compute } from './x';
+import { computeV2 } from './x';
+const r = computeV2(1);
`;
    assert.equal(run(diff).length, 0);
  });

  it('flags a self-referential within-file caller (recursive function not renamed at recursion site)', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,5 +1,5 @@
-export function factorial(n: number): number {
+export function fact(n: number): number {
   if (n <= 1) return 1;
   return n * factorial(n - 1);
 }
`;
    const findings = run(diff);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.message, /factorial/);
    assert.match(findings[0]!.message, /fact/);
  });

  it('does NOT fire when the within-file recursive call IS renamed', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,5 +1,5 @@
-export function factorial(n: number): number {
+export function fact(n: number): number {
   if (n <= 1) return 1;
-  return n * factorial(n - 1);
+  return n * fact(n - 1);
 }
`;
    assert.equal(run(diff).length, 0);
  });

  it('avoids the v1.0 substring FP: a string that contains the old name as a substring does NOT count as a caller', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,3 @@
-export function add(a: number, b: number): number {
+export function plus(a: number, b: number): number {
   return a + b;
 }
diff --git a/src/note.ts b/src/note.ts
--- a/src/note.ts
+++ b/src/note.ts
@@ -1,0 +1,1 @@
+export const MSG = 'add this to the cart';
`;
    // "add" appears as a substring of the string literal but no
    // Identifier in the AST is named "add"; v2.0 must not flag this.
    assert.equal(run(diff).length, 0);
  });

  it('avoids FP on a comment that mentions the old name', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,3 @@
-export function load(): number {
+export function loadFromDisk(): number {
   return 0;
 }
diff --git a/src/note.ts b/src/note.ts
--- a/src/note.ts
+++ b/src/note.ts
@@ -1,0 +1,1 @@
+// load is now exported as loadFromDisk
`;
    assert.equal(run(diff).length, 0);
  });

  it('skips test-file additions (tests are not the caller-graph closure target)', () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,3 @@
-export function compute(x: number): number {
+export function computeV2(x: number): number {
   return x;
 }
diff --git a/test/x.test.ts b/test/x.test.ts
--- a/test/x.test.ts
+++ b/test/x.test.ts
@@ -1,0 +1,1 @@
+it('compute', () => { compute(1); });
`;
    assert.equal(run(diff).length, 0);
  });
});
