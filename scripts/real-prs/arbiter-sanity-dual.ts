// Run the arbiter sanity gate for both arbiters (the local model and
// Opus) against the same held-out oracle slice, and write both numbers.
// The benefit report needs both: a finding is high-confidence only when
// both arbiters agree, so both must clear the floor, or the weaker one is
// explicitly disclaimed in the headline. The lower agreement is the gate
// the headline must own.
//
// Usage:
//   node dist/scripts/real-prs/arbiter-sanity-dual.js \
//     [--slice 60] [--threshold 0.75] [--max-cost-usd 25]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { runArbiterSanity } from './arbiter-sanity';
import { realPrsDir } from './lib/paths';
import type { ArbiterSanity } from './lib/types';

const log = getLogger('real-prs:arbiter-sanity-dual');

interface Args {
  slice: number;
  threshold: number;
  maxCostUsd: number;
}

function parseArgs(argv: string[]): Args {
  let slice = 60;
  let threshold = 0.75;
  let maxCostUsd = 25;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--slice' && next !== undefined) (slice = Number(next)), (i += 1);
    else if (a === '--threshold' && next !== undefined) (threshold = Number(next)), (i += 1);
    else if (a === '--max-cost-usd' && next !== undefined) (maxCostUsd = Number(next)), (i += 1);
  }
  return { slice, threshold, maxCostUsd };
}

export interface DualSanity {
  ranAt: string;
  threshold: number;
  local: ArbiterSanity;
  opus: ArbiterSanity;
  bothPass: boolean;
  lowerAgreement: number;
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const perCategory = Math.max(1, Math.floor(args.slice / 12));

  const local = await runArbiterSanity({
    provider: 'local',
    slice: args.slice,
    threshold: args.threshold,
    maxCostUsd: args.maxCostUsd,
    perCategory,
  });
  log.info(`local arbiter sanity: ${(local.agreement * 100).toFixed(1)}% -> ${local.passed ? 'PASS' : 'FAIL'}`);

  const opus = await runArbiterSanity({
    provider: 'anthropic',
    slice: args.slice,
    threshold: args.threshold,
    maxCostUsd: args.maxCostUsd,
    perCategory,
  });
  log.info(`opus arbiter sanity: ${(opus.agreement * 100).toFixed(1)}% -> ${opus.passed ? 'PASS' : 'FAIL'}`);

  const dual: DualSanity = {
    ranAt: new Date().toISOString(),
    threshold: args.threshold,
    local,
    opus,
    bothPass: local.passed && opus.passed,
    lowerAgreement: Math.min(local.agreement, opus.agreement),
  };
  fs.mkdirSync(realPrsDir(), { recursive: true });
  fs.writeFileSync(path.join(realPrsDir(), 'arbiter-sanity-dual.json'), JSON.stringify(dual, null, 2) + '\n');
  log.info(
    `dual sanity: local ${(local.agreement * 100).toFixed(1)}%, opus ${(opus.agreement * 100).toFixed(1)}%; ` +
      `lower ${(dual.lowerAgreement * 100).toFixed(1)}% (${dual.bothPass ? 'both pass' : 'see disclaimer'})`,
  );
  // Not a hard stop here: the report owns disclosure of a sub-threshold
  // arbiter. The dual labels are only trusted where both arbiters agree.
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
