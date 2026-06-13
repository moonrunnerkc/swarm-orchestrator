import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import { assertionStripDetector } from '../../../src/audit/cheat-detector/assertion-strip';
import type { Finding } from '../../../src/audit/types';

function runOn(diff: string): Finding[] {
  const files = parseDiff(diff);
  return assertionStripDetector.run({ files, repoRoot: '.' }) as Finding[];
}

describe('cheat-detector / assertion-strip', () => {
  it('flags a net drop in assertion count for a test file', () => {
    const diff = `diff --git a/x.test.ts b/x.test.ts
--- a/x.test.ts
+++ b/x.test.ts
@@ -1,5 +1,2 @@
 it('does X', () => {
-  expect(a).toBe(1);
-  expect(b).toBe(2);
-  expect(c).toBe(3);
 });
`;
    const findings = runOn(diff);
    assert.equal(findings.length, 3);
    assert.ok(findings.every((f) => f.category === 'assertion-strip' && f.severity === 'block'));
  });

  it('does not flag when removed assertions are matched by adds', () => {
    const diff = `diff --git a/x.test.ts b/x.test.ts
--- a/x.test.ts
+++ b/x.test.ts
@@ -1,4 +1,4 @@
 it('does X', () => {
-  expect(a).toBe(1);
+  expect(a).toEqual({ kind: 1 });
 });
`;
    const findings = runOn(diff);
    assert.equal(findings.length, 0);
  });

  it('does not flag consolidating looser matchers into one exact-match on the same subject', () => {
    // The wild-PR pattern: two toContain substring checks on one subject become
    // a single exact toBe re-specification for a deliberate behaviour change.
    const diff = `diff --git a/x.test.ts b/x.test.ts
--- a/x.test.ts
+++ b/x.test.ts
@@ -1,5 +1,4 @@
 it('captions', () => {
-  expect(model.shareCaption).toContain("300");
-  expect(model.shareCaption).toContain("200");
+  expect(model.shareCaption).toBe("closeout for day 7");
 });
`;
    assert.equal(runOn(diff).length, 0);
  });

  it('still flags a genuine strip even when an unrelated exact-match is added', () => {
    const diff = `diff --git a/x.test.ts b/x.test.ts
--- a/x.test.ts
+++ b/x.test.ts
@@ -1,5 +1,3 @@
 it('does X', () => {
-  expect(a).toContain("x");
-  expect(b).toBe(2);
+  expect(c).toBe(3);
 });
`;
    // a's subject gained no exact-match add, so its removed assertion is still a
    // strip (only c gained an exact-match).
    const findings = runOn(diff);
    assert.ok(findings.length >= 1, 'the dropped assertion on `a` is still flagged');
  });

  it('ignores non-test files', () => {
    const diff = `diff --git a/lib.ts b/lib.ts
--- a/lib.ts
+++ b/lib.ts
@@ -1,3 +1,1 @@
-  expect(1).toBe(1);
-  expect(2).toBe(2);
 const x = 1;
`;
    const findings = runOn(diff);
    assert.equal(findings.length, 0);
  });
});
