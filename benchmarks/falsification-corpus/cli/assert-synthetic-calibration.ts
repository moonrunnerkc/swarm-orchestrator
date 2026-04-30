import * as fs from 'fs';
import * as path from 'path';

interface Args {
  regularDir: string;
  underTestedDir: string;
}

interface EntryResult {
  entryId: string;
  broke: boolean;
  flagged: boolean;
}

interface SyntheticCalibrationRow {
  category: string;
  targetMisses: number;
  targetFalsePositives: number;
}

interface SyntheticReport {
  syntheticCalibration: SyntheticCalibrationRow[];
}

const EXPECTED_BROKEN = 21;
const EXPECTED_CLEAN = 21;

/** CLI assertion for the synthetic corpus contract used by CI. */
export function main(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const records = [
    ...readEntries(args.regularDir),
    ...readEntries(args.underTestedDir),
  ];
  const reports = [
    readReport(args.regularDir),
    readReport(args.underTestedDir),
  ];

  const broken = records.filter(record => record.entryId.endsWith('-broken'));
  const clean = records.filter(record => record.entryId.endsWith('-clean'));
  const caughtBroken = broken.filter(record => record.broke || record.flagged);
  const clearedClean = clean.filter(record => !record.broke && !record.flagged);
  const targetFalsePositives = reports.flatMap(report =>
    report.syntheticCalibration.filter(row => row.targetFalsePositives !== 0)
  );
  const targetMisses = reports.flatMap(report =>
    report.syntheticCalibration.filter(row => row.targetMisses !== 0)
  );

  const failures: string[] = [];
  if (caughtBroken.length !== EXPECTED_BROKEN || broken.length !== EXPECTED_BROKEN) {
    failures.push(`broken caught ${caughtBroken.length}/${broken.length}, expected ${EXPECTED_BROKEN}/${EXPECTED_BROKEN}`);
  }
  if (clearedClean.length !== EXPECTED_CLEAN || clean.length !== EXPECTED_CLEAN) {
    failures.push(`clean cleared ${clearedClean.length}/${clean.length}, expected ${EXPECTED_CLEAN}/${EXPECTED_CLEAN}`);
  }
  for (const row of targetMisses) {
    failures.push(`${row.category}: target misses ${row.targetMisses}`);
  }
  for (const row of targetFalsePositives) {
    failures.push(`${row.category}: target false positives ${row.targetFalsePositives}`);
  }

  if (failures.length > 0) {
    throw new Error(`synthetic calibration contract failed\n${failures.join('\n')}`);
  }

  console.log(`Synthetic calibration contract passed: broken caught ${caughtBroken.length}/${broken.length}; clean cleared ${clearedClean.length}/${clean.length}.`);
}

function parseArgs(argv: string[]): Args {
  let regularDir: string | undefined;
  let underTestedDir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--regular') regularDir = path.resolve(requireValue(argv, i += 1, arg));
    else if (arg === '--under-tested') underTestedDir = path.resolve(requireValue(argv, i += 1, arg));
    else throw new Error(`assert-synthetic-calibration [args]: unknown option ${arg ?? ''}`);
  }
  if (regularDir === undefined || underTestedDir === undefined) {
    throw new Error('assert-synthetic-calibration [args]: usage --regular <dir> --under-tested <dir>');
  }
  return { regularDir, underTestedDir };
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`assert-synthetic-calibration [args]: ${option} requires a value`);
  }
  return value;
}

function readEntries(outputDir: string): EntryResult[] {
  const perEntryDir = path.join(outputDir, 'per-entry');
  return fs.readdirSync(perEntryDir)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => JSON.parse(fs.readFileSync(path.join(perEntryDir, file), 'utf8')) as EntryResult);
}

function readReport(outputDir: string): SyntheticReport {
  return JSON.parse(fs.readFileSync(path.join(outputDir, 'report.json'), 'utf8')) as SyntheticReport;
}

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
