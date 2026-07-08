import { strict as assert } from 'assert';
import { ALL_BLOCK_TRIGGER_KINDS } from '../../../src/audit/gate/block-trigger-types';
import { SELF_CERTIFYING_TRIGGERS } from '../../../src/audit/gate/self-certifying';

// Soundness pin. The claim-differential verdict `claim-falsified-synthesized` is
// advisory-pending-measurement: it may never gate or self-certify until it clears
// the promotions bar on measured data. This guards the exact invariant against a
// future edit that adds it to a gating set. It is distinct from `claim-falsified`,
// the issue-linked-repro trigger, which is a legitimate self-certifying block
// trigger.
describe('claim-falsified-synthesized is not gate-eligible (soundness pin)', () => {
  const SYNTHESIZED = 'claim-falsified-synthesized';

  it('is not a block-trigger kind', () => {
    assert.ok(
      !(ALL_BLOCK_TRIGGER_KINDS as readonly string[]).includes(SYNTHESIZED),
      'the synthesized claim-differential verdict must not be a block-trigger kind',
    );
  });

  it('is not a self-certifying trigger', () => {
    assert.ok(
      !(SELF_CERTIFYING_TRIGGERS as readonly string[]).includes(SYNTHESIZED),
      'the synthesized claim-differential verdict must never self-certify a block',
    );
  });

  it('is not the same trigger as the issue-repro claim-falsified (which does gate)', () => {
    assert.ok((ALL_BLOCK_TRIGGER_KINDS as readonly string[]).includes('claim-falsified'), 'the issue-repro trigger stays a real kind');
    assert.notEqual(SYNTHESIZED, 'claim-falsified');
  });
});
