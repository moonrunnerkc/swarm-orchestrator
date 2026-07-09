// Aggregate the hunt's logged verdicts (backfill + stream funnels) into promotion
// evidence (Stage 4). Reads every per-PR funnel the hunt wrote, tallies the gate
// triggers (the milestone catches), the advisory-finding firings, and the abstain
// reasons per engine, and emits benchmarks/real-corpus/hunt-verdict-evidence.json.
//
// The population is merged, never-flagged agent PRs, so a firing there is
// UNCONFIRMED until a maintainer confirms it against the FP protocol: this
// aggregation therefore reports confirmedMilestoneCatches = 0 and does NOT
// promote anything on its own. It is the "logged verdicts" end of the regeneration
// cycle; a maintainer folds a confirmed catch into promotion-measurements.json,
// which compute-promotions reads to move an advisory tier toward gate-eligible
// (symmetric with the Stage 0 FP-driven auto-demotion). Deterministic and offline.
//
// Usage: node dist/scripts/promotions/aggregate-hunt-verdicts.js [--records <dir>] [--out <file>]

import * as fs from 'fs';
import * as path from 'path';
import { SELF_CERTIFYING_TRIGGERS } from '../../src/audit/gate/self-certifying';

interface Funnel {
  ref: string;
  agent: string;
  status: 'audited' | 'timeout' | 'error';
  pass: boolean | null;
  gateTriggers: string[];
  advisoryFindings: Array<{ category: string; severity: string }>;
  provisioning: { attempted: boolean; provisioned: boolean } | null;
  disputed: number;
  abstainVerdicts: string[];
}

interface Args {
  recordsDir: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
  };
  return {
    recordsDir: get('--records', path.join('benchmarks', 'real-prs', 'capability-hunt', 'records')),
    out: get('--out', path.join('benchmarks', 'real-corpus', 'hunt-verdict-evidence.json')),
  };
}

const GATE_TRIGGERS = new Set<string>(SELF_CERTIFYING_TRIGGERS as readonly string[]);

export interface HuntEvidence {
  computedBy: string;
  recordsDir: string;
  prsAudited: number;
  provisioned: number;
  timeouts: number;
  errors: number;
  /** Milestone catches: a proven, all-controls-green self-certifying gate trigger,
   *  before maintainer confirmation. The number the hunt is really after. */
  gateTriggerFirings: Record<string, number>;
  /** Confirmed milestone catches: 0 until a maintainer confirms a candidate
   *  against the FP protocol. This aggregation never confirms one itself. */
  confirmedMilestoneCatches: number;
  /** Advisory-finding firings by category:severity, counted separately from gate
   *  triggers. These are the denominator a promotion measurement is folded from. */
  advisoryFindingFirings: Record<string, number>;
  disputedCount: number;
  abstainReasons: Record<string, number>;
}

/**
 * Pure: aggregate the hunt funnels into promotion evidence. Separated from the IO
 * so it is unit-tested against a synthetic funnel set.
 *
 * @param funnels every per-PR funnel the hunt recorded.
 * @param recordsDir the directory they came from (for provenance).
 * @returns the accumulated evidence; confirmedMilestoneCatches is always 0 here.
 */
export function aggregateHuntEvidence(funnels: readonly Funnel[], recordsDir: string): HuntEvidence {
  const gateTriggerFirings: Record<string, number> = {};
  const advisoryFindingFirings: Record<string, number> = {};
  const abstainReasons: Record<string, number> = {};
  let provisioned = 0;
  let timeouts = 0;
  let errors = 0;
  let disputedCount = 0;
  for (const f of funnels) {
    if (f.status === 'timeout') timeouts += 1;
    if (f.status === 'error') errors += 1;
    if (f.provisioning?.provisioned) provisioned += 1;
    for (const t of f.gateTriggers) {
      if (GATE_TRIGGERS.has(t)) gateTriggerFirings[t] = (gateTriggerFirings[t] ?? 0) + 1;
    }
    for (const a of f.advisoryFindings) {
      const key = `${a.category}:${a.severity}`;
      advisoryFindingFirings[key] = (advisoryFindingFirings[key] ?? 0) + 1;
    }
    disputedCount += f.disputed ?? 0;
    for (const v of f.abstainVerdicts ?? []) abstainReasons[v] = (abstainReasons[v] ?? 0) + 1;
  }
  return {
    computedBy: 'scripts/promotions/aggregate-hunt-verdicts.ts',
    recordsDir,
    prsAudited: funnels.length,
    provisioned,
    timeouts,
    errors,
    gateTriggerFirings,
    confirmedMilestoneCatches: 0,
    advisoryFindingFirings,
    disputedCount,
    abstainReasons,
  };
}

function loadFunnels(dir: string): Funnel[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Funnel);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const funnels = loadFunnels(args.recordsDir);
  const evidence = aggregateHuntEvidence(funnels, args.recordsDir);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(evidence, null, 2)}\n`);
  // eslint-disable-next-line no-console
  process.stdout.write(
    `aggregate-hunt-verdicts: ${evidence.prsAudited} PRs, provisioned ${evidence.provisioned}, ` +
      `gate-trigger firings ${Object.values(evidence.gateTriggerFirings).reduce((a, b) => a + b, 0)}, ` +
      `confirmed milestone catches ${evidence.confirmedMilestoneCatches}, ` +
      `advisory firing kinds ${Object.keys(evidence.advisoryFindingFirings).length}. Wrote ${args.out}\n`,
  );
}

if (require.main === module) {
  main();
}
