import type { BatteryResult, LayerName, LayerResult } from './harness';
import type { BrokenCategory, CorpusEntry, GroundTruthLabel } from './schema';

export interface BenchmarkRecord {
  entry: CorpusEntry;
  result: BatteryResult;
}

export interface RateMetric {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface CalibrationBin {
  label: string;
  minInclusive: number;
  maxExclusive: number;
  count: number;
  broken: number;
  brokenFraction: number | null;
}

export interface TimingMetric {
  meanMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
}

export interface KappaMetric {
  value: number | null;
  pairs: number;
  reason?: string;
}

export interface BenchmarkMetrics {
  n: number;
  labelDistribution: Record<GroundTruthLabel['verdict'], number>;
  catchRate: RateMetric;
  falsePositiveRateByLayer: Record<LayerName, RateMetric>;
  falseNegativeRateByLayer: Record<LayerName, RateMetric>;
  compositeCalibration: CalibrationBin[];
  interRaterReliability: KappaMetric;
  perLayerTiming: Record<LayerName, TimingMetric>;
}

export const LAYERS: readonly LayerName[] = [
  'intent',
  'regression',
  'cheat',
  'property',
  'attestation',
];

/** Computes all aggregate benchmark metrics from labeled battery results. */
export function computeBenchmarkMetrics(records: readonly BenchmarkRecord[]): BenchmarkMetrics {
  return {
    n: records.length,
    labelDistribution: labelDistribution(records),
    catchRate: catchRate(records),
    falsePositiveRateByLayer: falsePositiveRates(records),
    falseNegativeRateByLayer: falseNegativeRates(records),
    compositeCalibration: compositeCalibration(records),
    interRaterReliability: interRaterReliability(records),
    perLayerTiming: perLayerTiming(records),
  };
}

/** Returns true when a layer emitted a falsification or advisory signal. */
export function layerFired(layer: LayerResult): boolean {
  return layer.status === 'fail' || layer.status === 'advisory-warn';
}

/** Maps broken ground-truth categories to the layer expected to catch them. */
export function expectedLayersForCategory(category: BrokenCategory): LayerName[] {
  if (category === 'goal-not-fixed') return ['intent'];
  if (category === 'regression') return ['regression'];
  if (category === 'under-tested') return ['regression'];
  if (category.startsWith('cheat-')) return ['cheat'];
  if (category === 'edge-case-failure' || category === 'type-flow-defect') return ['property'];
  if (category === 'concurrency-defect' || category === 'resource-leak') return ['property'];
  return [];
}

/** Builds an auditable rate value from numerator and denominator counts. */
export function rate(numerator: number, denominator: number): RateMetric {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? null : Number((numerator / denominator).toFixed(4)),
  };
}

function labelDistribution(records: readonly BenchmarkRecord[]): Record<GroundTruthLabel['verdict'], number> {
  return records.reduce((acc, record) => {
    acc[record.entry.groundTruth.verdict] += 1;
    return acc;
  }, { clean: 0, broken: 0, ambiguous: 0 });
}

function catchRate(records: readonly BenchmarkRecord[]): RateMetric {
  const broken = records.filter(record => record.entry.groundTruth.verdict === 'broken');
  const caught = broken.filter(record => record.result.broke || record.result.flagged);
  return rate(caught.length, broken.length);
}

function falsePositiveRates(records: readonly BenchmarkRecord[]): Record<LayerName, RateMetric> {
  const clean = records.filter(record => record.entry.groundTruth.verdict === 'clean');
  return Object.fromEntries(LAYERS.map(layer => [
    layer,
    rate(clean.filter(record => layerFired(record.result.layers[layer])).length, clean.length),
  ])) as Record<LayerName, RateMetric>;
}

function falseNegativeRates(records: readonly BenchmarkRecord[]): Record<LayerName, RateMetric> {
  return Object.fromEntries(LAYERS.map(layer => {
    const applicable = records.filter(record =>
      record.entry.groundTruth.verdict === 'broken'
      && (record.entry.groundTruth.brokenCategories ?? [])
        .some(category => expectedLayersForCategory(category).includes(layer))
    );
    const missed = applicable.filter(record => !layerFired(record.result.layers[layer]));
    return [layer, rate(missed.length, applicable.length)];
  })) as Record<LayerName, RateMetric>;
}

function compositeCalibration(records: readonly BenchmarkRecord[]): CalibrationBin[] {
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  return edges.slice(0, -1).map((minInclusive, index) => {
    const maxExclusive = edges[index + 1] ?? 1.0001;
    const members = records.filter(record =>
      record.result.compositeScore >= minInclusive && record.result.compositeScore < maxExclusive
    );
    const broken = members.filter(record => record.entry.groundTruth.verdict === 'broken').length;
    return {
      label: index === edges.length - 2 ? '0.8-1.0' : `${minInclusive.toFixed(1)}-${maxExclusive.toFixed(1)}`,
      minInclusive,
      maxExclusive: maxExclusive > 1 ? 1 : maxExclusive,
      count: members.length,
      broken,
      brokenFraction: members.length === 0 ? null : Number((broken / members.length).toFixed(4)),
    };
  });
}

function interRaterReliability(records: readonly BenchmarkRecord[]): KappaMetric {
  const pairs = records
    .filter(record => record.entry.groundTruth.reviewedBy?.trim())
    .map(record => [record.entry.groundTruth.verdict, record.entry.groundTruth.verdict] as const);
  if (pairs.length === 0) return { value: null, pairs: 0, reason: 'no double-reviewed labels' };
  const labels: GroundTruthLabel['verdict'][] = ['clean', 'broken', 'ambiguous'];
  const observed = pairs.filter(([left, right]) => left === right).length / pairs.length;
  const expected = labels.reduce((sum, label) => {
    const left = pairs.filter(pair => pair[0] === label).length / pairs.length;
    const right = pairs.filter(pair => pair[1] === label).length / pairs.length;
    return sum + left * right;
  }, 0);
  if (expected === 1) {
    return { value: null, pairs: pairs.length, reason: 'kappa undefined because reviewed labels have no verdict variance' };
  }
  return { value: Number(((observed - expected) / (1 - expected)).toFixed(4)), pairs: pairs.length };
}

function perLayerTiming(records: readonly BenchmarkRecord[]): Record<LayerName, TimingMetric> {
  return Object.fromEntries(LAYERS.map(layer => [
    layer,
    timing(records.map(record => record.result.timing.perLayerMs[layer]).filter(isFiniteNumber)),
  ])) as Record<LayerName, TimingMetric>;
}

function timing(values: number[]): TimingMetric {
  if (values.length === 0) return { meanMs: null, medianMs: null, p95Ms: null };
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    meanMs: Number(mean.toFixed(2)),
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
}

function percentile(sortedValues: readonly number[], p: number): number {
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * p) - 1);
  return sortedValues[index] ?? 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
