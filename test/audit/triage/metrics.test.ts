import { strict as assert } from 'assert';
import {
  averagePrecision,
  baseRate,
  precisionAtBudget,
  recallAtBudget,
  type ScoredInstance,
} from '../../../src/audit/triage/metrics';

describe('triage/metrics', () => {
  it('averagePrecision is 1 for a perfect ranking', () => {
    const items: ScoredInstance[] = [
      { score: 0.9, label: 1 },
      { score: 0.8, label: 1 },
      { score: 0.3, label: 0 },
      { score: 0.1, label: 0 },
    ];
    assert.equal(averagePrecision(items), 1);
  });

  it('averagePrecision matches the hand-computed value for a mixed ranking', () => {
    // Ranking by score: P(1), N, P(1), N. Precision at the two positives:
    // rank1 -> 1/1, rank3 -> 2/3. AP = (1 + 2/3)/2 = 5/6.
    const items: ScoredInstance[] = [
      { score: 0.9, label: 1 },
      { score: 0.8, label: 0 },
      { score: 0.7, label: 1 },
      { score: 0.6, label: 0 },
    ];
    assert.ok(Math.abs(averagePrecision(items) - 5 / 6) < 1e-12);
  });

  it('averagePrecision is 0 with no positives', () => {
    assert.equal(averagePrecision([{ score: 0.5, label: 0 }]), 0);
  });

  it('recallAtBudget counts positives in the top fraction', () => {
    const items: ScoredInstance[] = [
      { score: 0.95, label: 1 },
      { score: 0.9, label: 1 },
      { score: 0.5, label: 0 },
      { score: 0.4, label: 1 },
      { score: 0.1, label: 0 },
    ];
    // Top 40% = top 2 (rounded): both positive, 2 of 3 total positives.
    assert.ok(Math.abs(recallAtBudget(items, 0.4) - 2 / 3) < 1e-12);
  });

  it('precisionAtBudget and baseRate are consistent', () => {
    const items: ScoredInstance[] = [
      { score: 0.9, label: 1 },
      { score: 0.8, label: 1 },
      { score: 0.2, label: 0 },
      { score: 0.1, label: 0 },
    ];
    assert.equal(precisionAtBudget(items, 0.5), 1); // top 2 both positive
    assert.equal(baseRate(items), 0.5);
  });

  it('breaks score ties deterministically by original index', () => {
    const items: ScoredInstance[] = [
      { score: 0.5, label: 0 },
      { score: 0.5, label: 1 },
    ];
    // Tie -> index 0 first, so top-1 catches 0 of 1 positive.
    assert.equal(recallAtBudget(items, 0.5), 0);
  });
});
