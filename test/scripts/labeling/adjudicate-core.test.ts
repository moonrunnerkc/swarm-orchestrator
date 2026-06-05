import { strict as assert } from 'assert';
import type { DualArbiterLabel } from '../../../scripts/real-prs/lib/types';
import {
  buildAdjudicationQueue,
  entryFromDecision,
  mergeRaterEntries,
  renderWorksheet,
  validateDecision,
  type AdjudicationDecision,
  type HumanLabelEntry,
} from '../../../scripts/labeling/adjudicate-core';

function dual(over: Partial<DualArbiterLabel>): DualArbiterLabel {
  return {
    key: 'k',
    repo: 'o/r',
    prNumber: 1,
    category: 'assertion-strip',
    judgePath: 'structural',
    primary: { model: 'local', verdict: 'true-cheat', confidence: 0.8 },
    secondary: { model: 'opus', verdict: 'false-alarm', confidence: 0.7 },
    agreed: false,
    verdict: null,
    ...over,
  };
}

describe('labeling / adjudicate-core', () => {
  describe('buildAdjudicationQueue', () => {
    it('surfaces only arbiter-split findings and drops agreed ones', () => {
      const labels = [
        dual({ key: 'a', repo: 'o/r', prNumber: 1, agreed: false }),
        dual({ key: 'b', repo: 'o/r', prNumber: 2, agreed: true, verdict: 'true-cheat' }),
      ];
      const queue = buildAdjudicationQueue(labels, () => null);
      assert.equal(queue.totalSplitFindings, 1);
      assert.equal(queue.rows.length, 1);
      assert.equal(queue.rows[0]!.prKey, 'o/r#1');
    });

    it('groups split findings by PR and counts sharp splits', () => {
      const labels = [
        dual({ key: 'a', prNumber: 1, category: 'assertion-strip' }),
        dual({ key: 'b', prNumber: 1, category: 'coverage-erosion' }),
        dual({ key: 'c', prNumber: 1, category: 'test-relaxation' }),
      ];
      const queue = buildAdjudicationQueue(labels, () => null);
      assert.equal(queue.rows.length, 1);
      const row = queue.rows[0]!;
      assert.equal(row.splitFindings.length, 3);
      // coverage-erosion is low-priority, the other two are sharp.
      assert.equal(row.sharpSplitCount, 2);
      assert.equal(row.infoScore, 2 * 2 + 3);
    });

    it('orders PRs highest information first, ties broken by PR key', () => {
      const labels = [
        dual({ key: 'lo', repo: 'o/r', prNumber: 9, category: 'coverage-erosion' }),
        dual({ key: 'hi1', repo: 'o/r', prNumber: 2, category: 'assertion-strip' }),
        dual({ key: 'hi2', repo: 'o/r', prNumber: 2, category: 'test-relaxation' }),
      ];
      const queue = buildAdjudicationQueue(labels, () => null);
      assert.deepEqual(
        queue.rows.map((r) => r.prKey),
        ['o/r#2', 'o/r#9'],
      );
    });

    it('resolves corpus ids and reports the ones it cannot', () => {
      const labels = [
        dual({ key: 'a', repo: 'o/r', prNumber: 1 }),
        dual({ key: 'b', repo: 'o/r', prNumber: 7 }),
      ];
      const resolve = (repo: string, n: number): string | null =>
        n === 1 ? `devin-${repo.replace('/', '-')}-pr${n}` : null;
      const queue = buildAdjudicationQueue(labels, resolve);
      const resolved = queue.rows.find((r) => r.prNumber === 1)!;
      assert.equal(resolved.id, 'devin-o-r-pr1');
      assert.deepEqual(queue.unresolvedPrKeys, ['o/r#7']);
    });
  });

  describe('validateDecision', () => {
    const base: AdjudicationDecision = {
      id: 'devin-o-r-pr1',
      raterId: 'rater-001',
      verdict: 'clean',
      confidence: 'high',
    };

    it('accepts a well-formed clean decision', () => {
      assert.deepEqual(validateDecision(base), []);
    });

    it('requires broken categories on a broken verdict', () => {
      const issues = validateDecision({ ...base, verdict: 'broken', rationale: 'It cheats badly here.' });
      assert.ok(issues.some((i) => i.includes('at least one brokenCategory')));
    });

    it('rejects categories on a non-broken verdict', () => {
      const issues = validateDecision({
        ...base,
        verdict: 'clean',
        brokenCategories: ['goal-not-fixed'],
      });
      assert.ok(issues.some((i) => i.includes('only be set when verdict is broken')));
    });

    it('rejects unknown categories and bad rater ids', () => {
      const issues = validateDecision({
        ...base,
        raterId: 'rater-1',
        verdict: 'broken',
        brokenCategories: ['not-a-category'],
        rationale: 'x. y. z.',
      });
      assert.ok(issues.some((i) => i.includes('raterId must match')));
      assert.ok(issues.some((i) => i.includes('unknown brokenCategories')));
    });

    it('requires a rationale on broken and ambiguous', () => {
      assert.ok(
        validateDecision({ ...base, verdict: 'ambiguous' }).some((i) => i.includes('rationale is required')),
      );
      assert.ok(
        validateDecision({
          ...base,
          verdict: 'broken',
          brokenCategories: ['goal-not-fixed'],
        }).some((i) => i.includes('rationale is required')),
      );
    });
  });

  describe('entryFromDecision', () => {
    it('drops empty optional fields and keeps broken categories', () => {
      const entry = entryFromDecision({
        id: 'x',
        raterId: 'rater-001',
        verdict: 'broken',
        confidence: 'medium',
        brokenCategories: ['goal-not-fixed'],
        rationale: '  it never fixed the bug.  ',
      });
      assert.deepEqual(entry, {
        id: 'x',
        raterId: 'rater-001',
        verdict: 'broken',
        confidence: 'medium',
        brokenCategories: ['goal-not-fixed'],
        rationale: 'it never fixed the bug.',
      });
    });

    it('omits brokenCategories on a clean verdict', () => {
      const entry = entryFromDecision({
        id: 'x',
        raterId: 'rater-001',
        verdict: 'clean',
        confidence: 'high',
      });
      assert.equal(entry.brokenCategories, undefined);
    });
  });

  describe('mergeRaterEntries', () => {
    const a: HumanLabelEntry = { id: 'a', raterId: 'rater-001', verdict: 'clean', confidence: 'high' };
    const aBroken: HumanLabelEntry = {
      id: 'a',
      raterId: 'rater-001',
      verdict: 'broken',
      confidence: 'high',
      brokenCategories: ['goal-not-fixed'],
      rationale: 'changed.',
    };
    const b: HumanLabelEntry = { id: 'b', raterId: 'rater-001', verdict: 'clean', confidence: 'low' };

    it('adds new ids and skips existing ones without --replace', () => {
      const r = mergeRaterEntries([a], [aBroken, b], false);
      assert.deepEqual(r.added, ['b']);
      assert.deepEqual(r.skipped, ['a']);
      assert.equal(r.merged.find((e) => e.id === 'a')!.verdict, 'clean');
    });

    it('overwrites an existing id with --replace', () => {
      const r = mergeRaterEntries([a], [aBroken], true);
      assert.deepEqual(r.replaced, ['a']);
      assert.equal(r.merged.find((e) => e.id === 'a')!.verdict, 'broken');
    });

    it('keeps the merged list sorted by id', () => {
      const r = mergeRaterEntries([b], [a], false);
      assert.deepEqual(r.merged.map((e) => e.id), ['a', 'b']);
    });
  });

  describe('renderWorksheet', () => {
    it('renders a fill-in block per PR and flags unresolved ids', () => {
      const queue = buildAdjudicationQueue(
        [dual({ key: 'a', repo: 'o/r', prNumber: 7, category: 'assertion-strip' })],
        () => null,
      );
      const md = renderWorksheet(queue);
      assert.ok(md.includes('## o/r#7'));
      assert.ok(md.includes('unresolved'));
      assert.ok(md.includes('- verdict:'));
    });
  });
});
