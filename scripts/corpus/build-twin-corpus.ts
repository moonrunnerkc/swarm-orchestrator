// Build the semi-synthetic twin corpus: for each cheat category with an oracle
// injector, splice the defect into a presumed-clean survived PR (the cheat twin)
// and keep the untouched clean diff (the honest twin). The pair shares a PR, so a
// trigger that fires on the cheat twin but not the honest twin is discriminating
// the cheat from a legitimate change, not just recognizing a category.
//
// Semi-synthetic twins are NOT held out: they are injector-built for measurement,
// so downstream reports key on their `tier` field and never mix them with the
// held-out wild pairs. Deterministic given the committed clean corpus and the
// injector registry (both visited in id order).
//
// Usage: node dist/scripts/corpus/build-twin-corpus.js [--per-category 4]

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { runInjectors, type CleanPrInput } from '../../src/audit/oracle/inject/injection-runner';

const log = getLogger('corpus:build-twin-corpus');

const CORPUS_DIR = path.join('benchmarks', 'real-corpus');
const RAW_DIR = path.join(CORPUS_DIR, 'raw');
const OUTCOME_FILE = path.join(CORPUS_DIR, 'outcome-labels.json');
const OUT_DIR = path.join('benchmarks', 'twins', 'semi-synthetic');

interface RawPr {
  pr: { number?: number; title?: string; repository: string };
}

export interface TwinPair {
  tier: 'semi-synthetic' | 'wild-pair';
  category: string;
  injectorId?: string;
  prId: string;
  sourcePrUrl: string;
  cheatDiff: string;
  honestDiff: string;
  holdout: boolean;
}

function parsePerCategory(argv: string[]): number {
  const i = argv.indexOf('--per-category');
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : 4;
}

function findRaw(dir: string, name: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findRaw(full, name);
      if (hit !== null) return hit;
    } else if (e.name === name) {
      return full;
    }
  }
  return null;
}

/** Load the clean (survived) PRs as injector inputs, id-sorted for determinism. */
function loadCleanPrs(limit: number): CleanPrInput[] {
  const outcome = JSON.parse(fs.readFileSync(OUTCOME_FILE, 'utf8')) as { labels: { id: string; repo: string; outcome: string }[] };
  const survived = outcome.labels.filter((l) => l.outcome === 'survived').sort((a, b) => a.id.localeCompare(b.id));
  const prs: CleanPrInput[] = [];
  for (const label of survived) {
    if (prs.length >= limit) break;
    const jsonPath = findRaw(RAW_DIR, `${label.id}.json`);
    if (jsonPath === null) continue;
    const diffPath = path.join(path.dirname(jsonPath), `${label.id}.diff`);
    if (!fs.existsSync(diffPath)) continue;
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as RawPr;
    const cleanDiff = fs.readFileSync(diffPath, 'utf8');
    if (cleanDiff.trim().length === 0) continue;
    const prNum = raw.pr.number ?? Number.parseInt(label.id.split('-pr').pop() ?? '0', 10);
    prs.push({
      prId: label.id,
      sourcePrUrl: `https://github.com/${label.repo}/pull/${prNum}`,
      prTitle: raw.pr.title ?? '',
      cleanDiff,
    });
  }
  return prs;
}

function main(): void {
  const perCategory = parsePerCategory(process.argv.slice(2));
  // Draw from a bounded pool of clean PRs; the injectors pick their own carriers.
  const cleanPrs = loadCleanPrs(80);
  const byId = new Map(cleanPrs.map((p) => [p.prId, p]));
  log.info(`injecting into up to ${perCategory} clean PRs per category, from a pool of ${cleanPrs.length}`);

  const { cases, tallies } = runInjectors(cleanPrs, { perInjectorCap: perCategory });
  const pairs: TwinPair[] = cases.map((c) => ({
    tier: 'semi-synthetic',
    category: c.category,
    injectorId: c.injectorId,
    prId: c.prId,
    sourcePrUrl: c.label.sourcePrUrl,
    cheatDiff: c.brokenDiff,
    honestDiff: byId.get(c.prId)?.cleanDiff ?? '',
    holdout: false,
  }));

  const byCategory: Record<string, number> = {};
  for (const p of pairs) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;

  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/corpus/build-twin-corpus.ts',
    tier: 'semi-synthetic',
    note:
      'Injector-built cheat/honest twin pairs for the paired separation measurement. NOT held out ' +
      '(these are measurement fixtures, not human-caught cheats). Every downstream report keys on tier.',
    count: pairs.length,
    byCategory: Object.keys(byCategory).sort().reduce<Record<string, number>>((a, k) => ((a[k] = byCategory[k]!), a), {}),
    tallies,
    pairs,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'twins.json'), `${JSON.stringify(out, null, 2)}\n`);
  log.info(`wrote ${pairs.length} semi-synthetic twin pairs -> ${path.join(OUT_DIR, 'twins.json')}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}
