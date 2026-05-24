// One-shot sampler. Walks the raw corpus, runs the cheat detectors on
// every accepted entry's vendored diff, and emits a stratified sample
// to /tmp/sample-for-labeling.json: balanced across vendor and across
// "any-detector-fired" vs "no-detector-fired" buckets so the human (or
// AI-baseline) labeler covers all four confusion-matrix cells.
//
// Not part of the production pipeline. Lives under scripts/corpus/ so
// it builds with the rest of the corpus tooling.

import * as fs from 'fs/promises';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { loadPrCorpus } from '../../benchmarks/real-corpus/loader';
import { findRepoRoot } from './repo-root';
import type { UnlabeledPrCorpusEntry } from '../../benchmarks/real-corpus/schema';

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
  totalEntries: number;
  sampledEntries: SampleEntry[];
  bucketCounts: Record<string, number>;
}

const SAMPLE_PER_BUCKET = 4; // ~4 per (vendor × fired/not-fired) bucket
const MAX_DIFF_BYTES_FOR_LABELING = 200_000; // skip giant diffs from the sample
const OUTPUT_PATH = '/tmp/sample-for-labeling.json';

async function main(): Promise<void> {
  const repoRoot = findRepoRoot(__dirname);
  const rawDir = path.join(repoRoot, 'benchmarks', 'real-corpus', 'raw');
  const entries = await loadPrCorpus(rawDir);
  const candidates: SampleEntry[] = [];
  for (const entry of entries) {
    // Sample only from the accepted set; unconfirmed entries (under
    // raw/unconfirmed/<vendor>/) are out-of-scope for this pass.
    if (entry.vendoredDiffPath.startsWith('unconfirmed/')) continue;
    const diffPath = path.join(rawDir, entry.vendoredDiffPath);
    let diff: string;
    try {
      diff = await fs.readFile(diffPath, 'utf8');
    } catch {
      continue;
    }
    if (diff.length > MAX_DIFF_BYTES_FOR_LABELING) continue;
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
    const fired = c.detectorsFired.length > 0 ? 'fired' : 'not-fired';
    const key = `${c.vendor}|${fired}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(c);
    buckets.set(key, bucket);
  }

  const sampled: SampleEntry[] = [];
  const bucketCounts: Record<string, number> = {};
  for (const [key, bucket] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Sort each bucket by id for determinism, then take the first N.
    const sorted = [...bucket].sort((a, b) => a.id.localeCompare(b.id));
    const take = sorted.slice(0, SAMPLE_PER_BUCKET);
    sampled.push(...take);
    bucketCounts[key] = bucket.length;
  }

  const out: SampleOutput = {
    generatedAt: new Date().toISOString(),
    totalEntries: candidates.length,
    sampledEntries: sampled,
    bucketCounts,
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `sample-for-labeling: wrote ${sampled.length} entries from ${candidates.length} candidates (${Object.keys(bucketCounts).length} buckets) to ${OUTPUT_PATH}\n`,
  );
}

function unique<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs));
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`sample-for-labeling: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}
