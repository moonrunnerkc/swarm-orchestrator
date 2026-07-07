import { strict as assert } from 'assert';
import { computeClaimDifferentialPolicy } from '../../scripts/promotions/compute-promotions';

describe('computeClaimDifferentialPolicy', () => {
  it('is advisory-only with no measurement folded', () => {
    const p = computeClaimDifferentialPolicy(null);
    assert.equal(p.status, 'advisory-only');
    assert.equal(p.measured, null);
    assert.equal(p.wilsonFloor, 0.9);
    assert.equal(p.minTruePositive, 5);
  });

  it('stays advisory-only when a measurement is below the floor', () => {
    const p = computeClaimDifferentialPolicy({ truePositive: 6, falsePositive: 2, wilsonLower: 0.85 });
    assert.equal(p.status, 'advisory-only');
  });

  it('stays advisory-only when true positives are too few, even at high precision', () => {
    const p = computeClaimDifferentialPolicy({ truePositive: 3, falsePositive: 0, wilsonLower: 0.95 });
    assert.equal(p.status, 'advisory-only');
  });

  it('becomes gate-eligible only when both the floor and the TP minimum clear', () => {
    const p = computeClaimDifferentialPolicy({ truePositive: 8, falsePositive: 0, wilsonLower: 0.92 });
    assert.equal(p.status, 'gate-eligible');
  });
});
