import { strict as assert } from 'assert';
import {
  AdapterRegistry,
  type FalsificationInput,
  type FalsifierAdapter,
  type FalsifyOutcome,
} from '../../src/falsification/adapters';
import { dispatchFalsifiers } from '../../src/falsification/dispatcher';
import type { ObligationV1 } from '../../src/contract/types';

/**
 * Tests for the sequential falsification dispatcher. The dispatcher's
 * job is small but load-bearing: honor `--falsifiers off`, walk the
 * registry in order, propagate adapter results without mutation.
 */

function counterExampleAdapter(name: string): FalsifierAdapter {
  return {
    name,
    handles: ['property-must-hold'] as const,
    async falsify(input: FalsificationInput): Promise<FalsifyOutcome> {
      return {
        result: {
          kind: 'counter-example-input',
          obligationType: input.obligation.type,
          inputs: [
            {
              files: [{ relPath: `${name}.txt`, bytes: 'x' }],
              reproducer: 'true',
              reproducerOutput: '',
              reproducerExitCode: 1,
            },
          ],
        },
        cost: {
          adapterName: name,
          obligationType: input.obligation.type,
          wallClockMs: 1,
          dollarsSpent: 0.001,
          dollarsBilled: 0.001,
          dollarsTokenEstimate: 0.001,
          dollarsApiEquivalent: 0.001,
          authMethod: 'api',
          counterExamplesFound: 1,
          falsePositives: 0,
        },
      };
    },
  };
}

const obligation: ObligationV1 = {
  type: 'property-must-hold',
  predicate: 'true',
  target: 'unit',
};

describe('dispatchFalsifiers', () => {
  it('returns disabled outcome when --falsifiers off', async () => {
    const registry = new AdapterRegistry();
    registry.register(counterExampleAdapter('a'));
    const outcome = await dispatchFalsifiers(obligation, registry, {
      falsifiers: 'off',
      timeBudgetMs: 1000,
      workspaceRoot: '/tmp/unused',
      contextRefs: [],
      patchSha: 'deadbeef',
    });
    assert.equal(outcome.disabled, true);
    assert.equal(outcome.calls.length, 0);
  });

  it('runs every matching adapter in registration order', async () => {
    const registry = new AdapterRegistry();
    registry.register(counterExampleAdapter('first'));
    registry.register(counterExampleAdapter('second'));
    const outcome = await dispatchFalsifiers(obligation, registry, {
      falsifiers: 'on',
      timeBudgetMs: 1000,
      workspaceRoot: '/tmp/unused',
      contextRefs: [],
      patchSha: 'deadbeef',
    });
    assert.equal(outcome.disabled, false);
    assert.equal(outcome.calls.length, 2);
    assert.equal(outcome.calls[0]?.adapterName, 'first');
    assert.equal(outcome.calls[1]?.adapterName, 'second');
  });

  it('skips adapters that do not handle the obligation type', async () => {
    const onlyTestObligation: FalsifierAdapter = {
      name: 'only-test',
      handles: ['test-must-pass'] as const,
      async falsify(): Promise<FalsifyOutcome> {
        throw new Error('should not be invoked for property-must-hold');
      },
    };
    const registry = new AdapterRegistry();
    registry.register(onlyTestObligation);
    registry.register(counterExampleAdapter('matches'));
    const outcome = await dispatchFalsifiers(obligation, registry, {
      falsifiers: 'on',
      timeBudgetMs: 1000,
      workspaceRoot: '/tmp/unused',
      contextRefs: [],
      patchSha: 'deadbeef',
    });
    assert.equal(outcome.calls.length, 1);
    assert.equal(outcome.calls[0]?.adapterName, 'matches');
  });

  it('with scheduler: orders adapters via scheduler and records the decision', async () => {
    const { FalsifierScheduler } = require('../../src/falsification/scheduler') as typeof import('../../src/falsification/scheduler');
    const registry = new AdapterRegistry();
    registry.register(counterExampleAdapter('a'));
    registry.register(counterExampleAdapter('b'));
    const sched = new FalsifierScheduler({ kind: 'ucb1', statsPath: null });
    // Seed scheduler so 'b' has a clearly higher reward than 'a'.
    for (let i = 0; i < 5; i += 1) sched.recordOutcome('a', { successful: false, costUsd: 1, latencyMs: 100 });
    for (let i = 0; i < 5; i += 1) sched.recordOutcome('b', { successful: true, costUsd: 0.01, latencyMs: 100 });
    const outcome = await dispatchFalsifiers(obligation, registry, {
      falsifiers: 'on',
      timeBudgetMs: 1000,
      workspaceRoot: '/tmp/unused',
      contextRefs: [],
      patchSha: 'deadbeef',
      scheduler: sched,
    });
    assert.equal(outcome.calls.length, 2);
    assert.equal(outcome.calls[0]?.adapterName, 'b');
    assert.equal(outcome.calls[1]?.adapterName, 'a');
    assert.ok(outcome.dispatchDecision);
    assert.equal(outcome.dispatchDecision?.kind, 'ucb1');
    assert.deepEqual(outcome.dispatchDecision?.order, ['b', 'a']);
  });

  it('with shouldCancel: bails after current adapter when signal flips', async () => {
    const registry = new AdapterRegistry();
    registry.register(counterExampleAdapter('a'));
    registry.register(counterExampleAdapter('b'));
    let calls = 0;
    const outcome = await dispatchFalsifiers(obligation, registry, {
      falsifiers: 'on',
      timeBudgetMs: 1000,
      workspaceRoot: '/tmp/unused',
      contextRefs: [],
      patchSha: 'deadbeef',
      shouldCancel: () => {
        calls += 1;
        // Allow first adapter, cancel before second.
        return calls > 1 ? 'cost-cap exceeded' : null;
      },
    });
    assert.equal(outcome.calls.length, 1);
    assert.equal(outcome.cancelled, 'cost-cap exceeded');
  });
});
