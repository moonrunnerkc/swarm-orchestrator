import { strict as assert } from 'assert';
import { scoreCorpus } from '../../benchmarks/leaderboard/score';

// Per-category miss caps on the synthetic regression corpus. Each
// builder in scripts/corpus/generate-v10.ts produces fixtures the
// matching detector should catch on the broken side and stay quiet on
// the clean side; `failedExpectations` mixes both kinds. A category-
// wide drop is a real regression (e.g., a v2.0 detector landing
// without matching fixtures), not a synthetic-corpus quirk, and must
// fail CI immediately rather than coast under a coarse global budget.
//
// Caps are sized at ~5% of the category's case count rounded up to a
// small constant, so a one-off oddity in a single fixture passes but
// a category-wide regression trips at the first opportunity.

const PER_CATEGORY_MISS_CAP: Readonly<Record<string, number>> = {
  'assertion-strip': 3,
  'comment-only-fix': 3,
  'coverage-erosion': 3,
  'dead-branch-insertion': 3,
  'error-swallow': 3,
  'exception-rethrow-lost-context': 3,
  'fake-refactor': 3,
  'mock-of-hallucination': 3,
  'no-op-fix': 3,
  'test-relaxation': 4,
};

describe('leaderboard / corpus scoring', function () {
  this.timeout(60_000);

  it('every category stays at or under its per-category miss cap', async () => {
    const out = await scoreCorpus();

    // Bucket misses by category. `caseId` is `<category>-NNN`. The
    // category names themselves contain hyphens, so split on the last.
    const missesByCategory = new Map<string, number>();
    for (const f of out.failedExpectations) {
      const m = f.caseId.match(/^(.+)-\d+$/);
      const category = m?.[1] ?? '(unknown)';
      missesByCategory.set(category, (missesByCategory.get(category) ?? 0) + 1);
    }

    const violations: string[] = [];
    for (const [category, count] of missesByCategory) {
      const cap = PER_CATEGORY_MISS_CAP[category];
      if (cap === undefined) {
        violations.push(`unrecognized category "${category}": ${count} miss(es) and no cap declared`);
        continue;
      }
      if (count > cap) {
        violations.push(`${category}: ${count} misses (cap ${cap})`);
      }
    }
    assert.equal(
      violations.length,
      0,
      `per-category miss caps exceeded:\n  ${violations.join('\n  ')}`,
    );

    // A cap key that names a category not present in the corpus is
    // silently dead. Flag it so the cap table doesn't drift.
    const corpusCategories = new Set(out.perCategory.map((r) => r.category));
    const orphanCaps = Object.keys(PER_CATEGORY_MISS_CAP).filter(
      (k) => !corpusCategories.has(k),
    );
    assert.equal(
      orphanCaps.length,
      0,
      `cap keys not present in the corpus: ${orphanCaps.join(', ')}`,
    );

    assert.ok(out.corpusSize >= 500);
    assert.ok(out.perAgent.length >= 1);
    assert.equal(out.perCategory.length, 10);
  });
});
