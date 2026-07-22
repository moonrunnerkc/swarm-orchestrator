// Hunt 4 rematch runner. Runs the upgraded proof tier (the six restoration
// engines plus the hardened claim-differential) over the NOW proof-executable
// slice of the held-out wild-cheat corpus, reusing hunt3's proveEntry so the
// engine and the proven definition are byte-identical. The difference from Hunt 3
// is reach: the Phase 1 viability lift makes the Node proof-executable set the
// current-screen Node-viable entries (the census), which now includes
// outline/outline (the node-engine false-negative fixed in this run) on top of the
// six frozen entries.
//
// Pre-registered in `benchmarks/real-prs/hunt4/PREREGISTRATION.md`, committed
// before this instrument runs. The design is frozen; this does not tune on the
// corpus. Every one of these entries was diagnosed in Hunt 3, so results here are
// confirmatory-after-exploration and are recorded as the SECONDARY set; there is no
// primary (post-freeze folded) set yet because Phase 4 mining is token-gated.
//
// Checkpointed and resumable: each record lands in
// `benchmarks/real-prs/hunt4/records/<id>.json`; a re-run skips a completed record
// unless `--force`. Fetches route through unauthenticated public GitHub (the
// provided GITHUB_TOKEN is invalid, BASELINE.md); the runner unsets it.
//
// Usage (SWARM_EG_NODE_BIN must point at a Node 22 bin dir):
//   SWARM_EG_NODE_BIN=/path/to/node@22/bin \
//     node dist/scripts/real-prs/hunt4.js [--force] [--eg-wall-clock-ms 300000]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { loadWildCheatCorpus } from './lib/wild-cheat-corpus';
import { proveEntry, type FrozenTarget, type Hunt3Record } from './hunt3';

const log = getLogger('real-prs:hunt4');

const OUT_DIR = path.join('benchmarks', 'real-prs', 'hunt4');
const RECORDS_DIR = path.join(OUT_DIR, 'records');
const SUMMARY_FILE = path.join(OUT_DIR, 'hunt4-summary.json');
const CENSUS_FILE = path.join('benchmarks', 'real-prs', 'hunt3', 'viability-census.json');
const POPULATION_FILE = path.join('benchmarks', 'real-prs', 'hunt2', 'population.json');

interface CensusRow {
  id: string;
  ecosystem: string | null;
  viable: boolean;
}

/**
 * The proof-executable set: the entries the Node-only proof tier can actually run,
 * i.e. the current-screen Node-viable entries from the committed viability census.
 * This is where the Phase 1 lift shows up (outline flips in).
 *
 * @returns the set of proof-executable entry ids.
 */
function proofExecutableIds(): Set<string> {
  const census = JSON.parse(fs.readFileSync(CENSUS_FILE, 'utf8')) as { rows: CensusRow[] };
  return new Set(census.rows.filter((r) => r.ecosystem === 'node' && r.viable).map((r) => r.id));
}

function parseWallClock(argv: string[]): number {
  const i = argv.indexOf('--eg-wall-clock-ms');
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : 300000;
}

function writeRecord(r: Hunt3Record): void {
  fs.mkdirSync(RECORDS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RECORDS_DIR, `${r.id}.json`), `${JSON.stringify(r, null, 2)}\n`);
}

async function main(): Promise<void> {
  loadDotenv();
  // The provided GITHUB_TOKEN is invalid (401); unset it so every fetch and clone
  // routes through unauthenticated public access, as in Hunt 3.
  delete process.env.GITHUB_TOKEN;
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const egWallClockMs = parseWallClock(argv);

  const entries = loadWildCheatCorpus({ forEvaluation: true });
  const population = JSON.parse(fs.readFileSync(POPULATION_FILE, 'utf8')) as {
    population: { id: string; title?: string; body?: string }[];
  };
  const byId = new Map(population.population.map((p) => [p.id, p]));
  const ids = proofExecutableIds();
  const targets: FrozenTarget[] = entries
    .filter((e) => ids.has(e.id))
    .map((entry) => {
      const pop = byId.get(entry.id);
      return { entry, title: pop?.title ?? '', body: pop?.body ?? '' };
    });
  log.info(
    `hunt4: upgraded tier over ${targets.length} proof-executable held-out entries ` +
      `(all SECONDARY / diagnosed-then-retested; wall-clock ${egWallClockMs}ms/pr)`,
  );

  const records: Hunt3Record[] = [];
  for (const target of targets) {
    const recordPath = path.join(RECORDS_DIR, `${target.entry.id}.json`);
    if (!force && fs.existsSync(recordPath)) {
      log.info(`  ${target.entry.id}: already recorded, skipping (--force to rerun)`);
      records.push(JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Hunt3Record);
      continue;
    }
    log.info(`  ${target.entry.id}: proving...`);
    const record = await proveEntry(target, egWallClockMs);
    writeRecord(record);
    records.push(record);
    log.info(`  ${target.entry.id}: ${record.status} (claim: ${record.claimDifferential?.verdict ?? 'none'})`);
  }

  const proven = records.filter((r) => r.status === 'proven-block');
  const provisioned = records.filter((r) => r.status !== 'not-provisioned');
  const summary = {
    generatedBy: 'scripts/real-prs/hunt4.ts',
    proofExecutable: records.length,
    primaryCount: 0,
    secondaryCount: records.length,
    provisioned: provisioned.length,
    provenBlocks: proven.length,
    provenIds: proven.map((r) => r.id),
    byStatus: records.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {}),
    claimVerdicts: records.reduce<Record<string, number>>((acc, r) => {
      const v = r.claimDifferential?.verdict ?? 'none';
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {}),
    records: records.map((r) => ({ id: r.id, status: r.status, claimVerdict: r.claimDifferential?.verdict ?? null })),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  log.info(
    `hunt4: ${proven.length} proven of ${records.length} proof-executable ` +
      `(${provisioned.length} provisioned); wrote ${SUMMARY_FILE}`,
  );
  if (proven.length > 0) {
    log.warn(`STOP-THE-LINE: ${proven.length} proven block(s): replay in a fresh clone before recording proven`);
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
