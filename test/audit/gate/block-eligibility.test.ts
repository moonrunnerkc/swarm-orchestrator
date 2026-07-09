import { strict as assert } from 'assert';
import { computeBlockEligibility } from '../../../src/audit/gate/block-eligibility';
import type { TriggerCalibration } from '../../../src/audit/gate/calibrate-triggers';
import { wilsonLowerBound } from '../../../src/audit/gate/wilson';
import { isSelfCertifying } from '../../../src/audit/gate/self-certifying';

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
    // 2 of 2 circumstantial: precision 1.0 but only 2 confirmations, so the bound is low (not self-cert).
    const weak = calibration('corroborated-under-constraint', 2, 0);
    const out = computeBlockEligibility([strong, weak], opts);

    const strongRow = out.rows.find((r) => r.trigger === 'obligation-failure')!;
    const weakRow = out.rows.find((r) => r.trigger === 'corroborated-under-constraint')!;
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

  it('reports zero eligible and an honest reason when nothing is measured (for circumstantial)', () => {
    const none = calibration('corroborated-under-constraint', 0, 0);
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

  it('assigns tier and makes self-certifying triggers eligible independent of Wilson (per-instance controls decide actual block)', () => {
    // Low Wilson but self-cert (e.g. test-tamper with 1 green firing)
    const selfLow = calibration('test-tamper-proven', 1, 0);
    // Circumstantial with low
    const circLow = calibration('corroborated-under-constraint', 1, 0);
    const out = computeBlockEligibility([selfLow, circLow], opts);

    const selfRow = out.rows.find((r) => r.trigger === 'test-tamper-proven')!;
    const circRow = out.rows.find((r) => r.trigger === 'corroborated-under-constraint')!;
    assert.equal(selfRow.tier, 'self-certifying');
    assert.equal(circRow.tier, 'circumstantial');
    assert.equal(selfRow.blockEligible, true);
    assert.equal(circRow.blockEligible, false);
    assert.match(selfRow.reason, /self-certifying/);
    assert.match(circRow.reason, /not block-eligible/);
    // blockEligibleCount reflects the self one (even with low Wilson / low N)
    assert.equal(out.blockEligibleCount, 1);
    assert.deepEqual(out.blockEligibleTriggers, ['test-tamper-proven']);
  });

  it('self-certifying triggers with 0 firings are still tier-eligible (runtime controls gate the actual use)', () => {
    const zero = calibration('obligation-failure', 0, 0);
    const out = computeBlockEligibility([zero], opts);
    const row = out.rows[0]!;
    assert.equal(row.tier, 'self-certifying');
    assert.equal(row.blockEligible, true);
    assert.match(row.reason, /self-certifying/);
  });

  it('auto-demotes a self-certifying trigger whose accrued false positives drop the Wilson bound below the bar', () => {
    // A self-certifying trigger whose only real-world firings were false
    // positives (1 TP, 3 FP): Wilson-95 lower is far below 0.90, so it demotes.
    const noisySelf = calibration('test-tamper-proven', 1, 3);
    const out = computeBlockEligibility([noisySelf], opts);
    const row = out.rows[0]!;
    assert.equal(row.tier, 'self-certifying');
    assert.equal(row.blockEligible, false);
    assert.match(row.reason, /auto-demoted to advisory/);
    assert.equal(out.blockEligibleCount, 0);
  });

  it('demotes a self-certifying trigger on a still-live FP-registry entry, and keeps it eligible once neutralized', () => {
    // 0 calibration firings, but one live FP from the registry: falsePositive
    // becomes 1, Wilson(0,1)=0, so it demotes.
    const clean = calibration('test-tamper-proven', 0, 0);
    const demoted = computeBlockEligibility([clean], opts, [
      { trigger: 'test-tamper-proven', pr: 'acme/live#1' },
    ]);
    assert.equal(demoted.rows[0]!.blockEligible, false);
    assert.equal(demoted.rows[0]!.falsePositive, 1);
    assert.match(demoted.rows[0]!.reason, /auto-demoted/);

    // With no live registry FP (the refuter neutralized it), the same trigger
    // stays eligible: a fixed FP class does not keep demoting.
    const eligible = computeBlockEligibility([clean], opts, []);
    assert.equal(eligible.rows[0]!.blockEligible, true);
    assert.equal(eligible.rows[0]!.falsePositive, 0);
  });

  it('does not demote a self-certifying trigger whose true positives keep Wilson above the bar despite a false positive', () => {
    // 100 TP, 1 FP: Wilson-95 lower stays above 0.90, so an isolated FP does not
    // demote a well-calibrated trigger. Demotion is Wilson-driven, not any-FP.
    const strong = calibration('test-tamper-proven', 100, 1);
    const out = computeBlockEligibility([strong], opts);
    assert.equal(out.rows[0]!.blockEligible, true);
    assert.match(out.rows[0]!.reason, /block-eligible \(self-certifying\)/);
  });
});
