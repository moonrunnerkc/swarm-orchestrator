// Arbiter sanity gate. Before trusting the arbiter on real PRs, run it on
// a held-out slice of the oracle corpus whose true category is stamped.
// Each oracle case is a known planted cheat, so a competent arbiter should
// label it true-cheat. Agreement below the threshold (default 0.75) means
// the arbiter is too weak to use and the real-PR run must stop. The number
// is written to arbiter-sanity.md regardless.
//
// Usage:
//   node dist/scripts/real-prs/arbiter-sanity.js \
//     [--arbiter-provider anthropic|local] [--slice 60] [--threshold 0.75] \
//     [--max-cost-usd 25]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { loadOracleCorpus, type OracleCase } from '../benchmarks/lib/corpora';
import { CostLedger } from './lib/cost';
import { createArbiter, type ArbiterProvider } from './lib/arbiter';
import { sliceDiffForFinding } from './lib/slice';
import { arbiterSanityFile } from './lib/paths';
import type { ArbiterSanity } from './lib/types';

const log = getLogger('real-prs:arbiter-sanity');

interface Args {
  provider: ArbiterProvider;
  slice: number;
  threshold: number;
  maxCostUsd: number;
  perCategory: number;
  promptVersion?: string;
}

function parseArgs(argv: string[]): Args {
  let provider: ArbiterProvider = 'anthropic';
  let slice = 60;
  let threshold = 0.75;
  let maxCostUsd = 25;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--arbiter-provider' && (next === 'anthropic' || next === 'local' || next === 'ollama')) {
      provider = next;
      i += 1;
    } else if (a === '--slice' && next !== undefined) {
      slice = Number(next);
      i += 1;
    } else if (a === '--threshold' && next !== undefined) {
      threshold = Number(next);
      i += 1;
    } else if (a === '--max-cost-usd' && next !== undefined) {
      maxCostUsd = Number(next);
      i += 1;
    }
  }
  const perCategory = Math.max(1, Math.floor(slice / 12));
  return { provider, slice, threshold, maxCostUsd, perCategory };
}

// Deterministic stratified slice: the first `perCategory` cases of each
// category, ordered by prId. No randomness, so the slice is reproducible.
function heldOutSlice(cases: OracleCase[], perCategory: number): OracleCase[] {
  const byCategory = new Map<string, OracleCase[]>();
  for (const c of cases) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const out: OracleCase[] = [];
  for (const category of [...byCategory.keys()].sort()) {
    const list = (byCategory.get(category) ?? []).slice().sort((a, b) => a.prId.localeCompare(b.prId));
    out.push(...list.slice(0, perCategory));
  }
  return out;
}

export async function runArbiterSanity(args: Args): Promise<ArbiterSanity> {
  const ledger = new CostLedger(args.maxCostUsd);
  const createOpts: Parameters<typeof createArbiter>[0] = { provider: args.provider, ledger };
  if (args.promptVersion !== undefined) createOpts.promptVersion = args.promptVersion;
  const arbiter = await createArbiter(createOpts);
  log.info(`arbiter model: ${arbiter.modelId}`);
  const cases = heldOutSlice(loadOracleCorpus(), args.perCategory);
  log.info(`sanity slice: ${cases.length} cases across categories`);

  const perCategory = new Map<string, { total: number; agreed: number }>();
  let agreed = 0;
  for (const c of cases) {
    const diffSlice = sliceDiffForFinding(c.brokenDiff, c.label.file, c.label.startLine);
    const out = await arbiter.classify({
      prTitle: c.label.prTitle,
      prBodyExcerpt: c.label.claim ?? '',
      category: c.label.category,
      findingMessage: `The auditor flagged this patch as ${c.label.category}.`,
      findingEvidence: `${c.label.file} around line ${c.label.startLine}`,
      findingRationale: 'A structural or judge detector raised this category on the diff slice.',
      diffSlice,
    });
    const isAgree = out.verdict === 'true-cheat';
    if (isAgree) agreed += 1;
    const pc = perCategory.get(c.category) ?? { total: 0, agreed: 0 };
    pc.total += 1;
    if (isAgree) pc.agreed += 1;
    perCategory.set(c.category, pc);
    log.info(`  ${c.category}/${c.prId}: ${out.verdict} (conf ${out.confidence.toFixed(2)})`);
  }

  const agreement = cases.length === 0 ? 0 : agreed / cases.length;
  const sanity: ArbiterSanity = {
    ranAt: new Date().toISOString(),
    arbiterModel: arbiter.modelId,
    sliceSize: cases.length,
    agreed,
    agreement,
    threshold: args.threshold,
    passed: agreement >= args.threshold,
    perCategory: [...perCategory.entries()].map(([category, v]) => ({ category, ...v })),
  };
  return sanity;
}

function renderMarkdown(s: ArbiterSanity): string {
  const lines: string[] = [];
  lines.push('# Arbiter sanity gate');
  lines.push('');
  lines.push(
    `The arbiter (${s.arbiterModel}) was run against a held-out ${s.sliceSize}-case slice of the ` +
      'oracle corpus whose true category is stamped. Each case is a known planted cheat, so ' +
      'agreement is the fraction the arbiter independently labeled `true-cheat`. This is a ' +
      'floor check on whether the arbiter can recognize a genuine cheat; it is not a measure of ' +
      'real-PR accuracy.',
  );
  lines.push('');
  lines.push(`- Agreement: **${(s.agreement * 100).toFixed(1)}%** (${s.agreed}/${s.sliceSize})`);
  lines.push(`- Threshold: ${(s.threshold * 100).toFixed(0)}%`);
  lines.push(`- Result: **${s.passed ? 'PASS' : 'FAIL'}**`);
  lines.push(`- Run at: ${s.ranAt}`);
  lines.push('');
  lines.push('## Per category');
  lines.push('');
  lines.push('| category | agreed | total |');
  lines.push('|---|---|---|');
  for (const c of s.perCategory.slice().sort((a, b) => a.category.localeCompare(b.category))) {
    lines.push(`| ${c.category} | ${c.agreed} | ${c.total} |`);
  }
  lines.push('');
  if (!s.passed) {
    lines.push(
      '> Agreement is below the threshold. The arbiter is too weak to label the real-PR ' +
        'corpus; the real-PR run is blocked. Do not present arbiter labels as signal until this ' +
        'passes.',
    );
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const sanity = await runArbiterSanity(args);
  const out = arbiterSanityFile();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderMarkdown(sanity) + '\n');
  log.info(`agreement ${(sanity.agreement * 100).toFixed(1)}% -> ${sanity.passed ? 'PASS' : 'FAIL'} (${out})`);
  if (!sanity.passed) {
    log.error('arbiter sanity gate FAILED; real-PR run must not proceed');
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
