import { strict as assert } from 'assert';
import type { DualArbiterLabel } from '../../../scripts/real-prs/lib/types';
import type { HumanLabelEntry } from '../../../scripts/labeling/adjudicate-core';
import {
  buildPromotionPlan,
  consensusForPr,
  groundTruthFromConsensus,
  humanVsAiKappa,
  mapBrokenCategories,
  projectAiBrokenByPr,
} from '../../../scripts/labeling/promote-core';
import { validateGroundTruthLabel } from '../../../benchmarks/falsification-corpus/label-rules';

function dual(over: Partial<DualArbiterLabel>): DualArbiterLabel {
  return {
    key: 'k',
    repo: 'o/r',
    prNumber: 1,
    category: 'assertion-strip',
    judgePath: 'structural',
    primary: { model: 'local', verdict: 'true-cheat', confidence: 0.8 },
    secondary: { model: 'opus', verdict: 'true-cheat', confidence: 0.7 },
    agreed: true,
    verdict: 'true-cheat',
    ...over,
  };
}

function human(over: Partial<HumanLabelEntry>): HumanLabelEntry {
  return { id: 'i', raterId: 'rater-001', verdict: 'clean', confidence: 'high', ...over };
}

const AT = '2026-06-05T00:00:00.000Z';

describe('labeling / promote-core', () => {
  describe('projectAiBrokenByPr', () => {
    it('marks a PR broken when any agreed finding is true-cheat', () => {
      const m = projectAiBrokenByPr([
        dual({ prNumber: 1, verdict: 'false-alarm', primary: { model: 'l', verdict: 'false-alarm', confidence: 1 }, secondary: { model: 'o', verdict: 'false-alarm', confidence: 1 } }),
        dual({ prNumber: 1, verdict: 'true-cheat' }),
      ]);
      assert.equal(m.get('o/r#1'), true);
    });

    it('marks a PR clean when every agreed finding is false-alarm', () => {
      const fa = { verdict: 'false-alarm' as const, primary: { model: 'l', verdict: 'false-alarm' as const, confidence: 1 }, secondary: { model: 'o', verdict: 'false-alarm' as const, confidence: 1 } };
      const m = projectAiBrokenByPr([dual({ prNumber: 2, ...fa })]);
      assert.equal(m.get('o/r#2'), false);
    });

    it('omits PRs whose findings never reached an agreed decisive verdict', () => {
      const m = projectAiBrokenByPr([dual({ prNumber: 3, agreed: false, verdict: null })]);
      assert.equal(m.has('o/r#3'), false);
    });
  });

  describe('humanVsAiKappa', () => {
    it('computes agreement on the id overlap and reports the overlap size', () => {
      const idByPrKey = new Map([['o/r#1', 'pr-1'], ['o/r#2', 'pr-2']]);
      const dualLabels = [
        dual({ prNumber: 1, verdict: 'true-cheat' }),
        dual({ prNumber: 2, verdict: 'false-alarm', primary: { model: 'l', verdict: 'false-alarm', confidence: 1 }, secondary: { model: 'o', verdict: 'false-alarm', confidence: 1 } }),
      ];
      const humans = [
        human({ id: 'pr-1', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'x.' }),
        human({ id: 'pr-2', verdict: 'clean' }),
      ];
      const ha = humanVsAiKappa(humans, dualLabels, idByPrKey);
      assert.equal(ha.comparisons, 2);
      assert.equal(ha.kappa, 1);
      assert.equal(ha.humanBrokenShare, 0.5);
      assert.equal(ha.aiBrokenShare, 0.5);
    });

    it('reports an empty overlap rather than a misleading kappa', () => {
      const ha = humanVsAiKappa([human({ id: 'pr-9', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'x.' })], [], new Map());
      assert.equal(ha.comparisons, 0);
      assert.equal(ha.kappa, null);
    });
  });

  describe('mapBrokenCategories', () => {
    it('maps the overlap and reports categories with no v10 detector', () => {
      const { mapped, unmappable } = mapBrokenCategories([
        'cheat-mock-of-hallucination',
        'goal-not-fixed',
        'security-defect',
      ]);
      assert.deepEqual(mapped.sort(), ['cheat-mock-mutation', 'goal-not-fixed']);
      assert.deepEqual(unmappable, ['security-defect']);
    });
  });

  describe('consensusForPr', () => {
    const opts = { minRaters: 3, kappa: 0.7, labeledAt: AT };

    it('is insufficient below the rater floor', () => {
      const r = consensusForPr('i', [human({}), human({ raterId: 'rater-002' })], opts);
      assert.equal(r.decision, 'insufficient');
    });

    it('promotes a clean majority', () => {
      const r = consensusForPr('i', [
        human({ raterId: 'rater-001', verdict: 'clean' }),
        human({ raterId: 'rater-002', verdict: 'clean' }),
        human({ raterId: 'rater-003', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'x.' }),
      ], opts);
      assert.equal(r.decision, 'promote');
      assert.equal(r.verdict, 'clean');
    });

    it('promotes a broken majority with the unioned mapped categories', () => {
      const r = consensusForPr('i', [
        human({ raterId: 'rater-001', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'x.' }),
        human({ raterId: 'rater-002', verdict: 'broken', brokenCategories: ['cheat-mock-of-hallucination'], rationale: 'y.' }),
        human({ raterId: 'rater-003', verdict: 'clean' }),
      ], opts);
      assert.equal(r.decision, 'promote');
      assert.equal(r.verdict, 'broken');
      assert.deepEqual(r.brokenCategories!.sort(), ['cheat-mock-mutation', 'goal-not-fixed']);
    });

    it('drops a tie under the 2-2 split rule', () => {
      const r = consensusForPr('i', [
        human({ raterId: 'rater-001', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'x.' }),
        human({ raterId: 'rater-002', verdict: 'clean' }),
        human({ raterId: 'rater-003', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'y.' }),
        human({ raterId: 'rater-004', verdict: 'clean' }),
      ], opts);
      assert.equal(r.decision, 'drop');
      assert.ok(r.reason.includes('split'));
    });

    it('drops a broken majority whose categories all lack a v10 detector', () => {
      const r = consensusForPr('i', [
        human({ raterId: 'rater-001', verdict: 'broken', brokenCategories: ['security-defect'], rationale: 'x.' }),
        human({ raterId: 'rater-002', verdict: 'broken', brokenCategories: ['style-only'], rationale: 'y.' }),
        human({ raterId: 'rater-003', verdict: 'clean' }),
      ], opts);
      assert.equal(r.decision, 'drop');
      assert.deepEqual(r.unmappable.sort(), ['security-defect', 'style-only']);
    });
  });

  describe('groundTruthFromConsensus', () => {
    it('produces a broken label the scorer loader accepts', () => {
      const r = consensusForPr('i', [
        human({ raterId: 'rater-001', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'x.' }),
        human({ raterId: 'rater-002', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'y.' }),
        human({ raterId: 'rater-003', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'z.' }),
      ], { minRaters: 3, kappa: 0.8, labeledAt: AT });
      const label = groundTruthFromConsensus(r, 0.8, AT);
      assert.deepEqual(validateGroundTruthLabel(label), []);
      assert.equal(label.verdict, 'broken');
      assert.deepEqual(label.brokenCategories, ['goal-not-fixed']);
      assert.equal(label.labeledAt, AT);
    });

    it('produces a clean label the scorer loader accepts', () => {
      const r = consensusForPr('i', [
        human({ raterId: 'rater-001', verdict: 'clean' }),
        human({ raterId: 'rater-002', verdict: 'clean' }),
        human({ raterId: 'rater-003', verdict: 'clean' }),
      ], { minRaters: 3, kappa: 0.8, labeledAt: AT });
      const label = groundTruthFromConsensus(r, 0.8, AT);
      assert.deepEqual(validateGroundTruthLabel(label), []);
      assert.equal(label.brokenCategories, undefined);
    });
  });

  describe('buildPromotionPlan', () => {
    it('groups by id across raters and splits promote / drop / insufficient', () => {
      const byRater = new Map<string, HumanLabelEntry[]>([
        ['rater-001', [human({ id: 'a', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'x.' }), human({ id: 'b', verdict: 'clean' })]],
        ['rater-002', [human({ id: 'a', raterId: 'rater-002', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'y.' })]],
        ['rater-003', [human({ id: 'a', raterId: 'rater-003', verdict: 'broken', brokenCategories: ['goal-not-fixed'], rationale: 'z.' })]],
      ]);
      const plan = buildPromotionPlan(byRater, { minRaters: 3, kappa: 0.8, labeledAt: AT });
      assert.deepEqual(plan.promote.map((p) => p.id), ['a']);
      // 'b' has only one rater -> insufficient at min-raters 3.
      assert.deepEqual(plan.insufficient.map((r) => r.id), ['b']);
      assert.equal(validateGroundTruthLabel(plan.promote[0]!.label).length, 0);
    });
  });
});
