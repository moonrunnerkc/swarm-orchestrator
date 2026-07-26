// B2 corpus viability delta. Re-screen every wild-cheat corpus entry (v3's 29
// plus the v4 additions) through the static EG-viability screen, now carrying
// the subdirectory-manifest discovery mirror, and report per-stratum EG-viable
// counts before (the frozen egViable flags) and after. Read-only measurement:
// the frozen dataset is never rewritten; recall passes keep reporting the v3
// headline and the v4-additions slice separately per amendment 4.
//
// Usage:
//   node dist/scripts/real-prs/corpus-viability-delta.js [--refresh]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { makeOctokit, resolveGithubToken } from './lib/github';
import { screenPr, type OctokitContents, type ViabilityRecord } from './eg-viability-screen';

const log = getLogger('real-prs:corpus-viability-delta');

const DATASET = path.join('benchmarks', 'real-prs', 'wild-cheat-corpus', 'v4', 'dataset.json');
const OUT_DIR = path.join('benchmarks', 'real-prs', 'capability-hunt', 'b2-ab');
const CACHE_DIR = path.join(OUT_DIR, 'corpus-screen-cache');
const OUT_FILE = path.join(OUT_DIR, 'corpus-viability-delta.json');

interface CorpusEntry {
  id: string;
  repo: string;
  headSha: string;
  complaintBar?: string;
  egViable: boolean;
}

interface StratumDelta {
  entries: number;
  viableBefore: number;
  viableAfter: number;
  recoveredIds: string[];
  lostIds: string[];
}

async function main(): Promise<void> {
  loadDotenv();
  const refresh = process.argv.includes('--refresh');
  const octokit = makeOctokit(resolveGithubToken()) as unknown as OctokitContents;
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8')) as { entries: CorpusEntry[] };
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const rows: Array<{ entry: CorpusEntry; screen: ViabilityRecord }> = [];
  for (const entry of dataset.entries) {
    const cacheFile = path.join(CACHE_DIR, `${entry.id}.json`);
    let screen: ViabilityRecord | null = null;
    if (!refresh && fs.existsSync(cacheFile)) {
      screen = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as ViabilityRecord;
    }
    if (screen === null) {
      screen = await screenPr(octokit, {
        id: entry.id,
        repo: entry.repo,
        headSha: entry.headSha,
        outcome: 'corpus',
      });
      fs.writeFileSync(cacheFile, `${JSON.stringify(screen, null, 2)}\n`);
    }
    rows.push({ entry, screen });
    log.info(
      `${entry.id} [${entry.complaintBar ?? 'unstratified'}]: frozen=${entry.egViable} ` +
        `screen=${screen.viable}${screen.manifestDir !== undefined ? ` (subdir ${screen.manifestDir})` : ''}`,
    );
  }

  const strata: Record<string, StratumDelta> = {};
  for (const { entry, screen } of rows) {
    const key = entry.complaintBar ?? 'unstratified';
    const s = (strata[key] ??= { entries: 0, viableBefore: 0, viableAfter: 0, recoveredIds: [], lostIds: [] });
    s.entries += 1;
    if (entry.egViable) s.viableBefore += 1;
    if (screen.viable) s.viableAfter += 1;
    if (!entry.egViable && screen.viable) s.recoveredIds.push(entry.id);
    if (entry.egViable && !screen.viable) s.lostIds.push(entry.id);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/corpus-viability-delta.ts',
    dataset: DATASET,
    note:
      'Before = frozen egViable flags in the v4 dataset (intake-time screen, root-only). ' +
      'After = the same static screen with the B2 subdirectory-manifest discovery mirror. ' +
      'A subdir-viable result is an upper bound: the provisioner applies diff ownership per PR.',
    totals: {
      entries: rows.length,
      viableBefore: rows.filter((r) => r.entry.egViable).length,
      viableAfter: rows.filter((r) => r.screen.viable).length,
    },
    strata,
    records: rows.map(({ entry, screen }) => ({
      id: entry.id,
      complaintBar: entry.complaintBar ?? 'unstratified',
      viableBefore: entry.egViable,
      viableAfter: screen.viable,
      ...(screen.manifestDir !== undefined ? { manifestDir: screen.manifestDir } : {}),
      reason: screen.reason,
    })),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
  log.info(
    `corpus viability: ${out.totals.viableBefore} -> ${out.totals.viableAfter} of ${out.totals.entries}; wrote ${OUT_FILE}`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
