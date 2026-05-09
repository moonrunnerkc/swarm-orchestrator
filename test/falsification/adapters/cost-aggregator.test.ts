import { strict as assert } from 'assert';
import {
  aggregateAdapterCosts,
  totalAdapterDollars,
} from '../../../src/falsification/adapters/cost-aggregator';
import type { AdapterCostRecord } from '../../../src/falsification/adapters/types';

function record(overrides: Partial<AdapterCostRecord>): AdapterCostRecord {
  return {
    adapterName: 'codex',
    obligationType: 'property-must-hold',
    wallClockMs: 100,
    dollarsSpent: 0.5,
    dollarsBilled: 0.5,
    dollarsTokenEstimate: 0.5,
    authMethod: 'api',
    counterExamplesFound: 1,
    falsePositives: 2,
    ...overrides,
  };
}

describe('aggregateAdapterCosts', () => {
  it('groups by (adapterName, obligationType) and sums numeric fields', () => {
    const aggregates = aggregateAdapterCosts([
      record({}),
      record({ wallClockMs: 200, dollarsSpent: 1, counterExamplesFound: 2 }),
      record({ adapterName: 'codex', obligationType: 'test-must-pass', wallClockMs: 50 }),
    ]);
    assert.equal(aggregates.length, 2);
    const propertyRecord = aggregates.find((a) => a.obligationType === 'property-must-hold');
    assert.ok(propertyRecord);
    assert.equal(propertyRecord!.calls, 2);
    assert.equal(propertyRecord!.wallClockMs, 300);
    assert.equal(propertyRecord!.dollarsSpent, 1.5);
    assert.equal(propertyRecord!.counterExamplesFound, 3);
  });

  it('produces deterministic ordering across runs', () => {
    const a = aggregateAdapterCosts([
      record({ adapterName: 'zzz' }),
      record({ adapterName: 'aaa' }),
    ]);
    const b = aggregateAdapterCosts([
      record({ adapterName: 'aaa' }),
      record({ adapterName: 'zzz' }),
    ]);
    assert.deepEqual(a, b);
    assert.equal(a[0]?.adapterName, 'aaa');
    assert.equal(a[1]?.adapterName, 'zzz');
  });

  it('returns an empty array on empty input', () => {
    assert.deepEqual(aggregateAdapterCosts([]), []);
  });
});

describe('totalAdapterDollars', () => {
  it('sums dollars across aggregates', () => {
    const aggregates = aggregateAdapterCosts([
      record({ dollarsSpent: 0.25 }),
      record({ dollarsSpent: 0.75, adapterName: 'other' }),
    ]);
    assert.equal(totalAdapterDollars(aggregates), 1);
  });
});
