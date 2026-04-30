import * as fs from 'fs/promises';
import * as path from 'path';
import { buildBenchmarkReport, renderBenchmarkMarkdown } from '../benchmark-report';
import { computeBenchmarkMetrics, expectedLayersForCategory, layerFired, type BenchmarkRecord } from '../benchmark-metrics';
import { runBattery } from '../harness';
import type { BrokenCategory } from '../schema';
import { loadSyntheticCorpus } from './synthetic-corpus';

export interface SyntheticCalibrationSummary {
  outputDir: string;
  reportJsonPath: string;
  reportMarkdownPath: string;
  records: number;
  misses: SyntheticTargetMiss[];
}

export interface SyntheticTargetMiss {
  entryId: string;
  category: BrokenCategory;
  expectedLayers: string[];
}

/** Runs synthetic adversarial calibration and writes a separate report. */
export async function runSyntheticCalibration(input: {
  syntheticRoot: string;
  outputDir: string;
  commitHash: string;
  categories?: readonly BrokenCategory[];
  skipMutation?: boolean;
}): Promise<SyntheticCalibrationSummary> {
  const outputDir = path.resolve(input.outputDir);
  const perEntryDir = path.join(outputDir, 'per-entry');
  await fs.mkdir(perEntryDir, { recursive: true });
  const corpus = loadSyntheticCorpus(
    input.syntheticRoot,
    input.categories === undefined ? {} : { categories: input.categories },
  );
  const records: BenchmarkRecord[] = [];

  for (const entry of corpus.entries) {
    const result = await runBattery(entry, {
      testSpecDir: corpus.testSpecDir,
      skipMutation: input.skipMutation ?? true,
      layerTimeoutMs: { intent: 5_000, regression: 10_000, property: 10_000 },
    });
    await writeJson(path.join(perEntryDir, `${entry.id}.json`), result);
    records.push({ entry, result });
  }

  const misses = targetMisses(records);
  if (misses.length > 0) {
    throw new Error([
      'synthetic calibration [target-layer]: one or more broken patches did not trigger their target layer',
      ...misses.map(miss => `${miss.entryId}: expected ${miss.expectedLayers.join(', ')} for ${miss.category}`),
    ].join('\n'));
  }

  const report = buildBenchmarkReport({
    runId: path.basename(outputDir),
    generatedAt: new Date().toISOString(),
    corpusName: 'synthetic adversarial corpus - layer calibration',
    records,
    skippedUnlabeled: [],
    invalidLabels: [],
    metrics: computeBenchmarkMetrics(records),
    reproducibility: {
      corpusDir: path.resolve(input.syntheticRoot),
      labelsDir: path.resolve(input.syntheticRoot),
      labelCommitHash: input.commitHash,
      batteryLibraryCommitHash: input.commitHash,
      labelsDirty: false,
      batteryLibraryDirty: false,
    },
  });
  const reportJsonPath = path.join(outputDir, 'report.json');
  const reportMarkdownPath = path.join(outputDir, 'report.md');
  await writeJson(reportJsonPath, {
    ...report,
    syntheticCalibration: perCategoryCalibration(records),
  });
  await fs.writeFile(reportMarkdownPath, renderSyntheticMarkdown(report, records), 'utf8');
  return { outputDir, reportJsonPath, reportMarkdownPath, records: records.length, misses };
}

/** Finds broken synthetic entries whose target layer did not fire. */
export function targetMisses(records: readonly BenchmarkRecord[]): SyntheticTargetMiss[] {
  return records.flatMap(record => {
    const categories = record.entry.groundTruth.brokenCategories ?? [];
    if (record.entry.groundTruth.verdict !== 'broken' || categories.length === 0) return [];
    const expectedLayers = [...new Set(categories.flatMap(expectedLayersForCategory))];
    const hit = expectedLayers.some(layer => layerFired(record.result.layers[layer]));
    return hit ? [] : [{
      entryId: record.entry.id,
      category: categories[0] as BrokenCategory,
      expectedLayers,
    }];
  });
}

function perCategoryCalibration(records: readonly BenchmarkRecord[]) {
  const categories = [...new Set(records.flatMap(record => record.entry.groundTruth.brokenCategories ?? []))].sort();
  return categories.map(category => {
    const broken = records.filter(record => record.entry.groundTruth.brokenCategories?.includes(category));
    const clean = records.filter(record => record.entry.id.includes(`synthetic-${category}-`) && record.entry.groundTruth.verdict === 'clean');
    const expectedLayers = [...new Set([category].flatMap(expectedLayersForCategory))];
    const missed = broken.filter(record => !expectedLayers.some(layer => layerFired(record.result.layers[layer]))).length;
    const falsePositive = clean.filter(record => expectedLayers.some(layer => layerFired(record.result.layers[layer]))).length;
    return {
      category,
      targetLayers: expectedLayers,
      brokenCount: broken.length,
      targetMisses: missed,
      cleanCount: clean.length,
      targetFalsePositives: falsePositive,
    };
  });
}

function renderSyntheticMarkdown(report: Parameters<typeof renderBenchmarkMarkdown>[0], records: readonly BenchmarkRecord[]): string {
  const rows = perCategoryCalibration(records).map(row =>
    `| ${row.category} | ${row.targetLayers.join(', ')} | ${row.brokenCount} | ${row.targetMisses} | ${row.cleanCount} | ${row.targetFalsePositives} |`
  );
  return [
    renderBenchmarkMarkdown(report),
    '',
    '## Synthetic Per-Pattern Calibration',
    '',
    '| Pattern | Target layer | Broken cases | Target misses | Clean controls | Target false positives |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
  ].join('\n');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
