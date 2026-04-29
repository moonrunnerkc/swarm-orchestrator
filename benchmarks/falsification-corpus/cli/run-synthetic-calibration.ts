import { execFileSync } from 'child_process';
import * as path from 'path';
import { runSyntheticCalibration } from '../synthetic/synthetic-calibration';

interface SyntheticCalibrationArgs {
  syntheticRoot: string;
  outputDir: string;
}

/** CLI entrypoint for synthetic adversarial layer calibration. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const summary = await runSyntheticCalibration({
    syntheticRoot: args.syntheticRoot,
    outputDir: args.outputDir,
    commitHash: gitHead(),
  });
  console.log(`Wrote ${summary.reportJsonPath}`);
  console.log(`Wrote ${summary.reportMarkdownPath}`);
  console.log(`Records: ${summary.records}`);
  console.log(`Target misses: ${summary.misses.length}`);
}

function parseArgs(argv: string[]): SyntheticCalibrationArgs {
  let syntheticRoot = path.resolve('benchmarks/falsification-corpus/synthetic');
  let outputDir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--synthetic-root') syntheticRoot = path.resolve(requireValue(argv, i += 1, arg));
    else if (arg === '--output') outputDir = path.resolve(requireValue(argv, i += 1, arg));
    else throw new Error(`run-synthetic-calibration [args]: unknown option ${arg ?? ''}`);
  }
  if (outputDir === undefined) {
    throw new Error('run-synthetic-calibration [args]: usage --output <dir> [--synthetic-root <dir>]');
  }
  return { syntheticRoot, outputDir };
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`run-synthetic-calibration [args]: ${option} requires a value`);
  }
  return value;
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
