// One-command real-PR validation: fetch -> audit -> arbiter sanity gate
// -> arbiter -> sample -> report. The sanity gate is a hard stop: if the
// arbiter cannot recognize known oracle defects above the threshold, the
// run aborts before any real-PR classification, so a polluted report is
// never produced.
//
// Usage:
//   node dist/scripts/real-prs/full.js \
//     [--max-prs 100] [--arbiter-provider anthropic|local] \
//     [--max-cost-usd 25] [--no-pre] [--repos a/b,c/d] [--sanity-threshold 0.75]

import { execFileSync } from 'child_process';
import * as path from 'path';
import { getLogger } from '../../src/logger';

const log = getLogger('real-prs:full');

interface Args {
  maxPrs: string;
  arbiterProvider: string;
  maxCostUsd: string;
  noPre: boolean;
  repos: string | null;
  sanityThreshold: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    maxPrs: '100',
    arbiterProvider: 'anthropic',
    maxCostUsd: '25',
    noPre: false,
    repos: null,
    sanityThreshold: '0.75',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--max-prs' && next !== undefined) (args.maxPrs = next), (i += 1);
    else if (a === '--arbiter-provider' && next !== undefined) (args.arbiterProvider = next), (i += 1);
    else if (a === '--max-cost-usd' && next !== undefined) (args.maxCostUsd = next), (i += 1);
    else if (a === '--no-pre') args.noPre = true;
    else if (a === '--repos' && next !== undefined) (args.repos = next), (i += 1);
    else if (a === '--sanity-threshold' && next !== undefined) (args.sanityThreshold = next), (i += 1);
  }
  return args;
}

function scriptPath(name: string): string {
  return path.join(__dirname, `${name}.js`);
}

function run(name: string, scriptArgs: string[]): number {
  log.info(`=== ${name} ${scriptArgs.join(' ')} ===`);
  try {
    execFileSync('node', [scriptPath(name), ...scriptArgs], { stdio: 'inherit' });
    return 0;
  } catch (err) {
    const code = (err as { status?: number }).status ?? 1;
    return code;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const fetchArgs = ['--max-prs', args.maxPrs];
  if (args.repos !== null) fetchArgs.push('--repos', args.repos);
  if (run('fetch-prs', fetchArgs) !== 0) {
    log.error('fetch failed; stopping');
    process.exit(1);
  }

  const auditArgs: string[] = [];
  if (args.noPre) auditArgs.push('--no-pre');
  if (run('run-audit', auditArgs) !== 0) {
    log.error('audit failed; stopping');
    process.exit(1);
  }

  // Hard gate. A non-zero exit (2 = below threshold) stops the run.
  const sanityCode = run('arbiter-sanity', [
    '--arbiter-provider',
    args.arbiterProvider,
    '--threshold',
    args.sanityThreshold,
    '--max-cost-usd',
    args.maxCostUsd,
  ]);
  if (sanityCode !== 0) {
    log.error(
      'arbiter sanity gate did not pass; STOPPING before any real-PR classification. ' +
        'See benchmarks/real-prs/arbiter-sanity.md. No REAL-WORLD-REPORT.md is produced.',
    );
    process.exit(2);
  }

  if (run('run-arbiter', ['--arbiter-provider', args.arbiterProvider, '--max-cost-usd', args.maxCostUsd]) !== 0) {
    log.error('arbiter classification failed; stopping');
    process.exit(1);
  }

  run('sample-for-hand-review', []);
  run('build-report', []);
  log.info('real-PR validation complete; see benchmarks/real-prs/REAL-WORLD-REPORT.md');
}

main();
