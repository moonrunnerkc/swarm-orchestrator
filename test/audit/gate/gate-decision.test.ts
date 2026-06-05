import { strict as assert } from 'assert';
import {
  BLOCK_ELIGIBLE_TRIGGERS,
  decideBlock,
  isBlockEligible,
} from '../../../src/audit/gate/gate-decision';
import type { BlockTrigger } from '../../../src/audit/gate/block-triggers';

const obligationTrigger: BlockTrigger = {
  kind: 'obligation-failure',
  summary: 'test-must-pass failed',
  reproduce: 'npm test',
  evidence: { kind: 'obligation-failure', obligationType: 'test-must-pass', command: 'npm test', output: 'boom' },
};

describe('gate-decision', () => {
  it('ships with an empty eligible set (no trigger has cleared the bar yet)', () => {
    assert.deepEqual(BLOCK_ELIGIBLE_TRIGGERS, []);
    assert.equal(isBlockEligible('obligation-failure'), false);
  });

  it('never blocks in advise mode, even when an eligible trigger fired', () => {
    const decision = decideBlock([obligationTrigger], 'advise', true, ['obligation-failure']);
    assert.equal(decision.blocked, false);
    assert.equal(decision.blockingTriggers.length, 1, 'still surfaced for the comment');
  });

  it('blocks in gate mode when an eligible trigger fired', () => {
    const decision = decideBlock([obligationTrigger], 'gate', true, ['obligation-failure']);
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockingTriggers[0]!.kind, 'obligation-failure');
  });

  it('does not block in gate mode when the fired trigger is not eligible', () => {
    const decision = decideBlock([obligationTrigger], 'gate', true, []);
    assert.equal(decision.blocked, false);
    assert.equal(decision.blockingTriggers.length, 0);
  });

  it('preserves the existing block on a failed structural result', () => {
    const decision = decideBlock([], 'gate', false, []);
    assert.equal(decision.blocked, true, 'a detector that earned a block still blocks');
  });

  it('passes a clean gate run with only advisory triggers', () => {
    const decision = decideBlock([obligationTrigger], 'gate', true, []);
    assert.equal(decision.blocked, false);
  });
});
