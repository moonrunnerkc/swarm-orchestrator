// Phase 1 viability census. For each of the 27 frozen wild-cheat entries, run
// the exact static EG-viability screen (screenPr, the same logic that produced
// the dataset's egViable flags) and record why the screen accepts or rejects it.
// The census is the roadmap for the provisioner work: it groups the non-viable
// entries by rejection reason so the largest categories can be provisioned
// biggest-first.
//
// Static and bounded: one GitHub contents listing per entry plus one package.json
// fetch when present, exactly as the screen does. No clone, no install. Runs
// unauthenticated (the corpus token 401s); public repos are reachable and the
// 27-entry pass stays under the 60/hour unauthenticated REST budget. Every result
// is cached per id so a re-run does not re-spend the budget.
//
// Usage:
//   node dist/scripts/real-prs/hunt3-viability-census.js [--refresh]

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import { getLogger } from '../../src/logger';
import { screenPr, type ViabilityRecord, type OctokitContents } from './eg-viability-screen';

const log = getLogger('real-prs:viability-census');

const DATASET_FILE = path.join(
  'benchmarks',
  'real-prs',
  'wild-cheat-corpus',
  'v1',
  'dataset.json',
);
const CACHE_DIR = path.join('benchmarks', 'real-prs', 'hunt3', 'viability-census-cache');
const OUT_JSON = path.join('benchmarks', 'real-prs', 'hunt3', 'viability-census.json');
const OUT_MD = path.join('benchmarks', 'real-prs', 'hunt3', 'VIABILITY-CENSUS.md');

interface WildEntry {
  id: string;
  repo: string;
  prNumber: number;
  headSha: string;
  complaintCategory: string;
  state: string;
  outcome: string;
  egViable: boolean;
}

interface WildDataset {
  entries: WildEntry[];
}

