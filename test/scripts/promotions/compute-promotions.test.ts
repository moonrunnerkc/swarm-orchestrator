import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computePromotions,
  wilsonLowerBound,
} from '../../../scripts/promotions/compute-promotions';

function writeScores(file: string): void {
  const snapshot = {
    generatedAt: '2026-05-24T14:17:34.169Z',
    detectorVersions: {
      'precise-detector': '2.0.0',
      'small-sample-detector': '1.0.0',
      'mediocre-detector': '1.0.0',
      'silent-detector': '1.0.0',
    },
    perDetector: [
      // High precision with enough firings: clears the gate.
      {
        detector: 'precise-detector',
        truePositive: 18,
        falsePositive: 1,
        trueNegative: 90,
        falseNegative: 2,
        precision: 18 / 19,
        recall: 0.9,
        f1: 0.9,
      },
      // Perfect precision but only three firings: the Wilson lower
      // bound is below 0.5, so it stays advisory rather than promoting
      // on luck.
      {
        detector: 'small-sample-detector',
        truePositive: 3,
        falsePositive: 0,
        trueNegative: 100,
        falseNegative: 1,
        precision: 1,
        recall: 0.75,
        f1: 0.857,
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

function run(dir: string) {
  const scoresFile = path.join(dir, 'scores.json');
  writeScores(scoresFile);
  return {
    scoresFile,
    out: computePromotions({
      scoresFile,
      out: path.join(dir, 'p.json'),
      gatePrecision: 0.9,
      minTruePositive: 5,
    }),
  };
}

describe('scripts/promotions/compute-promotions', () => {
  it('gate-eligible requires precision, a minimum TP count, and a Wilson lower bound', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const { out } = run(dir);
    assert.deepEqual(out.gateEligibleDetectors, ['precise-detector']);
  });

  it('keeps a perfect-but-tiny-sample detector advisory (Wilson guard)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const { out } = run(dir);
    assert.ok(out.advisoryOnlyDetectors.includes('small-sample-detector'));
    assert.ok(out.advisoryOnlyDetectors.includes('mediocre-detector'));
    assert.ok(!out.gateEligibleDetectors.includes('small-sample-detector'));
  });

  it('flags detectors that never fired and have no positives as unmeasured', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const { out } = run(dir);
    assert.deepEqual(out.unmeasuredDetectors, ['silent-detector']);
  });

  it('records the gate thresholds it decided against', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const { out } = run(dir);
    assert.equal(out.gatePrecisionThreshold, 0.9);
    assert.equal(out.minTruePositiveForGate, 5);
  });

  it('reason string cites the precision and the scores file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const { out, scoresFile } = run(dir);
    const good = out.rows.find((r) => r.detector === 'precise-detector')!;
    assert.ok(good.reason.includes('precision'));
    assert.ok(good.reason.includes(scoresFile));
  });

  it('judge-primary categories are advisory (warn, not block) with no measurement on file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const { out } = run(dir);
    assert.equal(out.judgePrimary.defaultBlock, false);
    assert.deepEqual(
      out.judgePrimary.categories.map((c) => c.category).sort(),
      ['cheat-mock-mutation', 'goal-not-fixed'],
    );
    for (const c of out.judgePrimary.categories) {
      assert.equal(c.block, false);
      assert.equal(c.warn, true);
      assert.equal(c.measurement, null);
    }
  });

  it('promotes a judge-primary category to block only when a measurement clears the bar', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const scoresFile = path.join(dir, 'scores.json');
    writeScores(scoresFile);
    const measurementsFile = path.join(dir, 'measurements.json');
    fs.writeFileSync(
      measurementsFile,
      JSON.stringify({
        'goal-not-fixed': {
          fpRatePostPp: 3.0,
          fpRateBaselinePp: 2.0, // delta 1.0pp, within the 2pp bar
          windowPrCount: 120,
          source: 'acme/widgets last-120-merged',
        },
        'cheat-mock-mutation': {
          fpRatePostPp: 8.0,
          fpRateBaselinePp: 2.0, // delta 6.0pp, over the bar
          windowPrCount: 120,
          source: 'acme/widgets last-120-merged',
        },
      }),
    );
    const out = computePromotions({
      scoresFile,
      out: path.join(dir, 'p.json'),
      gatePrecision: 0.9,
      minTruePositive: 5,
      measurementsFile,
    });
    const goal = out.judgePrimary.categories.find((c) => c.category === 'goal-not-fixed')!;
    const mock = out.judgePrimary.categories.find((c) => c.category === 'cheat-mock-mutation')!;
    assert.equal(goal.block, true, 'delta within bar promotes to block');
    assert.equal(mock.block, false, 'delta over bar stays advisory');
    assert.equal(mock.warn, true);
  });

  it('does not promote when the window is too small even if the delta is within the bar', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-prom-'));
    const scoresFile = path.join(dir, 'scores.json');
    writeScores(scoresFile);
    const measurementsFile = path.join(dir, 'measurements.json');
    fs.writeFileSync(
      measurementsFile,
      JSON.stringify({
        'goal-not-fixed': {
          fpRatePostPp: 2.5,
          fpRateBaselinePp: 2.0, // delta 0.5pp, within the bar
          windowPrCount: 10, // but far too few PRs
          source: 'tiny window',
        },
      }),
    );
    const out = computePromotions({
      scoresFile,
      out: path.join(dir, 'p.json'),
      gatePrecision: 0.9,
      minTruePositive: 5,
      measurementsFile,
    });
    const goal = out.judgePrimary.categories.find((c) => c.category === 'goal-not-fixed')!;
    assert.equal(goal.block, false);
  });

  it('Wilson lower bound shrinks with smaller samples at equal precision', () => {
    // 1.0 precision over 3 trials must be treated as less certain than
    // 1.0 over 200 trials.
    assert.ok(wilsonLowerBound(3, 3) < wilsonLowerBound(200, 200));
    assert.ok(wilsonLowerBound(3, 3) < 0.5);
    assert.equal(wilsonLowerBound(0, 0), 0);
  });
});
