import { strict as assert } from 'assert';
import {
  assessCorroboratedGate,
  summarizeCorroboratedGate,
  CORROBORATED_GATE_WILSON_FLOOR,
  CORROBORATED_GATE_MIN_TRUE_POSITIVE,
} from '../../../src/audit/gate/corroborated-gate';

describe('audit/gate/corroborated-gate', () => {
  it('is undefined-n when the slice has no outcome-bad PRs, even with false positives', () => {
    const r = assessCorroboratedGate({
      perDetector: [{ detector: 'test-relaxation', truePositive: 0, falsePositive: 4 }],
      outcomeBadInSlice: 0,
    });
    assert.equal(r.status, 'undefined-n');
    assert.equal(r.precision, null);
    assert.equal(r.wilson, null);
    assert.match(r.reason, /n_bad=0/);
  });

  it('is undefined-n when no corroborated finding was scored at all', () => {
    const r = assessCorroboratedGate({ perDetector: [], outcomeBadInSlice: 7 });
    assert.equal(r.status, 'undefined-n');
    assert.equal(r.trials, 0);
    assert.equal(r.precision, null);
  });

  it('never reports ready on undefined-n regardless of the floor', () => {
    // A degenerate low floor must not be able to coax readiness out of an empty
    // positive class: undefined-n dominates.
    const r = assessCorroboratedGate({
      perDetector: [{ detector: 'x', truePositive: 0, falsePositive: 0 }],
      outcomeBadInSlice: 0,
      wilsonFloor: 0,
      minTruePositive: 0,
    });
    assert.equal(r.status, 'undefined-n');
    assert.notEqual(r.status, 'ready');
  });

  it('is not-ready when the Wilson lower bound is below the floor', () => {
    // 4/4 = precision 1.0 but Wilson-95 lower ~0.51, below 0.90, and tp<5.
    const r = assessCorroboratedGate({
      perDetector: [{ detector: 'assertion-strip', truePositive: 4, falsePositive: 0 }],
      outcomeBadInSlice: 4,
    });
    assert.equal(r.status, 'not-ready');
    assert.equal(r.precision, 1);
    assert.ok(r.wilson !== null && r.wilson.lower < CORROBORATED_GATE_WILSON_FLOOR);
  });

  it('is not-ready when precision is high but true positives are below the minimum', () => {
    const r = assessCorroboratedGate({
      perDetector: [{ detector: 'coverage-erosion', truePositive: 3, falsePositive: 0 }],
      outcomeBadInSlice: 3,
    });
    assert.equal(r.status, 'not-ready');
    assert.ok(r.truePositive < CORROBORATED_GATE_MIN_TRUE_POSITIVE);
  });

  it('is ready when the Wilson lower bound clears the floor with enough true positives', () => {
    // 60/60 gives a Wilson-95 lower well above 0.90.
    const r = assessCorroboratedGate({
      perDetector: [{ detector: 'test-relaxation', truePositive: 60, falsePositive: 0 }],
      outcomeBadInSlice: 40,
    });
    assert.equal(r.status, 'ready');
    assert.ok(r.wilson !== null && r.wilson.lower >= CORROBORATED_GATE_WILSON_FLOOR);
    assert.ok(r.truePositive >= CORROBORATED_GATE_MIN_TRUE_POSITIVE);
  });

  it('sums true and false positives across detectors', () => {
    const r = assessCorroboratedGate({
      perDetector: [
        { detector: 'a', truePositive: 30, falsePositive: 5 },
        { detector: 'b', truePositive: 30, falsePositive: 5 },
      ],
      outcomeBadInSlice: 40,
    });
    assert.equal(r.truePositive, 60);
    assert.equal(r.falsePositive, 10);
    assert.equal(r.trials, 70);
  });

  it('summarizes undefined-n and measured verdicts distinctly', () => {
    const undef = assessCorroboratedGate({ perDetector: [], outcomeBadInSlice: 0 });
    assert.match(summarizeCorroboratedGate(undef), /UNDEFINED-N/);
    const ready = assessCorroboratedGate({
      perDetector: [{ detector: 'x', truePositive: 60, falsePositive: 0 }],
      outcomeBadInSlice: 40,
    });
    assert.match(summarizeCorroboratedGate(ready), /READY \(wilson-lower/);
  });
});
