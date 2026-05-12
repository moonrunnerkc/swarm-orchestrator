import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FalsifierScheduler,
  DEFAULT_EXPLORATION_CONSTANT,
} from '../../src/falsification/scheduler';
import type { FalsifierAdapter } from '../../src/falsification/adapters/types';

function fakeAdapter(name: string): FalsifierAdapter {
  return {
    name,
    handles: ['property-must-hold'],
    falsify: async () => ({
      result: { kind: 'no-falsification-found', reason: 'unsupported', attempts: 0 },
      cost: { wallClockMs: 0, dollarsBilled: 0, dollarsApiEquivalent: 0, counterExamplesFound: 0 },
    }),
  } as unknown as FalsifierAdapter;
}

describe('FalsifierScheduler', () => {
  it('sequential mode preserves registration order', () => {
    const sched = new FalsifierScheduler({ kind: 'sequential', statsPath: null });
    const adapters = ['a', 'b', 'c'].map(fakeAdapter);
    const decision = sched.order(adapters);
    assert.equal(decision.kind, 'sequential');
    assert.deepEqual(decision.order, ['a', 'b', 'c']);
    assert.deepEqual(decision.scores, []);
  });

  it('ucb1 with no history scores untried adapters at +Infinity', () => {
    const sched = new FalsifierScheduler({ kind: 'ucb1', statsPath: null });
    const adapters = ['x', 'y', 'z'].map(fakeAdapter);
    const decision = sched.order(adapters);
    assert.equal(decision.kind, 'ucb1');
    // All scores Infinity → ties broken by registration order.
    assert.deepEqual(decision.order, ['x', 'y', 'z']);
    assert.equal(decision.scores.length, 3);
    for (const s of decision.scores) assert.equal(s.score, Number.POSITIVE_INFINITY);
  });

  it('ucb1 deprioritises adapters with worse cost-adjusted reward', () => {
    const sched = new FalsifierScheduler({
      kind: 'ucb1',
      statsPath: null,
      explorationConstant: DEFAULT_EXPLORATION_CONSTANT,
    });
    const adapters = ['cheap-good', 'expensive-bad'].map(fakeAdapter);
    // Seed several trials: cheap-good wins often & cheaply; expensive-bad rarely & dearly.
    for (let i = 0; i < 10; i += 1) {
      sched.recordOutcome('cheap-good', { successful: true, costUsd: 0.01, latencyMs: 100 });
    }
    for (let i = 0; i < 10; i += 1) {
      sched.recordOutcome('expensive-bad', { successful: false, costUsd: 1.0, latencyMs: 5000 });
    }
    const decision = sched.order(adapters);
    assert.deepEqual(decision.order, ['cheap-good', 'expensive-bad']);
    assert.ok(decision.scores[0]!.score > decision.scores[1]!.score);
  });

  it('order is deterministic given the same stats and adapter list', () => {
    const seedStats = {
      a: { trials: 5, successes: 2, falsePositives: 0, totalCostUsd: 1, totalLatencyMs: 500 },
      b: { trials: 5, successes: 4, falsePositives: 0, totalCostUsd: 1, totalLatencyMs: 500 },
      c: { trials: 5, successes: 1, falsePositives: 1, totalCostUsd: 1, totalLatencyMs: 500 },
    };
    const adapters = ['a', 'b', 'c'].map(fakeAdapter);
    const s1 = new FalsifierScheduler({ kind: 'ucb1', statsPath: null, initialStats: seedStats });
    const s2 = new FalsifierScheduler({ kind: 'ucb1', statsPath: null, initialStats: seedStats });
    assert.deepEqual(s1.order(adapters).order, s2.order(adapters).order);
  });

  it('persists and reloads stats across instances', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-'));
    const statsPath = path.join(dir, 'stats.json');
    const a = new FalsifierScheduler({ kind: 'ucb1', statsPath });
    a.recordOutcome('foo', { successful: true, costUsd: 0.05, latencyMs: 200 });
    a.recordOutcome('foo', { successful: false, costUsd: 0.05, latencyMs: 200 });
    a.flush();
    assert.ok(fs.existsSync(statsPath));
    const b = new FalsifierScheduler({ kind: 'ucb1', statsPath });
    const snap = b.snapshot();
    assert.equal(snap.foo?.trials, 2);
    assert.equal(snap.foo?.successes, 1);
  });

  it('flush is a no-op when constructed without statsPath', () => {
    const sched = new FalsifierScheduler({ kind: 'ucb1', statsPath: null });
    sched.recordOutcome('a', { successful: true, costUsd: 0.01, latencyMs: 50 });
    // Should not throw.
    sched.flush();
  });

  it('falsePositive flag bumps falsePositive counter', () => {
    const sched = new FalsifierScheduler({ kind: 'ucb1', statsPath: null });
    sched.recordOutcome('x', { successful: true, costUsd: 0, latencyMs: 0, falsePositive: true });
    assert.equal(sched.snapshot().x?.falsePositives, 1);
  });

  it('single-adapter input bypasses scoring and returns sequential', () => {
    const sched = new FalsifierScheduler({ kind: 'ucb1', statsPath: null });
    const decision = sched.order([fakeAdapter('only')]);
    assert.deepEqual(decision.order, ['only']);
    assert.deepEqual(decision.scores, []);
  });
});
