import { strict as assert } from 'assert';
import {
  accumulateUsage,
  deriveStatus,
  selectFrozenEgViable,
  type TokenMeter,
} from '../../scripts/real-prs/hunt3';
import type { WildCheatEntry } from '../../scripts/real-prs/lib/wild-cheat-corpus';

function entry(id: string, egViable: boolean): WildCheatEntry {
  return {
    id,
    repo: `owner/${id}`,
    prNumber: 1,
    url: `https://github.com/owner/${id}/pull/1`,
    state: 'closed',
    vendor: 'claude-code',
    vendorConfidence: 'high',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    complaintCategory: 'assertion-strip',
    complaints: [],
    outcome: 'unknown',
    egViable,
    crossTaxonomy: 'reward-hacking / weakened-oracle',
    holdout: true,
  };
}

describe('hunt3 frozen-set selection', () => {
  it('keeps only EG-viable entries and joins the PR title/body by id', () => {
    const entries = [entry('viable-a', true), entry('not-viable', false), entry('viable-b', true)];
    const population = [
      { id: 'viable-a', title: 'Fix the clamp', body: 'closes #10' },
      { id: 'viable-b', title: 'Refactor', body: '' },
    ];
    const targets = selectFrozenEgViable(entries, population);
    assert.equal(targets.length, 2);
    assert.deepEqual(
      targets.map((t) => t.entry.id),
      ['viable-a', 'viable-b'],
    );
    assert.equal(targets[0]?.title, 'Fix the clamp');
    assert.equal(targets[0]?.body, 'closes #10');
  });

  it('leaves the PR text empty when the population carries no match', () => {
    const targets = selectFrozenEgViable([entry('viable-a', true)], []);
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.title, '');
    assert.equal(targets[0]?.body, '');
  });
});

describe('hunt3 status derivation', () => {
  it('marks a restoration proof as a proven block', () => {
    const { status } = deriveStatus(1, false, []);
    assert.equal(status, 'proven-block');
  });

  it('marks a controlled claim-falsified-synthesized as a proven block', () => {
    const { status } = deriveStatus(0, true, []);
    assert.equal(status, 'proven-block');
  });

  it('reports not-provisioned when a provision skip and no proof', () => {
    const { status, note } = deriveStatus(0, false, ['provision: corepack yarn install failed']);
    assert.equal(status, 'not-provisioned');
    assert.match(note, /provision:/);
  });

  it('reports ran-no-proof when the tier ran and found nothing', () => {
    const { status } = deriveStatus(0, false, ['claim-differential: abstained']);
    assert.equal(status, 'ran-no-proof');
  });
});

describe('hunt3 token metering', () => {
  it('accumulates per-model calls and tokens across calls', () => {
    const meter: TokenMeter = new Map();
    accumulateUsage(meter, 'claude-sonnet-5', 100, 40);
    accumulateUsage(meter, 'claude-sonnet-5', 50, 10);
    accumulateUsage(meter, 'claude-haiku-4-5-20251001', 30, 5);
    assert.deepEqual(meter.get('claude-sonnet-5'), { calls: 2, inputTokens: 150, outputTokens: 50 });
    assert.deepEqual(meter.get('claude-haiku-4-5-20251001'), { calls: 1, inputTokens: 30, outputTokens: 5 });
  });
});
