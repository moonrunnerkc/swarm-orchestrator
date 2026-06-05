import { strict as assert } from 'assert';
import { computeBlockEligibility } from '../../../src/audit/gate/block-eligibility';
import type { TriggerCalibration } from '../../../src/audit/gate/calibrate-triggers';
import { wilsonLowerBound } from '../../../src/audit/gate/wilson';

const opts = {
  computedBy: 'test',
  calibrationFile: 'fixture.json',
  calibrationGeneratedAt: '2026-01-01T00:00:00.000Z',
};

function calibration(
  trigger: TriggerCalibration['trigger'],
  truePositive: number,
  falsePositive: number,
): TriggerCalibration {
  const firingCount = truePositive + falsePositive;
  return {
    trigger,
    firingCount,
    truePositive,
    falsePositive,
    precision: firingCount === 0 ? 0 : truePositive / firingCount,
    wilsonLowerBound: wilsonLowerBound(truePositive, firingCount),
    truePositivePrs: Array.from({ length: truePositive }, (_unused, i) => `acme/w#${i + 1}`),
  };
}

describe('computeBlockEligibility', () => {
  it('marks a trigger eligible only when the Wilson bound and the TP count both clear the bar', () => {
    // 40 of 40 confirmed reverts: Wilson lower is well above 0.90 and TP >= 5.
    const strong = calibration('obligation-failure', 40, 0);
    // 2 of 2: precision 1.0 but only 2 confirmations, so the bound is low.
    const weak = calibration('claim-falsified', 2, 0);
    const out = computeBlockEligibility([strong, weak], opts);

    const strongRow = out.rows.find((r) => r.trigger === 'obligation-failure')!;
    const weakRow = out.rows.find((r) => r.trigger === 'claim-falsified')!;
    assert.equal(strongRow.blockEligible, true);
    assert.equal(weakRow.blockEligible, false);
    assert.deepEqual(out.blockEligibleTriggers, ['obligation-failure']);
    assert.equal(out.blockEligibleCount, 1);
  });

  it('keeps a noisy high-volume trigger out even with many true positives', () => {
    // 30 TP but 30 FP: precision 0.5, nowhere near the bar.
    const noisy = calibration('corroborated-under-constraint', 30, 30);
    const out = computeBlockEligibility([noisy], opts);
    assert.equal(out.rows[0]!.blockEligible, false);
    assert.equal(out.blockEligibleCount, 0);
    assert.match(out.rows[0]!.reason, /not block-eligible/);
  });

  it('reports zero eligible and an honest reason when nothing is measured', () => {
    const none = calibration('claim-falsified', 0, 0);
    const out = computeBlockEligibility([none], opts);
    assert.equal(out.blockEligibleCount, 0);
    assert.equal(out.rows[0]!.truePositive, 0);
    assert.match(out.rows[0]!.reason, /0 confirmed reverted TP/);
  });

  it('records the fixed thresholds it decided against', () => {
    const out = computeBlockEligibility([], opts);
    assert.equal(out.wilsonLowerThreshold, 0.9);
    assert.equal(out.minConfirmedRevertedForBlock, 5);
  });
});
