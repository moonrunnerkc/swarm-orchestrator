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
    dollarsApiEquivalent: 0.5,
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

describe('dollarsBilled vs dollarsApiEquivalent (audit-and-corrections, 2026-05-09)', () => {
  // The aggregator must preserve a non-zero `dollarsApiEquivalent` even
  // when `dollarsBilled` is zero (subscription-imputed adapters such as
  // Copilot under chatgpt auth). Phase 3's cost ratio was previously
  // computed against a heterogeneous basis: Codex's API-billed dollars
  // versus Copilot's subscription-imputed dollars rendered as
  // `dollarsTokenEstimate`. The audit-and-corrections fix introduces
  // `dollarsApiEquivalent` as the like-for-like comparison surface; this
  // test pins the aggregator to that semantics.
  it('keeps billed and api-equivalent columns independent across calls', () => {
    // Two Copilot calls (subscription, billed=0, api-equivalent>0) and
    // one Codex call (api-billed, billed>0, api-equivalent>0 and equal).
    const aggregates = aggregateAdapterCosts([
      record({
        adapterName: 'copilot',
        obligationType: 'import-graph-must-satisfy',
        authMethod: 'chatgpt',
        dollarsSpent: 0.026,
        dollarsBilled: 0,
        dollarsTokenEstimate: 0.026,
        dollarsApiEquivalent: 0.05,
      }),
      record({
        adapterName: 'copilot',
        obligationType: 'import-graph-must-satisfy',
        authMethod: 'chatgpt',
        dollarsSpent: 0.026,
        dollarsBilled: 0,
        dollarsTokenEstimate: 0.026,
        dollarsApiEquivalent: 0.05,
      }),
      record({
        adapterName: 'codex',
        obligationType: 'property-must-hold',
        authMethod: 'api',
        dollarsSpent: 0.15,
        dollarsBilled: 0.15,
        dollarsTokenEstimate: 0.15,
        dollarsApiEquivalent: 0.15,
      }),
    ]);
    const copilot = aggregates.find((a) => a.adapterName === 'copilot');
    const codex = aggregates.find((a) => a.adapterName === 'codex');
    assert.ok(copilot);
    assert.ok(codex);
    assert.equal(copilot!.calls, 2);
    // Subscription stays $0 even after summing.
    assert.equal(copilot!.dollarsBilled, 0);
    // Subscription-imputed token-estimate sums to 2 × $0.026.
    assert.ok(Math.abs(copilot!.dollarsTokenEstimate - 0.052) < 1e-9);
    // API-equivalent (the like-for-like surface) sums to 2 × $0.05.
    assert.ok(Math.abs(copilot!.dollarsApiEquivalent - 0.1) < 1e-9);
    // Codex remains identical across all three columns under api auth.
    assert.equal(codex!.dollarsBilled, 0.15);
    assert.equal(codex!.dollarsApiEquivalent, 0.15);
    assert.equal(codex!.dollarsBilled, codex!.dollarsApiEquivalent);
  });

  it('reproduces the headline Phase-3-style billed-vs-api-equivalent split', () => {
    // 20 Copilot calls × 1 Premium request each (the Phase 3 shape):
    //   billed  = 0          (subscription)
    //   tokenEstimate = 20 × $0.026 = $0.52      (Pro+ implied per-request)
    //   apiEquivalent = 20 × $0.05  = $1.00      (GPT-4-Turbo per-request)
    const calls: AdapterCostRecord[] = [];
    for (let i = 0; i < 20; i++) {
      calls.push(
        record({
          adapterName: 'copilot',
          obligationType: 'import-graph-must-satisfy',
          authMethod: 'chatgpt',
          dollarsSpent: 0.026,
          dollarsBilled: 0,
          dollarsTokenEstimate: 0.026,
          dollarsApiEquivalent: 0.05,
        }),
      );
    }
    const [agg] = aggregateAdapterCosts(calls);
    assert.ok(agg);
    assert.equal(agg!.calls, 20);
    assert.equal(agg!.dollarsBilled, 0);
    assert.ok(Math.abs(agg!.dollarsTokenEstimate - 0.52) < 1e-9);
    assert.ok(Math.abs(agg!.dollarsApiEquivalent - 1.0) < 1e-9);
  });
});
