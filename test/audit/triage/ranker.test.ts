import { strict as assert } from 'assert';
import { scoreLogistic, trainLogistic } from '../../../src/audit/triage/ranker';

describe('triage/ranker', () => {
  it('learns to separate a linearly separable problem from soft labels', () => {
    // One informative feature: positives have x0 high, negatives low.
    const x: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      x.push([2, 0.5]);
      y.push(0.95);
      x.push([-2, 0.5]);
      y.push(0.05);
    }
    const model = trainLogistic(x, y, { iterations: 800, learningRate: 0.3 });
    assert.ok(scoreLogistic(model, [2, 0.5]) > 0.8, 'positive scores high');
    assert.ok(scoreLogistic(model, [-2, 0.5]) < 0.2, 'negative scores low');
    // The informative feature carries more weight than the constant one.
    assert.ok(Math.abs(model.weights[0]) > Math.abs(model.weights[1]));
  });

  it('ranks monotonically in the informative feature', () => {
    const x: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      x.push([1]);
      y.push(0.9);
      x.push([-1]);
      y.push(0.1);
    }
    const model = trainLogistic(x, y);
    assert.ok(scoreLogistic(model, [3]) > scoreLogistic(model, [1]));
    assert.ok(scoreLogistic(model, [1]) > scoreLogistic(model, [-1]));
  });

  it('handles a constant feature column without NaN', () => {
    const x = [[1], [1], [1], [1]];
    const y = [0.5, 0.5, 0.5, 0.5];
    const model = trainLogistic(x, y);
    const s = scoreLogistic(model, [1]);
    assert.ok(Number.isFinite(s));
  });

  it('returns a degenerate model on empty input', () => {
    const model = trainLogistic([], []);
    assert.equal(model.weights.length, 0);
    assert.equal(model.bias, 0);
  });
});