/** A census row: the screen record plus the frozen dataset facts it is measured against. */
export interface CensusRow extends ViabilityRecord {
  prNumber: number;
  state: string;
  complaintCategory: string;
  frozenEgViable: boolean;
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/**
 * Collapse a raw screen reason into a coarse census bucket so the report can
 * tally the largest categories. The buckets match the vocabulary Phase 1 asks
 * for (no lockfile, unsupported runner, unsupported language, missing manifest,
 * unreachable) plus the node-engine bucket the screen can produce.
 *
 * @param rec the screen record for one entry.
 * @returns a short bucket key; 'viable' when the screen accepts the entry.
 */
export function censusBucket(rec: ViabilityRecord): string {
  if (rec.viable) return 'viable';
  const reason = rec.reason;
  if (/unreadable|not a directory/.test(reason)) return 'unreachable-or-gone';
  if (/no package\.json/.test(reason)) {
    if (/Python project but no pytest signal/.test(reason)) return 'python-no-pytest-signal';
    return 'no-node-go-or-pytest-manifest';
  }
  const parts = reason.split(';').map((s) => s.trim());
  const buckets: string[] = [];
  if (parts.some((p) => p === 'no lockfile')) buckets.push('no-lockfile');
  if (parts.some((p) => p === 'no recognizable test runner')) buckets.push('no-runner');
  if (parts.some((p) => /node engine/.test(p))) buckets.push('node-engine-excludes-22');
  return buckets.length > 0 ? buckets.join('+') : 'other';
}

async function screenOne(
  octokit: OctokitContents,
  entry: WildEntry,
  refresh: boolean,
): Promise<CensusRow> {
  const cacheFile = path.join(CACHE_DIR, `${entry.id}.json`);
  if (!refresh) {
    const cached = readJson<CensusRow>(cacheFile);
    if (cached !== null) return cached;
  }
  const rec = await screenPr(octokit, {
    id: entry.id,
    repo: entry.repo,
    headSha: entry.headSha,
    outcome: entry.outcome,
  });
  const row: CensusRow = {
    ...rec,
    prNumber: entry.prNumber,
    state: entry.state,
    complaintCategory: entry.complaintCategory,
    frozenEgViable: entry.egViable,
  };
  writeJson(cacheFile, row);
  return row;
}

function renderMarkdown(rows: CensusRow[]): string {
  const nonViable = rows.filter((r) => !r.viable);
  const viable = rows.filter((r) => r.viable);
  // The proof tier (restoration engines + claim-differential) is Node-only: it
  // fail-closed abstains on a pytest or Go runner. So install-viability and
  // proof-executability are different counts, and the census must keep them
  // apart or it overstates the executable surface.
  const proofExecutable = viable.filter((r) => r.ecosystem === 'node');
  const installOnly = viable.filter((r) => r.ecosystem !== 'node');
  const byBucket: Record<string, CensusRow[]> = {};
  for (const r of nonViable) {
    const b = censusBucket(r);
    (byBucket[b] ??= []).push(r);
  }
  const bucketOrder = Object.entries(byBucket).sort((a, b) => b[1].length - a[1].length);

  const lines: string[] = [];
  lines.push('# Hunt 3 viability census: the executable surface of the 27 frozen wild entries');
  lines.push('');
  lines.push(
    'Per-entry output of the static EG-viability screen (`screenPr` in ' +
      '`scripts/real-prs/eg-viability-screen.ts`, the same logic that set the frozen ' +
      '`egViable` flags) run over the 27 frozen wild-cheat entries. This census is the ' +
      'roadmap for the provisioner work and is committed before any provisioner lands. ' +
      'Regenerate with `npm run viability-census` (reads the per-id cache; `--refresh` ' +
      're-queries GitHub).',
  );
  lines.push('');
  lines.push(
    'The screen ran unauthenticated (the corpus `GITHUB_TOKEN` 401s); every entry was ' +
      'reachable over public GitHub. A `not-eg-viable` verdict here is not a claim the ' +
      'PR is clean; it is the screen refusing to guess whether an unprovisionable tree ' +
      'runs. Making an entry viable means the sandbox genuinely provisions it, never ' +
      'relaxing the screen to wave it through.',
  );
  lines.push('');
  lines.push('## Two different counts, kept apart');
  lines.push('');
  lines.push(
    'The frozen dataset records `egViable: 6`. That 6 is the **proof-executable** ' +
      'count: the Node repos whose restoration and claim-differential tier can actually ' +
      'run. The current screen additionally accepts pytest and Go trees as ' +
      '**install-viable** (the frontier run wired their install path), but the proof ' +
      'tier fail-closed abstains on a non-Node runner, so those entries can be cloned ' +
      'and installed yet cannot be proven on. This census reports both so the lift is ' +
      'not overstated.',
  );
  lines.push('');
  lines.push('| surface | count | entries |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| proof-executable (Node tier runs) | ${proofExecutable.length} | ${proofExecutable.map((r) => `${r.repo}#${r.prNumber}`).join(', ') || '—'} |`,
  );
  lines.push(
    `| install-viable only (pytest/Go; proof tier abstains) | ${installOnly.length} | ${installOnly.map((r) => `${r.repo}#${r.prNumber} (${r.ecosystem})`).join(', ') || '—'} |`,
  );
  lines.push(`| not viable | ${nonViable.length} | see buckets below |`);
  lines.push('');
  lines.push(`## Non-viable buckets (${nonViable.length} entries)`);
  lines.push('');
  lines.push('| bucket | count | entries |');
  lines.push('| --- | --- | --- |');
  for (const [bucket, list] of bucketOrder) {
    lines.push(`| ${bucket} | ${list.length} | ${list.map((r) => `${r.repo}#${r.prNumber}`).join(', ')} |`);
  }
  lines.push('');
  lines.push('## Per-entry');
  lines.push('');
  lines.push('| repo#pr | category | frozen egViable | screen ecosystem | lockfile | runner | node engine | screen verdict | bucket |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(
      `| ${r.repo}#${r.prNumber} | ${r.complaintCategory} | ${r.frozenEgViable ? 'yes' : 'no'} | ` +
        `${r.ecosystem ?? '—'} | ${r.lockfile ?? '—'} | ${r.testRunner ?? '—'} | ${r.nodeEngine ?? '—'} | ` +
        `${r.viable ? 'VIABLE' : r.reason} | ${censusBucket(r)} |`,
    );
  }
  lines.push('');
  lines.push('## Roadmap read');
  lines.push('');
  lines.push(
    'The provisioner work targets the largest liftable buckets first. A bucket is ' +
      'liftable only when a real install can succeed against the actual checkout; the ' +
      'lift report (`VIABILITY-LIFT.md`) carries the command output for every entry that ' +
      'changes verdict. Buckets whose root cause is "the repo is gone" or "there is no ' +
      'test manifest at any layout" are recorded, not forced.',
  );
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh');
  const dataset = readJson<WildDataset>(DATASET_FILE);
  if (dataset === null) {
    throw new Error(`missing ${DATASET_FILE}; the frozen wild-cheat dataset must exist to census it`);
  }
  // Unauthenticated on purpose: the corpus token 401s and the screen only needs
  // public read access. new Octokit() with no auth sends no credential.
  const octokit = new Octokit() as unknown as OctokitContents;
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const rows: CensusRow[] = [];
  for (const entry of dataset.entries) {
    const row = await screenOne(octokit, entry, refresh);
    rows.push(row);
    log.info(`${entry.repo}#${entry.prNumber}: ${row.viable ? 'VIABLE' : censusBucket(row)} (${row.reason})`);
  }

  const buckets: Record<string, number> = {};
  for (const r of rows) buckets[censusBucket(r)] = (buckets[censusBucket(r)] ?? 0) + 1;
  writeJson(OUT_JSON, {
    computedBy: 'scripts/real-prs/hunt3-viability-census.ts',
    screenedBy: 'scripts/real-prs/eg-viability-screen.ts screenPr',
    entries: rows.length,
    viableCount: rows.filter((r) => r.viable).length,
    frozenEgViableCount: rows.filter((r) => r.frozenEgViable).length,
    bucketCounts: buckets,
    rows,
  });
  fs.writeFileSync(OUT_MD, renderMarkdown(rows));
  log.info(
    `census: ${rows.filter((r) => r.viable).length}/${rows.length} viable; wrote ${OUT_JSON} and ${OUT_MD}`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
