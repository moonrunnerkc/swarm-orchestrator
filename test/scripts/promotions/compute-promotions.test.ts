import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computePromotions } from '../../../scripts/promotions/compute-promotions';

function writeScores(file: string): void {
  const snapshot = {
    generatedAt: '2026-05-24T14:17:34.169Z',
    detectorVersions: {
      'good-detector': '2.0.0',
      'mediocre-detector': '1.0.0',
      'silent-detector': '1.0.0',
    },
    perDetector: [
      {
        detector: 'good-detector',
        truePositive: 8,
        falsePositive: 2,
        trueNegative: 90,
        falseNegative: 2,
        precision: 0.8,
        recall: 0.8,
        f1: 0.8,
      },
      {
        detector: 'mediocre-detector',
        truePositive: 1,
        falsePositive: 9,
        trueNegative: 80,
        falseNegative: 10,
        precision: 0.1,
        recall: 0.09,
        f1: 0.095,
      },
      {
        detector: 'silent-detector',
        truePositive: 0,
        falsePositive: 0,
        trueNegative: 100,
        falseNegative: 0,
        precision: 0,
        recall: 0,
        f1: 0,
      },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(snapshot));
}

describe('scripts/promotions/compute-promotions', () => {
  it('promotes detectors with F1 >= threshold to gate-eligible', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const scoresFile = path.join(dir, 'scores.json');
    writeScores(scoresFile);
    const out = computePromotions({
      scoresFile,
      out: path.join(dir, 'p.json'),
      f1Threshold: 0.5,
    });
    assert.deepEqual(out.gateEligibleDetectors, ['good-detector']);
  });

  it('keeps detectors with F1 < threshold as advisory-only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const scoresFile = path.join(dir, 'scores.json');
    writeScores(scoresFile);
    const out = computePromotions({
      scoresFile,
      out: path.join(dir, 'p.json'),
      f1Threshold: 0.5,
    });
    assert.deepEqual(out.advisoryOnlyDetectors, ['mediocre-detector']);
  });

  it('flags detectors that never fired and have no positives as unmeasured', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const scoresFile = path.join(dir, 'scores.json');
    writeScores(scoresFile);
    const out = computePromotions({
      scoresFile,
      out: path.join(dir, 'p.json'),
      f1Threshold: 0.5,
    });
    assert.deepEqual(out.unmeasuredDetectors, ['silent-detector']);
  });

  it('threshold defaults to 0.5 in the typical call shape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const scoresFile = path.join(dir, 'scores.json');
    writeScores(scoresFile);
    const out = computePromotions({
      scoresFile,
      out: path.join(dir, 'p.json'),
      f1Threshold: 0.5,
    });
    assert.equal(out.f1GateThreshold, 0.5);
  });

  it('reason string cites the threshold and the scores file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const scoresFile = path.join(dir, 'scores.json');
    writeScores(scoresFile);
    const out = computePromotions({
      scoresFile,
      out: path.join(dir, 'p.json'),
      f1Threshold: 0.5,
    });
    const good = out.rows.find((r) => r.detector === 'good-detector')!;
    assert.ok(good.reason.includes('0.5'));
    assert.ok(good.reason.includes(scoresFile));
  });
});
