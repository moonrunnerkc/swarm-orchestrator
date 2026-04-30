import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { buildBenchmarkReport, renderBenchmarkMarkdown } from '../benchmark-report';
import { computeBenchmarkMetrics, type BenchmarkRecord } from '../benchmark-metrics';
import { runBattery, type BatteryHarnessOptions, type BatteryResult } from '../harness';
import { buildLabelStatus, loadLabeledEntries } from '../label-store';
import { loadCorpus } from '../loader';

export interface RunBenchmarkArgs {
  corpusDir: string;
  labelsDir: string;
  outputDir: string;
  testSpecDir?: string;
}

export interface RunBenchmarkSummary {
  reportJsonPath: string;
  reportMarkdownPath: string;
  perEntryDir: string;
  records: number;
  draft: boolean;
}

/** Runs the labeled falsification benchmark and writes per-entry plus aggregate reports. */
export async function runBenchmark(args: RunBenchmarkArgs): Promise<RunBenchmarkSummary> {
  const corpusDir = path.resolve(args.corpusDir);
  const labelsDir = path.resolve(args.labelsDir);
  const outputDir = path.resolve(args.outputDir);
  const perEntryDir = path.join(outputDir, 'per-entry');
  await fs.mkdir(perEntryDir, { recursive: true });

  const entries = await loadCorpus(corpusDir);
  const { labeled } = await loadLabeledEntries(entries, labelsDir);
  const statusRows = await buildLabelStatus(entries, labelsDir);
  const skippedUnlabeled = statusRows.filter(row => row.status === 'unlabeled').map(row => row.entryId);
  const invalidLabels = statusRows.filter(row => row.status === 'invalid');
  for (const entryId of skippedUnlabeled) {
    console.warn(`Skipping unlabeled corpus entry ${entryId}`);
  }
  for (const row of invalidLabels) {
    console.warn(`Skipping invalid label ${row.entryId}: ${row.issues.join('; ')}`);
  }

  const records: BenchmarkRecord[] = [];
  for (const entry of labeled) {
    const result = await runBattery(entry, harnessOptions(args));
    if (onlyEnvError(result)) {
      throw new Error(`${entry.id} [battery]: all layers returned env-error. Fix the environment or remove this entry.`);
    }
    await writeJson(path.join(perEntryDir, `${entry.id}.json`), result);
    records.push({ entry, result });
  }

  const envOnlyCount = records.filter(record => onlyEnvError(record.result)).length;
  if (records.length > 0 && envOnlyCount > records.length / 2) {
    throw new Error(`benchmark [battery]: ${envOnlyCount}/${records.length} entries returned only env-error layers. Fix the harness environment before publishing.`);
  }

  const metrics = computeBenchmarkMetrics(records);
  const report = buildBenchmarkReport({
    runId: path.basename(outputDir),
    generatedAt: new Date().toISOString(),
    corpusName: path.basename(corpusDir),
    records,
    skippedUnlabeled,
    invalidLabels,
    metrics,
    reproducibility: reproducibility(corpusDir, labelsDir),
  });
  const reportJsonPath = path.join(outputDir, 'report.json');
  const reportMarkdownPath = path.join(outputDir, 'report.md');
  await writeJson(reportJsonPath, report);
  await fs.writeFile(reportMarkdownPath, renderBenchmarkMarkdown(report), 'utf8');

  return {
    reportJsonPath,
    reportMarkdownPath,
    perEntryDir,
    records: records.length,
    draft: report.draft,
  };
}

/** CLI entrypoint for run-benchmark.js. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const summary = await runBenchmark(parseArgs(argv));
  console.log(`Wrote ${summary.reportJsonPath}`);
  console.log(`Wrote ${summary.reportMarkdownPath}`);
  console.log(`Per-entry results: ${summary.perEntryDir}`);
  console.log(`Records: ${summary.records}`);
  if (summary.draft) console.log('DRAFT - insufficient n');
}

function harnessOptions(args: RunBenchmarkArgs): BatteryHarnessOptions {
  return {
    ...(args.testSpecDir !== undefined ? { testSpecDir: path.resolve(args.testSpecDir) } : {}),
  };
}

function onlyEnvError(result: BatteryResult): boolean {
  return Object.values(result.layers).every(layer => layer.status === 'env-error');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function reproducibility(corpusDir: string, labelsDir: string) {
  return {
    corpusDir,
    labelsDir,
    labelCommitHash: git(['rev-parse', 'HEAD']),
    batteryLibraryCommitHash: git(['rev-parse', 'HEAD']),
    labelsDirty: dirty(labelsDir),
    batteryLibraryDirty: dirty('src/verification') || dirty('benchmarks/falsification-corpus'),
  };
}

function dirty(targetPath: string): boolean {
  try {
    return git(['status', '--short', '--', targetPath]).trim().length > 0;
  } catch {
    return true;
  }
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseArgs(argv: string[]): RunBenchmarkArgs {
  let corpusDir: string | undefined;
  let labelsDir: string | undefined;
  let outputDir: string | undefined;
  let testSpecDir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--corpus') corpusDir = path.resolve(requireValue(argv, i += 1, arg));
    else if (arg === '--labels') labelsDir = path.resolve(requireValue(argv, i += 1, arg));
    else if (arg === '--output') outputDir = path.resolve(requireValue(argv, i += 1, arg));
    else if (arg === '--test-spec-dir') testSpecDir = path.resolve(requireValue(argv, i += 1, arg));
    else throw new Error(`run-benchmark [args]: unknown option ${arg ?? ''}`);
  }
  if (corpusDir === undefined || labelsDir === undefined || outputDir === undefined) {
    throw new Error('run-benchmark [args]: usage --corpus <dir> --labels <dir> --output <dir>');
  }
  return {
    corpusDir,
    labelsDir,
    outputDir,
    ...(testSpecDir !== undefined ? { testSpecDir } : {}),
  };
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`run-benchmark [args]: ${option} requires a value`);
  }
  return value;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
