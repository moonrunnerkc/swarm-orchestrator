import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateHuntEvidence } from '../../scripts/promotions/aggregate-hunt-verdicts';
import { loadPromotionMeasurements } from '../../scripts/promotions/compute-promotions';

function funnel(over: Record<string, unknown>): Parameters<typeof aggregateHuntEvidence>[0][number] {
  return {
    ref: 'a/b#1',
    agent: 'devin',
    status: 'audited',
    pass: true,
    gateTriggers: [],
    advisoryFindings: [],
    provisioning: { attempted: true, provisioned: true },
    disputed: 0,
    abstainVerdicts: [],
    ...over,
  } as Parameters<typeof aggregateHuntEvidence>[0][number];
}

describe('aggregateHuntEvidence', () => {
  it('tallies gate triggers, advisory firings, and provisioning, with 0 confirmed catches', () => {
    const ev = aggregateHuntEvidence(
      [
        funnel({ advisoryFindings: [{ category: 'no-op-fix', severity: 'info' }], provisioning: { attempted: true, provisioned: true } }),
        funnel({ advisoryFindings: [{ category: 'no-op-fix', severity: 'info' }, { category: 'error-swallow', severity: 'warn' }], disputed: 1 }),
        funnel({ status: 'timeout', pass: null, provisioning: null }),
      ],
      'records',
    );
    assert.equal(ev.prsAudited, 3);
    assert.equal(ev.provisioned, 2);
    assert.equal(ev.timeouts, 1);
    assert.equal(ev.confirmedMilestoneCatches, 0);
    assert.deepEqual(ev.gateTriggerFirings, {});
    assert.equal(ev.advisoryFindingFirings['no-op-fix:info'], 2);
    assert.equal(ev.advisoryFindingFirings['error-swallow:warn'], 1);
    assert.equal(ev.disputedCount, 1);
  });

  it('counts a self-certifying gate trigger firing but never as a confirmed catch (that is maintainer-gated)', () => {
    const ev = aggregateHuntEvidence(
      [funnel({ gateTriggers: ['test-tamper-proven'], pass: false })],
      'records',
    );
    assert.equal(ev.gateTriggerFirings['test-tamper-proven'], 1);
    assert.equal(ev.confirmedMilestoneCatches, 0);
  });
});

describe('loadPromotionMeasurements', () => {
  it('returns nulls (everything advisory) when the measurements file is absent', () => {
    const missing = path.join(os.tmpdir(), 'no-such-promotion-measurements-xyz.json');
    const m = loadPromotionMeasurements(missing);
    assert.equal(m.claimBinding, null);
    assert.equal(m.claimDifferential, null);
  });

  it('reads a folded measurement so a maintainer can promote a tier', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promeas-'));
    const file = path.join(dir, 'promotion-measurements.json');
    fs.writeFileSync(file, JSON.stringify({ claimBinding: { truePositive: 6, falsePositive: 0, wilsonLower: 0.92 } }));
    try {
      const m = loadPromotionMeasurements(file);
      assert.equal(m.claimBinding?.truePositive, 6);
      assert.equal(m.claimDifferential, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
