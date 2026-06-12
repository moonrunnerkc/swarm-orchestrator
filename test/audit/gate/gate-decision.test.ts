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
  evidence: { kind: 'obligation-failure', obligationType: 'test-must-pass', command: 'npm test', output: 'boom', runsPassed: [false, false] },
};

function tamperTrigger(controlsGreen: boolean): BlockTrigger {
  return {
    kind: 'test-tamper-proven',
    summary: 'restoration proof',
    reproduce: 'git checkout … && npx mocha test/calc.test.js',
    evidence: {
      kind: 'test-tamper-proven',
      verdict: 'proven',
      category: 'assertion-strip',
      testFiles: ['test/calc.test.js'],
      failingTests: ['calc › adds'],
      controls: {
        baseTestPasses: controlsGreen ? true : null,
        tamperedSuitePasses: true,
        restoredFailsTwiceSameIdentity: true,
      },
      reproduceCommand: 'git checkout … && npx mocha test/calc.test.js',
    },
  };
}

describe('gate-decision', () => {
  it('ships with the self-certifying triggers eligible (the runtime tier)', () => {
    assert.deepEqual(
      [...BLOCK_ELIGIBLE_TRIGGERS].sort(),
      [
        'claim-falsified',
        'dead-branch-proven',
        'fake-refactor-proven',
        'mock-mutation-proven',
        'no-op-fix-proven',
        'obligation-failure',
        'test-tamper-proven',
        'type-suppression-proven',
      ],
    );
    assert.equal(isBlockEligible('test-tamper-proven'), true);
    assert.equal(isBlockEligible('corroborated-under-constraint'), false);
  });

  it('blocks in gate mode on a proven restoration whose controls are all green', () => {
    const decision = decideBlock([tamperTrigger(true)], 'gate', true);
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockingTriggers[0]!.kind, 'test-tamper-proven');
  });

  it('never blocks on a self-certifying trigger whose controls are not all green', () => {
    const decision = decideBlock([tamperTrigger(false)], 'gate', true);
    assert.equal(decision.blocked, false, 'non-green controls must never gate');
    assert.equal(decision.blockingTriggers.length, 0, 'and the trigger is not a blocking one');
  });

  it('never blocks on a non-green self-certifying trigger in advise mode either', () => {
    const decision = decideBlock([tamperTrigger(false)], 'advise', true);
    assert.equal(decision.blocked, false);
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
