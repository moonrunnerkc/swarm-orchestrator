import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import { verifyFindings } from '../../../src/audit/cheat-detector/verify-findings';
import type { Finding } from '../../../src/audit/types';

function finding(over: Partial<Finding>): Finding {
  return {
    category: 'no-op-fix',
    severity: 'warn',
    message: 'm',
    location: { file: 'src/a.ts', line: 1 },
    evidence: 'e',
    ...over,
  };
}

const noFiles = parseDiff('');

describe('cheat-detector / verify-findings', () => {
  it('demotes no-op-fix and coverage-erosion to info when the PR makes no fix claim', () => {
    const findings = [
      finding({ category: 'no-op-fix', severity: 'warn' }),
      finding({ category: 'coverage-erosion', severity: 'warn' }),
      finding({ category: 'error-swallow', severity: 'warn' }),
    ];
    const { kept, suppressed } = verifyFindings(findings, {
      files: noFiles,
      intent: { claimsFix: false, evidence: '' },
    });
    // All three are kept; the two fix-claim-gated ones drop to info.
    assert.equal(kept.length, 3);
    const byCat = new Map(kept.map((f) => [f.category, f.severity]));
    assert.equal(byCat.get('no-op-fix'), 'info');
    assert.equal(byCat.get('coverage-erosion'), 'info');
    assert.equal(byCat.get('error-swallow'), 'warn');
    assert.equal(suppressed.length, 0);
  });

  it('keeps no-op-fix at its emitted severity when the PR claims a fix', () => {
    const findings = [finding({ category: 'no-op-fix', severity: 'warn' })];
    const { kept } = verifyFindings(findings, {
      files: noFiles,
      intent: { claimsFix: true, evidence: 'This PR fixes the bug' },
    });
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.severity, 'warn');
  });

  it('suppresses fake-refactor when one removed symbol maps to several new names', () => {
    const mk = (newName: string) =>
      finding({
        category: 'fake-refactor',
        severity: 'block',
        location: { file: 'src/storage.ts', line: 3 },
        message: `Function "WORD_LIST_STORAGE_KEY" was renamed to "${newName}" in src/storage.ts but 1 caller reference remains`,
      });
    const findings = [mk('STORAGE_KEYS'), mk('PREMIUM_STATUS_STORAGE_KEY'), mk('createStorageAdapter')];
    const { kept, suppressed } = verifyFindings(findings, {
      files: noFiles,
      intent: { claimsFix: false, evidence: '' },
    });
    assert.equal(kept.length, 0);
    assert.equal(suppressed.length, 3);
    assert.ok(suppressed.every((s) => s.rule === 'ambiguous-rename'));
  });

  it('keeps a single unambiguous fake-refactor rename', () => {
    const findings = [
      finding({
        category: 'fake-refactor',
        severity: 'block',
        location: { file: 'src/a.ts', line: 1 },
        message: 'Function "oldName" was renamed to "newName" in src/a.ts but 1 caller reference remains',
      }),
    ];
    const { kept } = verifyFindings(findings, {
      files: noFiles,
      intent: { claimsFix: false, evidence: '' },
    });
    assert.equal(kept.length, 1);
  });

  it('suppresses test-removal findings when the PR also deletes non-test source', () => {
    const files = parseDiff(`diff --git a/src/feature.ts b/src/feature.ts
deleted file mode 100644
--- a/src/feature.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export function feature() {}
-
`);
    const findings = [
      finding({ category: 'assertion-strip', severity: 'block', location: { file: 'test/feature.test.ts', line: 1 } }),
    ];
    const { kept, suppressed } = verifyFindings(findings, {
      files,
      intent: { claimsFix: false, evidence: '' },
    });
    assert.equal(kept.length, 0);
    assert.equal(suppressed[0]!.rule, 'source-co-removed');
  });

  it('drops a removed-block finding when the block is re-added elsewhere (relocated)', () => {
    // The block is deleted in one hunk and re-added (parametrized) in
    // another hunk of the same file: coverage is preserved.
    const files = parseDiff(`diff --git a/test/batching.test.ts b/test/batching.test.ts
--- a/test/batching.test.ts
+++ b/test/batching.test.ts
@@ -1,4 +1,2 @@
-describe('batchIndex', () => {
-  test('batchIndex is passed correctly', () => { expect(x).toBe(1); });
-});
 const keep = 1;
@@ -40,1 +38,5 @@
 const scenarios = [{ link: 'a' }, { link: 'b' }];
+describe.each(scenarios)('batchIndex', (s) => {
+  test('batchIndex is passed correctly', () => { expect(x).toBe(1); });
+  test('error path', () => { expect(y).toBe(2); });
+});
`);
    const findings = [
      finding({
        category: 'test-relaxation',
        severity: 'block',
        location: { file: 'test/batching.test.ts', line: 1 },
        message: 'Test block was removed without a replacement in the same hunk. Coverage for the original case is now zero.',
        evidence: "- describe('batchIndex', () => {",
      }),
    ];
    const { kept, suppressed } = verifyFindings(findings, {
      files,
      intent: { claimsFix: false, evidence: '' },
    });
    assert.equal(kept.length, 0);
    assert.equal(suppressed[0]!.rule, 'test-relocated');
  });

  it('keeps a removed-block finding when nothing is re-added', () => {
    const files = parseDiff(`diff --git a/test/x.test.ts b/test/x.test.ts
--- a/test/x.test.ts
+++ b/test/x.test.ts
@@ -1,4 +1,1 @@
-describe('gone', () => {
-  it('checks', () => { expect(x).toBe(1); });
-});
 const keep = 1;
`);
    const findings = [
      finding({
        category: 'test-relaxation',
        severity: 'block',
        location: { file: 'test/x.test.ts', line: 1 },
        message: 'Test block was removed without a replacement in the same hunk. Coverage for the original case is now zero.',
        evidence: "- describe('gone', () => {",
      }),
    ];
    const { kept } = verifyFindings(findings, {
      files,
      intent: { claimsFix: false, evidence: '' },
    });
    assert.equal(kept.length, 1);
  });

  it('keeps test-removal findings when no source is deleted', () => {
    const files = parseDiff(`diff --git a/test/x.test.ts b/test/x.test.ts
--- a/test/x.test.ts
+++ b/test/x.test.ts
@@ -1,3 +1,1 @@
-expect(a).toBe(1);
 const a = 1;
`);
    const findings = [finding({ category: 'assertion-strip', severity: 'block', location: { file: 'test/x.test.ts', line: 1 } })];
    const { kept } = verifyFindings(findings, {
      files,
      intent: { claimsFix: false, evidence: '' },
    });
    assert.equal(kept.length, 1);
  });
});
