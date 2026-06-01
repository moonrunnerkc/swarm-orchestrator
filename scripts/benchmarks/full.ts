// One command that regenerates the whole defect-injection oracle pipeline:
// build the corpus, score detector recall and judge-primary, measure
// tail-defect recovery, per-hunk localization, and evasion survival, then
// roll it all up into COVERAGE.md. Judge-backed steps replay from the
// committed cache, so a warm run is fast; a cold run makes live local
// calls. Pass --no-live to force cache-only.
//
// Usage: node dist/scripts/benchmarks/full.js [--no-live]

import * as fs from 'fs';
import * as path from 'path';
import { main as buildCorpus } from '../oracle/build-corpus';
import { main as runOracle } from './run-oracle';
import { main as tailDefect } from '../oracle/tail-defect';
import { main as perHunk } from '../oracle/per-hunk';
import { main as runEvasion } from '../oracle/run-evasion';
import { repoRoot } from './lib/corpora';

interface OracleResults {
  structural: { detector: string; injections: number; recall: number }[];
  semantic: { category: string; injections: number; judgeRecall: number }[];
}

// Returns whether each detector's detection rate held flat from evasion
// depth 0 to max depth (robust to the cosmetic stack), comparing the same
// sample to itself rather than the full-corpus recall.
function loadEvasionRobust(root: string): Map<string, boolean> {
  const file = path.join(root, 'benchmarks', 'oracle-corpus', 'evasion-data.csv');
  const out = new Map<string, boolean>();
  if (!fs.existsSync(file)) return out;
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);
  let maxDepth = 0;
  for (const l of lines) maxDepth = Math.max(maxDepth, Number(l.split(',')[1]));
  const atDepth = new Map<string, { d0?: number; dMax?: number }>();
  for (const l of lines) {
    const [category, depthStr, , , rate] = l.split(',');
    const key = category ?? '';
    const entry = atDepth.get(key) ?? {};
    if (Number(depthStr) === 0) entry.d0 = Number(rate);
    if (Number(depthStr) === maxDepth) entry.dMax = Number(rate);
    atDepth.set(key, entry);
  }
  for (const [category, e] of atDepth) {
    out.set(category, (e.dMax ?? 0) >= (e.d0 ?? 0) - 1e-9);
  }
  return out;
}

function writeCoverage(root: string): void {
  const results = JSON.parse(
    fs.readFileSync(path.join(root, 'benchmarks', 'oracle-corpus', 'oracle-results.json'), 'utf8'),
  ) as OracleResults;
  const robust = loadEvasionRobust(root);
  const lines: string[] = [];
  lines.push('# Oracle coverage');
  lines.push('');
  lines.push(
    'One table, per category: how many defects were injected, the detection ' +
      'rate, and whether the cosmetic evader stack reduced it. Read this first; ' +
      'the per-artifact reports under benchmarks/oracle-corpus/ have the detail. ' +
      'Regenerate the whole thing with `npm run benchmarks:full`.',
  );
  lines.push('');
  lines.push('| category | kind | injected | detection rate | survives cosmetic evasion |');
  lines.push('|---|---|---|---|---|');
  for (const r of results.structural) {
    const isRobust = robust.get(r.detector);
    lines.push(
      `| ${r.detector} | structural | ${r.injections} | ${r.recall.toFixed(2)} (detector) | ` +
        `${isRobust === undefined ? 'n/a' : isRobust ? 'yes (robust)' : 'no'} |`,
    );
  }
  for (const r of results.semantic) {
    lines.push(
      `| ${r.category} | semantic | ${r.injections} | ${r.judgeRecall.toFixed(2)} (judge-primary) | n/a |`,
    );
  }
  lines.push('');
  lines.push('## How to read this');
  lines.push('');
  lines.push(
    '- **Structural** categories are caught by a deterministic detector; the ' +
      'rate is its recall on that injection class (any-severity).',
  );
  lines.push(
    '- **Semantic** categories have no structural tell; the rate is the ' +
      'judge-primary recall. Structural catch on these is 0 by construction.',
  );
  lines.push(
    '- **Survives cosmetic evasion** = the rename/whitespace/reorder/noise ' +
      'evader stack did not lower the detection rate (evasion-report.md).',
  );
  lines.push('');
  lines.push('## The honesty caveat');
  lines.push('');
  lines.push(
    'Injected recall proves detection of the defect classes we inject; it ' +
      'does not prove detection of unobserved defect classes. False-positive ' +
      'rate is measured against presumed-clean real PRs; the "presumed" is ' +
      'load-bearing. Both numbers are defensible, neither is overclaimed. See ' +
      'docs/audit/methodology.md.',
  );
  lines.push('');
  fs.writeFileSync(path.join(root, 'benchmarks', 'oracle-corpus', 'COVERAGE.md'), `${lines.join('\n')}\n`);
}

async function main(): Promise<void> {
  const live = process.argv.includes('--no-live') ? ['--no-live'] : [];
  const root = repoRoot();
  const steps: [string, () => Promise<void>][] = [
    ['oracle:build', () => buildCorpus([])],
    ['run-oracle', () => runOracle(live)],
    ['tail-defect', () => tailDefect(live)],
    ['per-hunk', () => perHunk(live)],
    ['run-evasion', () => runEvasion([])],
  ];
  for (const [name, fn] of steps) {
    process.stdout.write(`benchmarks:full > ${name}\n`);
    await fn();
  }
  writeCoverage(root);
  process.stdout.write('benchmarks:full > COVERAGE.md written\n');
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`benchmarks:full: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main };
