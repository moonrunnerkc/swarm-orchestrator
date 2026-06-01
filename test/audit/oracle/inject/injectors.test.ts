import { strict as assert } from 'assert';
import * as crypto from 'crypto';
import parseDiff from 'parse-diff';
import { INJECTORS } from '../../../../src/audit/oracle/inject';
import {
  runInjectors,
  type CleanPrInput,
} from '../../../../src/audit/oracle/inject/injection-runner';

// A carrier PR that touches both a source file and a test file, so every
// injector has a carrier of the kind it needs.
const SAMPLE_PR: CleanPrInput = {
  prId: 'sample-owner-repo-pr1',
  sourcePrUrl: 'https://github.com/owner/repo/pull/1',
  prTitle: 'Add pricing helper and tests',
  cleanDiff: `diff --git a/src/pricing.ts b/src/pricing.ts
--- a/src/pricing.ts
+++ b/src/pricing.ts
@@ -1,3 +1,3 @@
 export function price(x: number): number {
-  return x;
+  return x * 2;
 }
diff --git a/src/pricing.test.ts b/src/pricing.test.ts
--- a/src/pricing.test.ts
+++ b/src/pricing.test.ts
@@ -1,4 +1,4 @@
 import { price } from './pricing';
 it('doubles', () => {
-  expect(price(2)).toBe(2);
+  expect(price(2)).toBe(4);
 });
`,
};

describe('oracle / injectors', () => {
  it('registers all 11 structural plus 2 semantic categories', () => {
    const categories = new Set(INJECTORS.map((i) => i.category));
    for (const c of [
      'test-relaxation',
      'mock-of-hallucination',
      'assertion-strip',
      'no-op-fix',
      'coverage-erosion',
      'fake-refactor',
      'comment-only-fix',
      'error-swallow',
      'exception-rethrow-lost-context',
      'dead-branch-insertion',
      'type-suppression',
      'goal-not-fixed',
      'cheat-mock-mutation',
    ]) {
      assert.ok(categories.has(c as never), `missing injector for ${c}`);
    }
    assert.equal(INJECTORS.length, 13);
  });

  it('injects every category into a PR that has both a source and a test file', () => {
    const { cases } = runInjectors([SAMPLE_PR], { perInjectorCap: 5 });
    const got = new Set(cases.map((c) => c.category));
    assert.equal(got.size, INJECTORS.length, `expected all categories, got ${[...got].join(', ')}`);
  });

  it('produces broken diffs that parse and carry the stamped sha256', () => {
    const { cases } = runInjectors([SAMPLE_PR], { perInjectorCap: 5 });
    for (const c of cases) {
      const files = parseDiff(c.brokenDiff);
      assert.ok(files.length >= 1, `${c.injectorId}: broken diff did not parse`);
      const sha = crypto.createHash('sha256').update(c.brokenDiff).digest('hex');
      assert.equal(sha, c.label.sha256, `${c.injectorId}: sha256 mismatch`);
      assert.ok(c.label.startLine <= c.label.endLine, `${c.injectorId}: bad line range`);
      assert.equal(c.label.category, c.injectorId === c.category ? c.category : c.label.category);
    }
  });

  // Whole-PR detectors are tested with a standalone (isolated) diff, so
  // they do not preserve the carrier; the append-only invariant is for the
  // rest.
  const ISOLATED = new Set(['comment-only-fix', 'coverage-erosion', 'no-op-fix']);

  it('keeps the carrier PR content intact and only appends lines', () => {
    const { cases } = runInjectors([SAMPLE_PR], { perInjectorCap: 5 });
    const cleanLines = SAMPLE_PR.cleanDiff.split('\n');
    for (const c of cases) {
      if (ISOLATED.has(c.category)) continue;
      // Append-only: every line of the clean diff survives (as a multiset
      // subset) in the broken variant, which is longer.
      const broken = c.brokenDiff.split('\n');
      const pool = new Map<string, number>();
      for (const l of broken) pool.set(l, (pool.get(l) ?? 0) + 1);
      for (const l of cleanLines) {
        const n = pool.get(l) ?? 0;
        assert.ok(n > 0, `${c.injectorId}: clean line not preserved: ${JSON.stringify(l)}`);
        pool.set(l, n - 1);
      }
      assert.ok(broken.length > cleanLines.length, `${c.injectorId}: nothing appended`);
    }
  });

  it('stamps a claim on the semantic categories', () => {
    const { cases } = runInjectors([SAMPLE_PR], { perInjectorCap: 5 });
    for (const c of cases.filter((x) => x.category === 'goal-not-fixed' || x.category === 'cheat-mock-mutation')) {
      assert.ok(c.label.claim && c.label.claim.length > 0, `${c.injectorId}: missing claim`);
    }
  });

  it('is deterministic: same input yields byte-identical diffs and shas', () => {
    const a = runInjectors([SAMPLE_PR], { perInjectorCap: 5 });
    const b = runInjectors([SAMPLE_PR], { perInjectorCap: 5 });
    assert.equal(a.cases.length, b.cases.length);
    for (let i = 0; i < a.cases.length; i += 1) {
      assert.equal(a.cases[i]?.brokenDiff, b.cases[i]?.brokenDiff);
      assert.equal(a.cases[i]?.label.sha256, b.cases[i]?.label.sha256);
    }
  });

  it('refuses test-carrier categories when the PR has no test file', () => {
    const srcOnly: CleanPrInput = {
      ...SAMPLE_PR,
      cleanDiff: `diff --git a/src/only.ts b/src/only.ts
--- a/src/only.ts
+++ b/src/only.ts
@@ -1,2 +1,3 @@
 export const x = 1;
+export const y = 2;
`,
    };
    const { cases } = runInjectors([srcOnly], { perInjectorCap: 5 });
    const got = new Set(cases.map((c) => c.category));
    assert.ok(!got.has('assertion-strip'), 'assertion-strip should refuse without a test file');
    assert.ok(!got.has('cheat-mock-mutation'), 'cheat-mock-mutation should refuse without a test file');
    // Source-carrier categories still inject.
    assert.ok(got.has('error-swallow'));
  });
});
