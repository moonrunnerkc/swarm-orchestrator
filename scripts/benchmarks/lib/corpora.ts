// Corpus loaders shared by the audit benchmark harnesses. Three corpora
// feed the audit benchmarks:
//
//   - synthetic: benchmarks/falsification-corpus/v10-synthetic-corpus,
//     paired broken/clean diffs with a category label per case.
//   - real: benchmarks/real-corpus, vendored AI-authored PR diffs with
//     hand labels (clean | broken | ambiguous + brokenCategories).
//   - oracle: benchmarks/oracle-corpus, constructively-injected defects
//     stamped with the injector that produced them (built in Phase 1).
//
// Each loader returns a flat list of cases so a scorer can iterate once
// and never has to know the on-disk layout.

import * as fs from 'fs';
import * as path from 'path';
import type { CheatCategory } from '../../../src/audit/types';
import type { PrCorpusEntry } from '../../../benchmarks/real-corpus/schema';
import { loadPrCorpus, loadLabeledPrEntries } from '../../../benchmarks/real-corpus/loader';

export interface SyntheticCase {
  id: string;
  category: CheatCategory;
  brokenDiff: string;
  cleanDiff: string;
}

export interface SyntheticCorpus {
  generatedAt: string;
  cases: SyntheticCase[];
}

interface SyntheticIndexEntry {
  id: string;
  category: CheatCategory;
  brokenPath: string;
  cleanPath: string;
}

interface SyntheticIndex {
  generatedAt: string;
  cases: SyntheticIndexEntry[];
}

export function repoRoot(): string {
  // scripts/benchmarks/lib -> repo root is three up from the source dir.
  // After compilation the file runs from dist/scripts/benchmarks/lib, so
  // walk up until a package.json is found rather than counting segments.
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('benchmarks: could not locate repo root from ' + __dirname);
}

const SYNTHETIC_ROOT = ['benchmarks', 'falsification-corpus', 'v10-synthetic-corpus'];

export function loadSyntheticCorpus(root = repoRoot()): SyntheticCorpus {
  const corpusRoot = path.join(root, ...SYNTHETIC_ROOT);
  const indexPath = path.join(corpusRoot, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as SyntheticIndex;
  const cases = index.cases.map((entry) => ({
    id: entry.id,
    category: entry.category,
    brokenDiff: fs.readFileSync(path.join(corpusRoot, entry.brokenPath), 'utf8'),
    cleanDiff: fs.readFileSync(path.join(corpusRoot, entry.cleanPath), 'utf8'),
  }));
  return { generatedAt: index.generatedAt, cases };
}

export interface RealCorpus {
  labeled: PrCorpusEntry[];
  unlabeledIds: string[];
}

export async function loadRealCorpus(root = repoRoot()): Promise<RealCorpus> {
  const rawDir = path.join(root, 'benchmarks', 'real-corpus', 'raw');
  const labelsDir = path.join(root, 'benchmarks', 'real-corpus', 'labels');
  const entries = await loadPrCorpus(rawDir);
  const loaded = await loadLabeledPrEntries(entries, labelsDir);
  return { labeled: loaded.labeled, unlabeledIds: loaded.unlabeledIds };
}

export function readRealDiff(entry: PrCorpusEntry, root = repoRoot()): string {
  const rawDir = path.join(root, 'benchmarks', 'real-corpus', 'raw');
  return fs.readFileSync(path.join(rawDir, entry.vendoredDiffPath), 'utf8');
}
