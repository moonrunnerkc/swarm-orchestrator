import { strict as assert } from 'assert';
import { CostLedger } from '../../../scripts/real-prs/lib/cost';
import { SwarmError } from '../../../src/errors';

describe('scripts/real-prs/lib/cost', () => {
  it('accumulates spend from token usage', () => {
    const ledger = new CostLedger(25);
    ledger.record('claude-opus-4-8', 1_000_000, 1_000_000);
    // opus est: $15 in + $75 out = $90 for 1M+1M
    assert.ok(Math.abs(ledger.spentUsd() - 90) < 0.001);
  });

  it('treats local models as free', () => {
    const ledger = new CostLedger(25);
    ledger.record('local:glm', 1_000_000, 1_000_000);
    assert.equal(ledger.spentUsd(), 0);
  });

  it('guards before a call once the ceiling is reached', () => {
    const ledger = new CostLedger(1);
    ledger.record('claude-opus-4-8', 1_000_000, 0); // $15, over the $1 ceiling
    assert.throws(() => ledger.guardBeforeCall(), (err: unknown) => {
      assert.ok(err instanceof SwarmError);
      assert.equal((err as SwarmError).code, 'REAL_PRS_COST_CEILING');
      return true;
    });
  });

  it('does not guard while under the ceiling', () => {
    const ledger = new CostLedger(100);
    ledger.record('claude-haiku-4-5', 1_000, 1_000);
    assert.doesNotThrow(() => ledger.guardBeforeCall());
  });
});
