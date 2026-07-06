import { strict as assert } from 'assert';
import {
  composeMergeDecision,
  summarizeMergeDecision,
  type MergeControl,
  type MergeDecisionInput,
} from '../../../src/audit/gate/merge-decision';

function control(over: Partial<MergeControl> = {}): MergeControl {
  return { id: 'test-must-pass', kind: 'test', status: 'pass', detail: '', ...over };
}

// A fully-green, viable, cheat-clean PR: the only path to AUTO-MERGE.
function greenInput(over: Partial<MergeDecisionInput> = {}): MergeDecisionInput {
  return {
    egViable: true,
    egViabilityReason: '',
    negativeGateClean: true,
    negativeGateDetail: '',
    controls: [
      control({ id: 'build-must-pass', kind: 'build' }),
      control({ id: 'test-must-pass', kind: 'test' }),
    ],
    ...over,
  };
}

describe('audit/gate/merge-decision composeMergeDecision', () => {
  it('auto-merges when the cheat gate is clean, the PR is viable, and every control passes', () => {
    const decision = composeMergeDecision(greenInput());
    assert.equal(decision.verdict, 'auto-merge');
    assert.equal(decision.reasons.length, 0);
  });

  it('routes a cheat-clean PR to HUMAN when post-merge test-must-pass fails', () => {
    // The headline acceptance: passing the negative gate is not sufficient.
    const decision = composeMergeDecision(
      greenInput({
        controls: [
          control({ id: 'build-must-pass', kind: 'build', status: 'pass' }),
          control({ id: 'test-must-pass', kind: 'test', status: 'fail', detail: '3 tests failed' }),
        ],
      }),
    );
    assert.equal(decision.verdict, 'human');
    assert.deepEqual(
      decision.reasons.map((r) => r.code),
      ['positive-control-failed'],
    );
    assert.match(decision.reasons[0]?.detail ?? '', /test-must-pass: 3 tests failed/);
  });

  it('routes to HUMAN with not-execution-groundable when the PR is not viable', () => {
    const decision = composeMergeDecision({
      egViable: false,
      egViabilityReason: 'not a Node project (no package.json)',
      negativeGateClean: true,
      negativeGateDetail: '',
      controls: [],
    });
    assert.equal(decision.verdict, 'human');
    assert.deepEqual(
      decision.reasons.map((r) => r.code),
      ['not-execution-groundable'],
    );
    assert.match(decision.reasons[0]?.detail ?? '', /no package\.json/);
  });

  it('routes to HUMAN when the negative gate blocked, even with a green positive gate', () => {
    const decision = composeMergeDecision(
      greenInput({ negativeGateClean: false, negativeGateDetail: 'test-tamper-proven fired' }),
    );
    assert.equal(decision.verdict, 'human');
    assert.deepEqual(
      decision.reasons.map((r) => r.code),
      ['negative-gate-blocked'],
    );
  });

  it('treats an unavailable control as not proven (null control) and routes to HUMAN', () => {
    const decision = composeMergeDecision(
      greenInput({
        controls: [
          control({ id: 'test-must-pass', kind: 'test', status: 'pass' }),
          control({ id: 'falsifier', kind: 'falsifier', status: 'unavailable', detail: 'codex CLI not on PATH' }),
        ],
      }),
    );
    assert.equal(decision.verdict, 'human');
    assert.deepEqual(
      decision.reasons.map((r) => r.code),
      ['positive-control-unavailable'],
    );
    assert.match(decision.reasons[0]?.detail ?? '', /not proven/);
  });

  it('refuses to auto-merge a viable PR that produced no controls', () => {
    const decision = composeMergeDecision(greenInput({ controls: [] }));
    assert.equal(decision.verdict, 'human');
    assert.deepEqual(
      decision.reasons.map((r) => r.code),
      ['no-controls-ran'],
    );
  });

  it('reports every blocking reason at once, not just the first', () => {
    const decision = composeMergeDecision({
      egViable: true,
      egViabilityReason: '',
      negativeGateClean: false,
      negativeGateDetail: 'mock-mutation-proven',
      controls: [
        control({ id: 'test-must-pass', kind: 'test', status: 'fail', detail: 'failed' }),
        control({ id: 'falsifier', kind: 'falsifier', status: 'unavailable', detail: 'no adapter' }),
      ],
    });
    assert.equal(decision.verdict, 'human');
    assert.deepEqual(decision.reasons.map((r) => r.code), [
      'negative-gate-blocked',
      'positive-control-failed',
      'positive-control-unavailable',
    ]);
  });
});

describe('audit/gate/merge-decision summarizeMergeDecision', () => {
  it('renders AUTO-MERGE for a clean decision', () => {
    assert.equal(summarizeMergeDecision(composeMergeDecision(greenInput())), 'AUTO-MERGE');
  });

  it('renders HUMAN with the joined reason codes', () => {
    const decision = composeMergeDecision(greenInput({ egViable: false, egViabilityReason: 'x' }));
    assert.equal(summarizeMergeDecision(decision), 'HUMAN: not-execution-groundable');
  });
});
