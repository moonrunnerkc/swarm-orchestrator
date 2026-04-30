import { execFileSync } from 'child_process';
import * as path from 'path';
import { BROKEN_CATEGORIES } from '../label-rules';
import type { BrokenCategory } from '../schema';
import { runSyntheticCalibration } from '../synthetic/synthetic-calibration';

interface SyntheticCalibrationArgs {
  syntheticRoot: string;
  outputDir: string;
  categories?: BrokenCategory[];
  skipMutation?: boolean;
}

/** CLI entrypoint for synthetic adversarial layer calibration. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const summary = await runSyntheticCalibration({
    syntheticRoot: args.syntheticRoot,
    outputDir: args.outputDir,
    commitHash: gitHead(),
    ...(args.categories !== undefined ? { categories: args.categories } : {}),
    ...(args.skipMutation !== undefined ? { skipMutation: args.skipMutation } : {}),
  });
  console.log(`Wrote ${summary.reportJsonPath}`);
  console.log(`Wrote ${summary.reportMarkdownPath}`);
  console.log(`Records: ${summary.records}`);
  console.log(`Target misses: ${summary.misses.length}`);
}

function parseArgs(argv: string[]): SyntheticCalibrationArgs {
  let syntheticRoot = path.resolve('benchmarks/falsification-corpus/synthetic');
  let outputDir: string | undefined;
  const categories: BrokenCategory[] = [];
  let skipMutation: boolean | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--synthetic-root') syntheticRoot = path.resolve(requireValue(argv, i += 1, arg));
    else if (arg === '--output') outputDir = path.resolve(requireValue(argv, i += 1, arg));
    else if (arg === '--category') categories.push(...parseCategories(requireValue(argv, i += 1, arg)));
    else if (arg === '--skip-mutation') skipMutation = parseBoolean(requireValue(argv, i += 1, arg), arg);
    else throw new Error(`run-synthetic-calibration [args]: unknown option ${arg ?? ''}`);
  }
  if (outputDir === undefined) {
    throw new Error('run-synthetic-calibration [args]: usage --output <dir> [--synthetic-root <dir>]');
  }
  return {
    syntheticRoot,
    outputDir,
    ...(categories.length > 0 ? { categories } : {}),
    ...(skipMutation !== undefined ? { skipMutation } : {}),
  };
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`run-synthetic-calibration [args]: ${option} requires a value`);
  }
  return value;
}

function parseCategories(value: string): BrokenCategory[] {
  const allowed = new Set<string>(BROKEN_CATEGORIES);
  return value.split(',').map(category => category.trim()).filter(Boolean).map(category => {
    if (!allowed.has(category)) {
      throw new Error(`run-synthetic-calibration [args]: unknown category ${category}`);
    }
    return category as BrokenCategory;
  });
}

function parseBoolean(value: string, option: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`run-synthetic-calibration [args]: ${option} must be true or false`);
}

function gitHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
