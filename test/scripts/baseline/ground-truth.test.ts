import { strict as assert } from 'assert';
import * as path from 'path';
import {
  buildFrozenReference,
  evaluateBaseline,
  GROUND_TRUTH_V12,
  liveValueForFloor,
  readLiveMetrics,
  referenceMatchesConstants,
  type LiveMetrics,
  type SourcePaths,
} from '../../../scripts/baseline/ground-truth';

// Live metrics sitting exactly on every gated floor. Overrides let each test
// push one metric below its floor without disturbing the others.
function liveAtFloor(over: Partial<LiveMetrics> = {}): LiveMetrics {
  return {
    oracleStructuralTp: 258,
    oracleStructuralInjections: 275,
    oracleSemanticJudgeTp: 43,
    oracleSemanticInjections: 50,
    realCorpusPrecisionPoint: 0.09663835601719065,
    realCorpusPrecisionWilsonLower: 0.09663835601719065,
    realCorpusRecall: 0.227,
    realCorpusF1: 0.222,
    realCorpusTruePositive: 5,
    realCorpusFalsePositive: 18,
    egViableCount: 12,
    egScreened: 197,
    ...over,
  };
}

// The repo root, resolved from the compiled test location so the integration
// test does not depend on the process cwd.
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const COMMITTED_SOURCES: SourcePaths = {
  oracleResults: path.join(REPO_ROOT, 'benchmarks/oracle-corpus/oracle-results.json'),
  scoresOutcome: path.join(REPO_ROOT, 'benchmarks/real-corpus/scores-outcome/latest.json'),
  egViability: path.join(REPO_ROOT, 'benchmarks/real-corpus/eg-viability.json'),
};

describe('scripts/baseline/ground-truth evaluateBaseline', () => {
  it('passes when every live metric sits exactly on its frozen floor', () => {
    const result = evaluateBaseline(GROUND_TRUTH_V12, liveAtFloor());
    assert.equal(result.pass, true);
    assert.equal(result.regressions.length, 0);
    assert.equal(result.checked, GROUND_TRUTH_V12.length);
  });

  it('passes when a live metric exceeds its floor', () => {
    const result = evaluateBaseline(GROUND_TRUTH_V12, liveAtFloor({ oracleStructuralTp: 270 }));
    assert.equal(result.pass, true);
  });

  it('flags oracle structural recall dropping one below the floor', () => {
    const result = evaluateBaseline(GROUND_TRUTH_V12, liveAtFloor({ oracleStructuralTp: 257 }));
    assert.equal(result.pass, false);
    const ids = result.regressions.map((r) => r.id);
    // A drop in structural tp regresses both the structural and overall floors.
    assert.ok(ids.includes('oracle-structural-recall'));
    assert.ok(ids.includes('oracle-overall-recall'));
  });

  it('flags real-corpus precision point falling below the frozen interval floor', () => {
    const result = evaluateBaseline(
      GROUND_TRUTH_V12,
      liveAtFloor({ realCorpusPrecisionPoint: 0.05 }),
    );
    assert.equal(result.pass, false);
    assert.deepEqual(
      result.regressions.map((r) => r.id),
      ['real-corpus-precision-point-vs-interval'],
    );
  });

  it('flags the Wilson lower bound collapsing below the frozen floor', () => {
    const result = evaluateBaseline(
      GROUND_TRUTH_V12,
      liveAtFloor({ realCorpusPrecisionWilsonLower: 0.0 }),
    );
    assert.equal(result.pass, false);
    assert.deepEqual(
      result.regressions.map((r) => r.id),
      ['real-corpus-precision-wilson-lower'],
    );
  });

  it('flags a drop in execution-grounded viability', () => {
    const result = evaluateBaseline(GROUND_TRUTH_V12, liveAtFloor({ egViableCount: 11 }));
    assert.equal(result.pass, false);
    assert.deepEqual(
      result.regressions.map((r) => r.id),
      ['eg-viable-count'],
    );
  });

  it('reports every regressed floor, not just the first', () => {
    const result = evaluateBaseline(
      GROUND_TRUTH_V12,
      liveAtFloor({ oracleStructuralTp: 200, egViableCount: 0, realCorpusPrecisionPoint: 0 }),
    );
    assert.equal(result.pass, false);
    // structural + overall (both driven by structuralTp) + precision-point + eg = 4.
    assert.equal(result.regressions.length, 4);
  });
});

describe('scripts/baseline/ground-truth liveValueForFloor', () => {
  it('sums structural and semantic true positives for the overall floor', () => {
    const value = liveValueForFloor('oracle-overall-recall', liveAtFloor());
    assert.equal(value, 301);
  });

  it('throws on an unknown floor id', () => {
    assert.throws(() => liveValueForFloor('not-a-floor', liveAtFloor()), /unknown baseline floor id/);
  });
});

describe('scripts/baseline/ground-truth referenceMatchesConstants', () => {
  it('accepts a freshly built reference whose floors mirror GROUND_TRUTH_V12', () => {
    const ref = buildFrozenReference(liveAtFloor(), COMMITTED_SOURCES, '2026-07-06T00:00:00.000Z');
    assert.equal(referenceMatchesConstants(ref), null);
  });

  it('rejects a reference whose floor was hand-lowered', () => {
    const ref = buildFrozenReference(liveAtFloor(), COMMITTED_SOURCES, '2026-07-06T00:00:00.000Z');
    const tampered = {
      ...ref,
      floors: ref.floors.map((f) =>
        f.id === 'oracle-overall-recall' ? { ...f, floor: 250 } : f,
      ),
    };
    const message = referenceMatchesConstants(tampered);
    assert.ok(message !== null);
    assert.match(message ?? '', /do not match GROUND_TRUTH_V12/);
  });
});

describe('scripts/baseline/ground-truth against the committed tree', () => {
  it('holds every frozen floor on the current committed artifacts', () => {
    const live = readLiveMetrics(COMMITTED_SOURCES);
    // Sanity: the committed oracle really is 301/325.
    assert.equal(live.oracleStructuralTp + live.oracleSemanticJudgeTp, 301);
    assert.equal(live.oracleStructuralInjections + live.oracleSemanticInjections, 325);
    const result = evaluateBaseline(GROUND_TRUTH_V12, live);
    assert.equal(result.pass, true, JSON.stringify(result.regressions));
  });
});
