// One-shot sampler that lists raw entries still missing labels, runs
// the cheat detectors on each vendored diff, and emits a stratified
// batch to /tmp/sample-unlabeled.json. Unlike `sample-for-labeling.ts`,
// this script:
//   - skips entries already present under benchmarks/real-corpus/labels/
//   - skips the unconfirmed/ bucket (single-signal attribution)
//   - caps by a configurable per-bucket size (default 14) and total
//     budget (default 200) so the batch can grow the labeled set to a
//     target size in one pass.
//
// Not part of the production pipeline; lives here so it builds with the
// rest of the corpus tooling.

import * as fs from 'fs/promises';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { loadPrCorpus } from '../../benchmarks/real-corpus/loader';
import { findRepoRoot } from './repo-root';

interface SampleEntry {
  id: string;
  vendor: string;
  repository: string;
  prNumber: number;
  vendoredDiffPath: string;
  diffByteSize: number;
  detectorsFired: string[];
}

interface SampleOutput {
  generatedAt: string;
  totalUnlabeled: number;
  sampledEntries: SampleEntry[];
  bucketCounts: Record<string, number>;
  bucketTaken: Record<string, number>;
}

const PER_BUCKET_CAP = 70;
const TOTAL_BUDGET = 170;
const MAX_DIFF_BYTES = 200_000;
const OUTPUT_PATH = '/tmp/sample-unlabeled.json';

async function main(): Promise<void> {
  const repoRoot = findRepoRoot(__dirname);
  const rawDir = path.join(repoRoot, 'benchmarks', 'real-corpus', 'raw');
  const labelsDir = path.join(repoRoot, 'benchmarks', 'real-corpus', 'labels');
  const labeled = await listLabeledIds(labelsDir);
  const entries = await loadPrCorpus(rawDir);

  const candidates: SampleEntry[] = [];
  for (const entry of entries) {
    if (entry.vendoredDiffPath.startsWith('unconfirmed/')) continue;
    if (labeled.has(entry.id)) continue;
    const diffPath = path.join(rawDir, entry.vendoredDiffPath);
    let diff: string;
    try {
      diff = await fs.readFile(diffPath, 'utf8');
    } catch {
      continue;
    }
    if (diff.length > MAX_DIFF_BYTES) continue;
    if (diff.length === 0) continue;
    const result = await runCheatDetectors({ unifiedDiff: diff, repoRoot });
    const detectorsFired = unique(
      result.findings.filter((f) => f.severity === 'block').map((f) => f.category),
    );
    candidates.push({
      id: entry.id,
      vendor: entry.agent.vendor,
      repository: entry.pr.repository,
      prNumber: entry.pr.number,
      vendoredDiffPath: entry.vendoredDiffPath,
      diffByteSize: diff.length,
      detectorsFired,
    });
  }

  const buckets = new Map<string, SampleEntry[]>();
  for (const c of candidates) {
    const key = `${c.vendor}|${c.detectorsFired.length > 0 ? 'fired' : 'not-fired'}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(c);
    buckets.set(key, bucket);
  }
  for (const [key, bucket] of buckets.entries()) {
    bucket.sort((a, b) => a.id.localeCompare(b.id));
    buckets.set(key, bucket);
  }

  const bucketCounts: Record<string, number> = {};
  for (const [key, bucket] of buckets.entries()) bucketCounts[key] = bucket.length;

  const sampled: SampleEntry[] = [];
  const bucketTaken: Record<string, number> = {};
  const orderedKeys = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of orderedKeys) bucketTaken[key] = 0;

  let progress = true;
  while (sampled.length < TOTAL_BUDGET && progress) {
    progress = false;
    for (const key of orderedKeys) {
      if (sampled.length >= TOTAL_BUDGET) break;
      const bucket = buckets.get(key) ?? [];
      const taken = bucketTaken[key] ?? 0;
      if (taken >= PER_BUCKET_CAP) continue;
      if (taken >= bucket.length) continue;
      sampled.push(bucket[taken]!);
      bucketTaken[key] = taken + 1;
      progress = true;
    }
  }

  const out: SampleOutput = {
    generatedAt: new Date().toISOString(),
    totalUnlabeled: candidates.length,
    sampledEntries: sampled,
    bucketCounts,
    bucketTaken,
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `sample-unlabeled: ${sampled.length}/${TOTAL_BUDGET} sampled from ${candidates.length} unlabeled candidates ` +
      `(${orderedKeys.length} buckets) -> ${OUTPUT_PATH}\n`,
  );
}

async function listLabeledIds(labelsDir: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const entries = await fs.readdir(labelsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const m = entry.name.match(/^(.+)\.label\.json$/);
      if (m) out.add(m[1]!);
    }
  } catch {
    // missing dir = no labels yet
  }
  return out;
}

function unique<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs));
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`sample-unlabeled: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}
