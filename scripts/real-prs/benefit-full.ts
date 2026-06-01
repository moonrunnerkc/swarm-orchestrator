// One-command regeneration of the v11 benefit evaluation: mine the
// regression corpus, scale the clean corpus, audit both with the pre and
// post pipelines, run the differential analyzers, compute the Venn, run
// the dual-arbiter sanity gate and classification, total the cost, and
// render v11-BENEFIT-REPORT.md. Each stage is its own script so a partial
// re-run is cheap; pass --skip-fetch to reuse the committed corpora and
// only recompute downstream (the common replay path).
//
// Usage:
//   node dist/scripts/real-prs/benefit-full.js \
//     [--skip-fetch] [--no-pre] [--max-cost-usd 60] [--max-prs 260]

import { execFileSync } from 'child_process';
import * as path from 'path';
import { getLogger } from '../../src/logger';

const log = getLogger('real-prs:benefit-full');

interface Args {
  skipFetch: boolean;
  noPre: boolean;
  maxCostUsd: string;
  maxPrs: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { skipFetch: false, noPre: false, maxCostUsd: '60', maxPrs: '260' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--skip-fetch') args.skipFetch = true;
    else if (a === '--no-pre') args.noPre = true;
    else if (a === '--max-cost-usd' && next !== undefined) (args.maxCostUsd = next), (i += 1);
    else if (a === '--max-prs' && next !== undefined) (args.maxPrs = next), (i += 1);
  }
  return args;
}

function run(name: string, scriptArgs: string[]): void {
  log.info(`=== ${name} ${scriptArgs.join(' ')} ===`);
  execFileSync('node', [path.join(__dirname, `${name}.js`), ...scriptArgs], { stdio: 'inherit' });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.skipFetch) {
    run('mine-regressions', ['--window-months', '12', '--per-repo-floor', '3']);
    run('fetch-clean-v2', ['--per-repo', '25', '--max-prs', args.maxPrs]);
  } else {
    log.info('--skip-fetch: reusing the committed corpora');
  }
  run('write-corpus-docs', []);

  const auditArgs = ['--corpus', 'both'];
  if (args.noPre) auditArgs.push('--no-pre');
  run('run-audit-v2', auditArgs);

  run('run-differential', ['--corpus', 'both']);
  run('differential-venn', []);

  // Dual-arbiter: sanity gate for both arbiters, then classify. The gate
  // does not hard-stop here; the report owns disclosure of a weak arbiter.
  run('arbiter-sanity-dual', ['--threshold', '0.75', '--max-cost-usd', args.maxCostUsd]);
  // Stratified per-(corpus, category) cap keeps the paid arbiter measuring
  // a representative precision for every detector instead of draining the
  // budget on the highest-volume one. The report discloses the sampling.
  run('run-arbiter-dual', ['--corpus', 'both', '--per-category', '12', '--max-cost-usd', args.maxCostUsd]);

  run('build-cost-ledger', ['--ceiling', '150']);
  run('build-benefit-report', []);
  log.info('benefit evaluation complete; see benchmarks/real-prs/v11-BENEFIT-REPORT.md');
}

main();
