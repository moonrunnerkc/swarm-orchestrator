import { strict as assert } from 'assert';
import {
  clopperPearsonLower,
  regularizedIncompleteBeta,
  selectThreshold,
} from '../../../src/audit/triage/conformal';
import type { ScoredInstance } from '../../../src/audit/triage/metrics';

describe('triage/conformal', () => {
  describe('regularizedIncompleteBeta', () => {
    it('is a CDF: 0 at 0, 1 at 1, and symmetric for a=b', () => {
      assert.equal(regularizedIncompleteBeta(2, 3, 0), 0);
      assert.equal(regularizedIncompleteBeta(2, 3, 1), 1);
      // I_0.5(a, a) = 0.5 for any a.
      assert.ok(Math.abs(regularizedIncompleteBeta(4, 4, 0.5) - 0.5) < 1e-9);
    });
  });

  describe('clopperPearsonLower', () => {
    it('is 0 for zero successes', () => {
      assert.equal(clopperPearsonLower(0, 10, 0.05), 0);
    });

    it('equals alpha^(1/n) for all successes', () => {
      assert.ok(Math.abs(clopperPearsonLower(10, 10, 0.05) - Math.pow(0.05, 1 / 10)) < 1e-6);
    });

    it('matches the known 95% one-sided bound for 8/10', () => {
      // The one-sided 95% lower Clopper-Pearson bound for 8 of 10 is ~0.4930.
      const lower = clopperPearsonLower(8, 10, 0.05);
      assert.ok(lower > 0.45 && lower < 0.55, `lower ${lower}`);
      // It must lie below the point estimate.
      assert.ok(lower < 0.8);
    });

    it('tightens toward the point estimate as n grows', () => {
      const small = clopperPearsonLower(8, 10, 0.05);
      const large = clopperPearsonLower(800, 1000, 0.05);
      assert.ok(large > small, 'more data -> tighter (higher) lower bound');
    });
  });

  describe('selectThreshold', () => {
    it('picks the lowest threshold whose precision lower bound clears the target', () => {
      // High scores are clean positives; a tail of low-score negatives.
      const calib: ScoredInstance[] = [];
      for (let i = 0; i < 60; i += 1) calib.push({ score: 0.9 - i * 0.001, label: 1 });
      for (let i = 0; i < 40; i += 1) calib.push({ score: 0.3 - i * 0.001, label: 0 });
      const res = selectThreshold(calib, 0.9, 0.05);
      assert.ok(Number.isFinite(res.threshold));
      assert.ok(res.calibrationPrecisionLower >= 0.9, `lower ${res.calibrationPrecisionLower}`);
      assert.ok(res.calibrationPrecision >= 0.9);
      // Coverage should capture the clean positive block, not the negatives.
      assert.ok(res.flagged >= 50, `flagged ${res.flagged}`);
    });

    it('abstains on everything when no threshold can guarantee the target', () => {
      // Positives and negatives fully interleaved: no high-precision region.
      const calib: ScoredInstance[] = [];
      for (let i = 0; i < 50; i += 1) {
        calib.push({ score: 0.5 + i * 0.001, label: (i % 2) as 0 | 1 });
      }
      const res = selectThreshold(calib, 0.95, 0.05);
      assert.equal(res.threshold, Number.POSITIVE_INFINITY);
      assert.equal(res.calibrationCoverage, 0);
    });
  });
});
