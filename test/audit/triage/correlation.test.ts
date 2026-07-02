import { strict as assert } from 'assert';
import {
  contingencyFor,
  correlateAnyFired,
  correlateCategories,
  phiCoefficient,
  type LabeledRow,
} from '../../../src/audit/triage/correlation';

describe('triage/correlation', () => {
  describe('phiCoefficient', () => {
    it('is +1 for a perfectly positive association', () => {
      // Every bad row fires, every clean row does not.
      assert.equal(phiCoefficient({ n11: 10, n10: 0, n01: 0, n00: 10 }), 1);
    });

    it('is -1 for a perfectly negative association', () => {
      assert.equal(phiCoefficient({ n11: 0, n10: 10, n01: 10, n00: 0 }), -1);
    });

    it('is 0 for independence', () => {
      // Fires at the same rate in both groups: 5/10 bad, 5/10 clean.
      assert.equal(phiCoefficient({ n11: 5, n10: 5, n01: 5, n00: 5 }), 0);
    });

    it('returns 0 when a margin is empty rather than dividing by zero', () => {
      // Nothing ever fires: the column margin is empty.
      assert.equal(phiCoefficient({ n11: 0, n10: 7, n01: 0, n00: 9 }), 0);
      // No clean rows: the row margin is empty.
      assert.equal(phiCoefficient({ n11: 3, n10: 4, n01: 0, n00: 0 }), 0);
    });

    it('matches the closed form on a known table', () => {
      // 2x2 with n11=8,n10=2,n01=3,n00=7:
      // num = 8*7 - 2*3 = 50; den = sqrt(10*10*11*9) = sqrt(9900) = 99.4987...
      const phi = phiCoefficient({ n11: 8, n10: 2, n01: 3, n00: 7 });
      assert.ok(Math.abs(phi - 50 / Math.sqrt(9900)) < 1e-12);
    });
  });

  describe('contingencyFor', () => {
    it('counts rows into the four cells by label and firing', () => {
      const rows: LabeledRow[] = [
        { bad: true, firedCategories: new Set(['a']) },
        { bad: true, firedCategories: new Set(['b']) },
        { bad: false, firedCategories: new Set(['a']) },
        { bad: false, firedCategories: new Set<string>() },
      ];
      assert.deepEqual(contingencyFor(rows, 'a'), { n11: 1, n10: 1, n01: 1, n00: 1 });
    });
  });

  describe('correlateCategories', () => {
    it('reports rates, lift and phi, sorted by descending phi', () => {
      const rows: LabeledRow[] = [
        { bad: true, firedCategories: new Set(['signal']) },
        { bad: true, firedCategories: new Set(['signal']) },
        { bad: false, firedCategories: new Set(['noise']) },
        { bad: false, firedCategories: new Set(['noise']) },
      ];
      const result = correlateCategories(rows, ['noise', 'signal']);
      assert.equal(result[0].category, 'signal');
      assert.equal(result[0].rateBad, 1);
      assert.equal(result[0].rateNotBad, 0);
      assert.equal(result[0].lift, Number.POSITIVE_INFINITY);
      assert.equal(result[0].phi, 1);
      // 'noise' fires only on clean rows: perfectly negative.
      assert.equal(result[1].category, 'noise');
      assert.equal(result[1].phi, -1);
    });

    it('reports NaN lift when a category never fires in either group', () => {
      const rows: LabeledRow[] = [
        { bad: true, firedCategories: new Set<string>() },
        { bad: false, firedCategories: new Set<string>() },
      ];
      const [only] = correlateCategories(rows, ['absent']);
      assert.ok(Number.isNaN(only.lift));
      assert.equal(only.phi, 0);
    });
  });

  describe('correlateAnyFired', () => {
    it('collapses all categories into a single fired event', () => {
      const rows: LabeledRow[] = [
        { bad: true, firedCategories: new Set(['x', 'y']) },
        { bad: true, firedCategories: new Set<string>() },
        { bad: false, firedCategories: new Set(['z']) },
        { bad: false, firedCategories: new Set<string>() },
      ];
      const any = correlateAnyFired(rows);
      assert.deepEqual(any.table, { n11: 1, n10: 1, n01: 1, n00: 1 });
      assert.equal(any.phi, 0);
    });
  });
});
