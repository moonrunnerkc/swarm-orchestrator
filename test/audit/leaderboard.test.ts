import { strict as assert } from 'assert';
import { scoreCorpus } from '../../benchmarks/leaderboard/score';

// Sanity gate over the entire v10 corpus. The leaderboard harness must
// return zero failed expectations — every broken case caught, every
// clean control clean. This guards detector regressions across the
// 500-case corpus in one assertion.

describe('leaderboard / corpus scoring', function () {
  this.timeout(20_000);
  it('reports zero failed expectations across the full v10 corpus', () => {
    const out = scoreCorpus();
    assert.equal(out.failedExpectations.length, 0, JSON.stringify(out.failedExpectations.slice(0, 5)));
    assert.ok(out.corpusSize >= 500);
    assert.ok(out.perAgent.length >= 1);
    assert.ok(out.perCategory.length === 10);
  });
});
