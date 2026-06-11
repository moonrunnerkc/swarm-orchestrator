import { strict as assert } from 'assert';
import {
  calibrateTriggers,
  type TriggerCalibration,
  type TriggerFiringRecord,
} from '../../../src/audit/gate/calibrate-triggers';
import { ALL_BLOCK_TRIGGER_KINDS } from '../../../src/audit/gate/block-trigger-types';
import { wilsonLowerBound } from '../../../src/audit/gate/wilson';

function byTrigger(rows: TriggerCalibration[], trigger: string): TriggerCalibration {
  const row = rows.find((r) => r.trigger === trigger);
  assert.ok(row !== undefined, `expected a row for ${trigger}`);
  return row;
}

describe('calibrateTriggers', () => {
  const corpus: TriggerFiringRecord[] = [
    { pr: 'acme/w#1', fired: ['obligation-failure'], revertedOrHotfixed: true },
    { pr: 'acme/w#2', fired: ['obligation-failure'], revertedOrHotfixed: true },
    { pr: 'acme/w#3', fired: ['obligation-failure'], revertedOrHotfixed: false },
    { pr: 'acme/w#4', fired: ['claim-falsified'], revertedOrHotfixed: true },
    { pr: 'acme/w#5', fired: [], revertedOrHotfixed: true },
  ];

  it('computes precision against revert outcomes, not labels', () => {
    const rows = calibrateTriggers(corpus);
    const obligation = byTrigger(rows, 'obligation-failure');
    assert.equal(obligation.firingCount, 3);
    assert.equal(obligation.truePositive, 2);
    assert.equal(obligation.falsePositive, 1);
    assert.ok(Math.abs(obligation.precision - 2 / 3) < 1e-9);
    assert.ok(Math.abs(obligation.wilsonLowerBound - wilsonLowerBound(2, 3)) < 1e-9);
    assert.deepEqual(obligation.truePositivePrs, ['acme/w#1', 'acme/w#2']);
  });

  it('reports a perfect-but-rare trigger with a low Wilson bound', () => {
    const rows = calibrateTriggers(corpus);
    const claim = byTrigger(rows, 'claim-falsified');
    assert.equal(claim.firingCount, 1);
    assert.equal(claim.truePositive, 1);
    assert.equal(claim.precision, 1);
    assert.ok(
      claim.wilsonLowerBound < 0.5,
      'one firing cannot clear the bar even at precision 1.0',
    );
  });

  it('reports a trigger that never fired as zero, not undefined', () => {
    const rows = calibrateTriggers(corpus);
    const corroborated = byTrigger(rows, 'corroborated-under-constraint');
    assert.equal(corroborated.firingCount, 0);
    assert.equal(corroborated.precision, 0);
    assert.equal(corroborated.wilsonLowerBound, 0);
    assert.deepEqual(corroborated.truePositivePrs, []);
  });

  it('returns a row for every trigger kind', () => {
    assert.deepEqual(
      calibrateTriggers([]).map((r) => r.trigger),
      [...ALL_BLOCK_TRIGGER_KINDS],
    );
  });
});
