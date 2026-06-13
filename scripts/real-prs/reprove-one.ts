// Targeted single-PR re-prove: replay the proof tier on one PR from a hunt2
// population with the current build. Used by stop-the-line to confirm a control
// fix turns a previously-proven false positive into an abstention, without
// re-running the whole proof tier. Prints the new verdict and rewrites that PR's
// record under benchmarks/real-prs/hunt2/records/.
//
// Usage:
//   SWARM_EG_NODE_BIN=/path/to/node@22/bin \
//   node dist/scripts/real-prs/reprove-one.js <pr-id>

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { proveOne, writeRecord, type HuntPr } from './lib/proof-tier';

const log = getLogger('real-prs:reprove-one');
const OUT_DIR = path.join('benchmarks', 'real-prs', 'hunt2');
const RECORDS_DIR = path.join(OUT_DIR, 'records');
const POPULATION_FILE = path.join(OUT_DIR, 'population.json');

interface PopFile {
  population: (HuntPr & { complaints?: unknown[]; candidateCategories?: string[]; merged?: boolean })[];
}

async function main(): Promise<void> {
  loadDotenv();
  const id = process.argv[2];
  if (id === undefined) throw new Error('usage: reprove-one <pr-id>');
  const pop = JSON.parse(fs.readFileSync(POPULATION_FILE, 'utf8')) as PopFile;
  const pr = pop.population.find((p) => p.id === id);
  if (pr === undefined) throw new Error(`pr id not found in population: ${id}`);
  log.info(`re-proving ${id} (${pr.repo}#${pr.prNumber}) with the current build`);
  const r = await proveOne(pr, { diffsBaseDir: OUT_DIR, egWallClockMs: 300_000 });
  const flags: string[] = [];
  if ((pr.complaints ?? []).length > 0) flags.push('complaint-flagged');
  if ((pr.candidateCategories ?? []).length > 0) flags.push(`candidate-flagged:${(pr.candidateCategories ?? []).join('|')}`);
  if (pr.merged === false) flags.push('closed-without-merge');
  r.flags = flags;
  writeRecord(RECORDS_DIR, r);
  log.info(`result: status=${r.status} proven=${r.provenTriggers.length} note=${r.note}`);
}

if (require.main === module) {
  main().catch((err) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
