import type { BatteryResult, LayerName } from './harness';
import type { LabelStatusRow } from './label-store';
import type { BenchmarkMetrics, BenchmarkRecord, RateMetric } from './benchmark-metrics';
import { LAYERS } from './benchmark-metrics';

export interface BenchmarkReproducibility {
  corpusDir: string;
  labelsDir: string;
  labelCommitHash: string;
  batteryLibraryCommitHash: string;
  labelsDirty: boolean;
  batteryLibraryDirty: boolean;
}

export interface BenchmarkReport {
  runId: string;
  generatedAt: string;
  corpusName: string;
  draft: boolean;
  insufficientN: boolean;
  skippedUnlabeled: string[];
  invalidLabels: LabelStatusRow[];
  metrics: BenchmarkMetrics;
  reproducibility: BenchmarkReproducibility;
  limitations: string[];
  results: BatteryResult[];
}

/** Builds the complete JSON report payload from benchmark records. */
export function buildBenchmarkReport(input: {
  runId: string;
  generatedAt: string;
  corpusName: string;
  records: readonly BenchmarkRecord[];
  skippedUnlabeled: readonly string[];
  invalidLabels: readonly LabelStatusRow[];
  metrics: BenchmarkMetrics;
  reproducibility: BenchmarkReproducibility;
}): BenchmarkReport {
  const insufficientN = input.records.length < 10;
  return {
    runId: input.runId,
    generatedAt: input.generatedAt,
    corpusName: input.corpusName,
    draft: insufficientN,
    insufficientN,
    skippedUnlabeled: [...input.skippedUnlabeled],
    invalidLabels: [...input.invalidLabels],
    metrics: input.metrics,
    reproducibility: input.reproducibility,
    limitations: limitations(input.records.length, input.metrics.interRaterReliability.reason),
    results: input.records.map(record => record.result),
  };
}

/** Renders a publishable markdown benchmark report. */
export function renderBenchmarkMarkdown(report: BenchmarkReport): string {
  const title = report.draft
    ? `# DRAFT - ${report.corpusName} falsification benchmark`
    : `# ${report.corpusName} falsification benchmark`;
  return [
    title,
    '',
    report.draft ? '**DRAFT - insufficient n.** This result is not publishable as a final benchmark.' : '',
    '',
    '## Summary',
    '',
    '| Benchmark | Corpus | n | Catch rate | Status |',
    '| --- | --- | ---: | ---: | --- |',
    `| Falsification battery | ${report.corpusName} | ${report.metrics.n} | ${formatRate(report.metrics.catchRate)} | ${report.draft ? 'DRAFT' : 'publishable'} |`,
    '',
    '## Labels',
    '',
    `- Clean: ${report.metrics.labelDistribution.clean}`,
    `- Broken: ${report.metrics.labelDistribution.broken}`,
    `- Ambiguous: ${report.metrics.labelDistribution.ambiguous}`,
    `- Skipped unlabeled: ${report.skippedUnlabeled.length}`,
    `- Invalid labels: ${report.invalidLabels.length}`,
    '',
    '## Per-Layer Metrics',
    '',
    '| Layer | False positive rate | False negative rate | Mean ms | Median ms | P95 ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...LAYERS.map(layer => layerRow(layer, report)),
    '',
    '## Composite Calibration',
    '',
    'Lower composite scores should have higher broken fractions.',
    '',
    '```text',
    ...report.metrics.compositeCalibration.map(bin => {
      const fraction = bin.brokenFraction === null ? 'n/a' : `${Math.round(bin.brokenFraction * 100)}%`;
      const bar = '#'.repeat(bin.brokenFraction === null ? 0 : Math.round(bin.brokenFraction * 20));
      return `${bin.label.padEnd(7)} n=${String(bin.count).padStart(2)} broken=${fraction.padStart(4)} ${bar}`;
    }),
    '```',
    '',
    '## Inter-Rater Reliability',
    '',
    report.metrics.interRaterReliability.value === null
      ? `Cohen's kappa: n/a (${report.metrics.interRaterReliability.reason ?? 'not available'})`
      : `Cohen's kappa: ${report.metrics.interRaterReliability.value} over ${report.metrics.interRaterReliability.pairs} double-reviewed labels`,
    '',
    '## Known Limitations',
    '',
    ...report.limitations.map(item => `- ${item}`),
    '',
    '## Reproducibility',
    '',
    `- Run ID: ${report.runId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Corpus directory: ${report.reproducibility.corpusDir}`,
    `- Labels directory: ${report.reproducibility.labelsDir}`,
    `- Label commit hash: ${report.reproducibility.labelCommitHash}${report.reproducibility.labelsDirty ? ' (dirty)' : ''}`,
    `- Battery library commit hash: ${report.reproducibility.batteryLibraryCommitHash}${report.reproducibility.batteryLibraryDirty ? ' (dirty)' : ''}`,
    '',
  ].filter((line, index, lines) => !(line === '' && lines[index - 1] === '')).join('\n');
}

/** Formats a rate metric as a percent with raw counts. */
export function formatRate(metric: RateMetric): string {
  if (metric.rate === null) return `n/a (${metric.numerator}/${metric.denominator})`;
  return `${(metric.rate * 100).toFixed(1)}% (${metric.numerator}/${metric.denominator})`;
}

function layerRow(layer: LayerName, report: BenchmarkReport): string {
  const timing = report.metrics.perLayerTiming[layer];
  return [
    layer,
    formatRate(report.metrics.falsePositiveRateByLayer[layer]),
    formatRate(report.metrics.falseNegativeRateByLayer[layer]),
    formatMs(timing.meanMs),
    formatMs(timing.medianMs),
    formatMs(timing.p95Ms),
  ].join(' | ').replace(/^/, '| ').replace(/$/, ' |');
}

function formatMs(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(0);
}

function limitations(n: number, kappaReason: string | undefined): string[] {
  const items = [
    'Synthetic adversarial patches are reported separately and are not averaged into agent-authored catch rate.',
    'Skipped layers are not counted as hard-gate breakage.',
    'Environmental errors halt publication when they make an entry unrunnable.',
  ];
  if (n < 10) items.unshift('n < 10, so this report is a draft only.');
  if (kappaReason) items.push(`Inter-rater reliability limitation: ${kappaReason}.`);
  return items;
}
