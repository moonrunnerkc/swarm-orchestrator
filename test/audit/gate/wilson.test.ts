import { strict as assert } from 'assert';
import { wilsonLowerBound } from '../../../src/audit/gate/wilson';

describe('wilsonLowerBound', () => {
  it('is 0 with no trials', () => {
    assert.equal(wilsonLowerBound(0, 0), 0);
  });

  it('stays well below 1 for a single perfect firing', () => {
    const bound = wilsonLowerBound(1, 1);
    assert.ok(Math.abs(bound - 0.2065) < 1e-3, `expected ~0.2065, got ${bound}`);
  });

  it('rises toward the point precision as confirmations accumulate', () => {
    const few = wilsonLowerBound(5, 5);
    const many = wilsonLowerBound(50, 50);
    assert.ok(many > few, 'more confirmations at precision 1.0 raise the bound');
    assert.ok(many < 1, 'the bound never reaches 1');
  });

  it('matches the known value for 2 of 3', () => {
    assert.ok(Math.abs(wilsonLowerBound(2, 3) - 0.2077) < 1e-3);
  });
});
