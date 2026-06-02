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
  primaryProvider: 'anthropic' | 'local' | 'ollama';
  secondaryProvider: 'anthropic' | 'local' | 'ollama';
  primaryPrompt: string;
  secondaryPrompt: string;
}

function parseArgs(argv: string[]): Args {
  let slice = 60;
  let threshold = 0.75;
  let maxCostUsd = 25;
  let primaryProvider: 'anthropic' | 'local' | 'ollama' = 'local';
  let secondaryProvider: 'anthropic' | 'local' | 'ollama' = 'anthropic';
  let primaryPrompt = 'v2';
  let secondaryPrompt = 'v1';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--slice' && next !== undefined) (slice = Number(next)), (i += 1);
    else if (a === '--threshold' && next !== undefined) (threshold = Number(next)), (i += 1);
    else if (a === '--max-cost-usd' && next !== undefined) (maxCostUsd = Number(next)), (i += 1);
    else if (a === '--primary-provider' && (next === 'anthropic' || next === 'local' || next === 'ollama')) (primaryProvider = next), (i += 1);
    else if (a === '--secondary-provider' && (next === 'anthropic' || next === 'local' || next === 'ollama')) (secondaryProvider = next), (i += 1);
    else if (a === '--primary-prompt' && next !== undefined) (primaryPrompt = next), (i += 1);
    else if (a === '--secondary-prompt' && next !== undefined) (secondaryPrompt = next), (i += 1);
  }
  return { slice, threshold, maxCostUsd, primaryProvider, secondaryProvider, primaryPrompt, secondaryPrompt };
}

export interface DualSanity {
  ranAt: string;
  threshold: number;
  /** True when both arbiters are the same underlying model under two
   *  prompts (a prompt-robustness check), because no independent paid
   *  model was reachable. The report discloses this. */
  sameModel: boolean;
  primary: ArbiterSanity & { promptVersion: string };
  secondary: ArbiterSanity & { promptVersion: string };
  bothPass: boolean;
  lowerAgreement: number;
}

async function runOne(
  provider: 'anthropic' | 'local' | 'ollama',
  promptVersion: string,
  args: Args,
  perCategory: number,
): Promise<ArbiterSanity & { promptVersion: string }> {
  const s = await runArbiterSanity({
    provider,
    slice: args.slice,
    threshold: args.threshold,
    maxCostUsd: args.maxCostUsd,
    perCategory,
    promptVersion,
  });
  return { ...s, promptVersion };
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const perCategory = Math.max(1, Math.floor(args.slice / 12));

  const primary = await runOne(args.primaryProvider, args.primaryPrompt, args, perCategory);
  log.info(`primary arbiter (${primary.arbiterModel}/${args.primaryPrompt}) sanity: ${(primary.agreement * 100).toFixed(1)}% -> ${primary.passed ? 'PASS' : 'FAIL'}`);

  const secondary = await runOne(args.secondaryProvider, args.secondaryPrompt, args, perCategory);
  log.info(`secondary arbiter (${secondary.arbiterModel}/${args.secondaryPrompt}) sanity: ${(secondary.agreement * 100).toFixed(1)}% -> ${secondary.passed ? 'PASS' : 'FAIL'}`);

  const dual: DualSanity = {
    ranAt: new Date().toISOString(),
    threshold: args.threshold,
    sameModel: args.primaryProvider === args.secondaryProvider,
    primary,
    secondary,
    bothPass: primary.passed && secondary.passed,
    lowerAgreement: Math.min(primary.agreement, secondary.agreement),
  };
  fs.mkdirSync(realPrsDir(), { recursive: true });
  fs.writeFileSync(path.join(realPrsDir(), 'arbiter-sanity-dual.json'), JSON.stringify(dual, null, 2) + '\n');
  log.info(
    `dual sanity: primary ${(primary.agreement * 100).toFixed(1)}%, secondary ${(secondary.agreement * 100).toFixed(1)}%; ` +
      `lower ${(dual.lowerAgreement * 100).toFixed(1)}% (${dual.bothPass ? 'both pass' : 'see disclaimer'})`,
  );
  // Not a hard stop here: the report owns disclosure of a sub-threshold
  // arbiter. The dual labels are only trusted where both arbiters agree.
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
