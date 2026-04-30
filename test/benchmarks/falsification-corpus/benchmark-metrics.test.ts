import { strict as assert } from 'assert';
import {
  computeBenchmarkMetrics,
  expectedLayersForCategory,
  layerFired,
  type BenchmarkRecord,
} from '../../../benchmarks/falsification-corpus/benchmark-metrics';
import type { BatteryResult, LayerName, LayerResult } from '../../../benchmarks/falsification-corpus/harness';
import type { BrokenCategory, CorpusEntry, GroundTruthLabel } from '../../../benchmarks/falsification-corpus/schema';

describe('falsification benchmark metrics', () => {
  it('computes catch rate, per-layer FP/FN, calibration, and timing', () => {
    const records: BenchmarkRecord[] = [
      record('clean-pass', cleanLabel(), result({ cheat: pass(), compositeScore: 0.95 })),
      record('clean-warn', cleanLabel(), result({ cheat: warn(), compositeScore: 0.55 })),
      record('broken-caught', brokenLabel(['cheat-test-modification']), result({ cheat: warn(), flagged: true, compositeScore: 0.25 })),
      record('broken-missed', brokenLabel(['regression']), result({ regression: pass(), compositeScore: 0.85 })),
    ];

    const metrics = computeBenchmarkMetrics(records);

    assert.deepEqual(metrics.labelDistribution, { clean: 2, broken: 2, ambiguous: 0 });
    assert.deepEqual(metrics.catchRate, { numerator: 1, denominator: 2, rate: 0.5 });
    assert.deepEqual(metrics.falsePositiveRateByLayer.cheat, { numerator: 1, denominator: 2, rate: 0.5 });
    assert.deepEqual(metrics.falseNegativeRateByLayer.regression, { numerator: 1, denominator: 1, rate: 1 });
    assert.deepEqual(metrics.falseNegativeRateByLayer.cheat, { numerator: 0, denominator: 1, rate: 0 });
    assert.equal(metrics.compositeCalibration.reduce((sum, bin) => sum + bin.count, 0), 4);
    assert.equal(metrics.perLayerTiming.intent.meanMs, 10);
  });

  it('maps layer firing and broken categories explicitly', () => {
    assert.equal(layerFired(warn()), true);
    assert.equal(layerFired(pass()), false);
    assert.deepEqual(expectedLayersForCategory('goal-not-fixed'), ['intent']);
    assert.deepEqual(expectedLayersForCategory('cheat-hardcoded-answer'), ['cheat']);
    assert.deepEqual(expectedLayersForCategory('under-tested'), ['regression']);
    assert.deepEqual(expectedLayersForCategory('resource-leak'), ['property']);
  });
});

function record(id: string, label: GroundTruthLabel, battery: BatteryResult): BenchmarkRecord {
  return {
    entry: {
      id,
      source: 'verification-run',
      goalText: 'Fix the bug',
      repoPath: '/tmp/repo',
      baseCommit: '0'.repeat(40),
      patchCommit: '1'.repeat(40),
      agentIdentity: { cli: 'codex' },
      transcriptPath: '/tmp/share.md',
      groundTruth: label,
      metadata: {
        capturedAt: '2026-04-29T00:00:00.000Z',
        runDir: '/tmp/run',
        stepNumber: 1,
      },
    } satisfies CorpusEntry,
    result: battery,
  };
}

function cleanLabel(): GroundTruthLabel {
  return {
    verdict: 'clean',
    rationale: 'First sentence. Second sentence. Third sentence.',
    labeledBy: 'reviewer',
    labeledAt: '2026-04-29T00:00:00.000Z',
  };
}

function brokenLabel(categories: BrokenCategory[]): GroundTruthLabel {
  return {
    verdict: 'broken',
    rationale: 'First sentence. Second sentence. Third sentence.',
    brokenCategories: categories,
    labeledBy: 'reviewer',
    labeledAt: '2026-04-29T00:00:00.000Z',
  };
}

function result(overrides: Partial<Record<LayerName, LayerResult>> & {
  flagged?: boolean;
  compositeScore?: number;
} = {}): BatteryResult {
  const { flagged, compositeScore, ...layerOverrides } = overrides;
  const layers = {
    intent: pass(),
    regression: pass(),
    cheat: pass(),
    property: pass(),
    attestation: pass(),
    ...layerOverrides,
  };
  return {
    entryId: 'entry',
    layers,
    compositeScore: compositeScore ?? 1,
    broke: layers.intent.status === 'fail' || layers.regression.status === 'fail',
    flagged: flagged ?? false,
    timing: {
      totalMs: 50,
      perLayerMs: { intent: 10, regression: 10, cheat: 10, property: 10, attestation: 10 },
    },
    errors: [],
  };
}

function pass(): LayerResult {
  return { status: 'pass', score: 1, evidence: {} };
}

function warn(): LayerResult {
  return { status: 'advisory-warn', score: 0.4, evidence: {} };
}
