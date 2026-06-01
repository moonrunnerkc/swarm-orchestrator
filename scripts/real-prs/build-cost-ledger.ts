// Aggregate every paid call this evaluation made into one cost ledger
// under the $150 ceiling. Two sources feed it: the audit's billable judge
// calls (Haiku, priced at the documented per-call estimate) and the dual
// arbiter's Opus spend (priced from recorded token counts). GitHub API is
// free and not counted. The ledger is written after every batch so the
// run can narrow scope if it approaches the cap.
//
// Usage:
//   node dist/scripts/real-prs/build-cost-ledger.js [--ceiling 150]

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { costLedgerFile, realPrsDir } from './lib/paths';
import type { CostSummary } from './lib/cost';

const log = getLogger('real-prs:cost-ledger');

// The per-call Haiku estimate from benchmarks/results/AB-REPORT.md /
// judge-calibration.md. Billable judge calls are priced at this rate; a
// cache hit is a free replay and not counted.
const HAIKU_PER_CALL_USD = 0.0045;

interface AuditCost {
  judgeModel: string;
  liveJudgeCalls: number;
  judgeCacheHits: number;
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function main(): void {
  let ceiling = 150;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--ceiling' && argv[i + 1] !== undefined) (ceiling = Number(argv[i + 1])), (i += 1);
  }

  const audit = readJson<AuditCost>(path.join(realPrsDir(), 'audit-cost.json'));
  const arbiter = readJson<CostSummary>(path.join(realPrsDir(), 'arbiter-dual-cost.json'));

  const batches: Array<{ batch: string; model: string; calls: number; usd: number; note: string }> = [];

  const judgeCalls = audit?.liveJudgeCalls ?? 0;
  const judgeUsd = judgeCalls * HAIKU_PER_CALL_USD;
  batches.push({
    batch: 'audit-judge',
    model: audit?.judgeModel ?? 'claude-haiku-4-5',
    calls: judgeCalls,
    usd: Number(judgeUsd.toFixed(4)),
    note: `${audit?.judgeCacheHits ?? 0} cache hits were free replays; live calls priced at $${HAIKU_PER_CALL_USD}/call`,
  });

  const opusUsd = arbiter?.spentUsd ?? 0;
  batches.push({
    batch: 'arbiter-opus',
    model: arbiter?.perModel?.find((m) => m.model.toLowerCase().includes('opus'))?.model ?? 'claude-opus',
    calls: arbiter?.calls ?? 0,
    usd: Number(opusUsd.toFixed(4)),
    note: 'priced from recorded input/output token counts; the local arbiter is free and not counted',
  });

  const total = Number((judgeUsd + opusUsd).toFixed(4));
  const ledger = {
    generatedAt: new Date().toISOString(),
    ceilingUsd: ceiling,
    totalUsd: total,
    underCeiling: total <= ceiling,
    githubApiUsd: 0,
    localArbiterUsd: 0,
    batches,
  };
  fs.writeFileSync(costLedgerFile(), JSON.stringify(ledger, null, 2) + '\n');
  log.info(`cost ledger: total $${total.toFixed(2)} of $${ceiling} ceiling (${ledger.underCeiling ? 'under' : 'OVER'})`);
  if (!ledger.underCeiling) {
    log.error('cost ceiling exceeded; narrow scope (fewer arbiter calls) before continuing');
    process.exit(1);
  }
}

main();
