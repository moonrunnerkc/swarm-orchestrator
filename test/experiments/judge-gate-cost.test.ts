import { strict as assert } from 'assert';
import {
  blockAtThreshold,
  costUsd,
  sweepThresholds,
} from '../../scripts/experiments/judge-gate-cost';

describe('judge-gate-cost threshold logic', () => {
  it('blocks when the yes-vote share reaches the threshold', () => {
    assert.equal(blockAtThreshold(3, 5, 0.6), true); // 0.6 >= 0.6
    assert.equal(blockAtThreshold(2, 5, 0.6), false); // 0.4 < 0.6
    assert.equal(blockAtThreshold(5, 5, 1.0), true); // unanimous clears tau=1
    assert.equal(blockAtThreshold(4, 5, 1.0), false);
  });

  it('never blocks on zero samples (avoids a divide-by-zero fire)', () => {
    assert.equal(blockAtThreshold(0, 0, 0.2), false);
  });

  it('counts fires per threshold across a set of vote counts', () => {
    const votes = [0, 1, 3, 5]; // shares 0, 0.2, 0.6, 1.0 out of 5
    const swept = sweepThresholds(votes, 5, [0.2, 0.6, 1.0]);
    assert.deepEqual(
      swept.map((s) => s.fires),
      [3, 2, 1], // >=0.2: {1,3,5}; >=0.6: {3,5}; >=1.0: {5}
    );
  });
});

describe('judge-gate-cost dollar cost', () => {
  it('prices input and output tokens at the per-million rates', () => {
    // 1,000,000 input at $1 + 200,000 output at $5 = 1.0 + 1.0 = 2.0
    assert.equal(costUsd(1_000_000, 200_000, 1.0, 5.0), 2.0);
  });

  it('returns zero for no spend', () => {
    assert.equal(costUsd(0, 0, 1.0, 5.0), 0);
  });
});
