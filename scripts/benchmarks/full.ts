// One command that regenerates the whole defect-injection oracle pipeline:
// build the corpus, score detector recall and judge-primary, measure
// tail-defect recovery, per-hunk localization, and evasion survival, then
// roll it all up into COVERAGE.md. Judge-backed steps replay from the
// committed cache, so a warm run is fast; a cold run makes live local
// calls. Pass --no-live to force cache-only.
//
// The judge environment is pinned by the committed manifest
// benchmarks/judge-env.json (provider, model, cache root). Ambient
// SWARM_JUDGE_* variables that conflict with the manifest abort the run
// unless --override-judge-env is passed, so committed artifacts always
// carry the canonical lineage unless the operator explicitly opts out.
//
// Usage: node dist/scripts/benchmarks/full.js [--no-live] [--override-judge-env]

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

export interface JudgeEnvManifest {
  provider: string;
  model: string;
  cacheRoot: string;
}

const MANIFEST_FILE = ['benchmarks', 'judge-env.json'];

/**
 * Load the committed canonical judge-environment manifest. Every field
 * is required; a missing or malformed manifest is an error because the
 * pipeline's committed artifacts are only reproducible under one
 * declared environment.
 */
export function loadJudgeEnvManifest(root: string): JudgeEnvManifest {
  const file = path.join(root, ...MANIFEST_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(
      `benchmarks/judge-env.json is missing. The benchmark pipeline requires the ` +
        `committed canonical judge environment (provider, model, cacheRoot); restore ` +
        `the file from git.`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<JudgeEnvManifest>;
  for (const field of ['provider', 'model', 'cacheRoot'] as const) {
    if (typeof parsed[field] !== 'string' || parsed[field] === '') {
      throw new Error(
        `benchmarks/judge-env.json: field "${field}" is missing or empty. ` +
          `Restore the manifest from git or fill in the canonical value.`,
      );
    }
  }
  return parsed as JudgeEnvManifest;
}

/**
 * Enforce the canonical judge environment: ambient SWARM_JUDGE_*
 * variables that conflict with the manifest abort the run unless the
 * operator passed --override-judge-env; otherwise the manifest values
 * are exported so every judge-backed step runs under the canonical
 * lineage. Returns the conflict descriptions (empty when canonical).
 */
export function applyCanonicalJudgeEnv(root: string, overrideFlag: boolean): string[] {
  const manifest = loadJudgeEnvManifest(root);
  const conflicts: string[] = [];
  const ambientProvider = process.env.SWARM_JUDGE_PROVIDER;
  const ambientModel = process.env.SWARM_JUDGE_MODEL;
  if (ambientProvider !== undefined && ambientProvider !== manifest.provider) {
    conflicts.push(`SWARM_JUDGE_PROVIDER=${ambientProvider} (manifest: ${manifest.provider})`);
  }
  if (ambientModel !== undefined && ambientModel !== manifest.model) {
    conflicts.push(`SWARM_JUDGE_MODEL=${ambientModel} (manifest: ${manifest.model})`);
  }
  if (conflicts.length > 0) {
    if (!overrideFlag) {
      throw new Error(
        `judge environment conflicts with the canonical manifest benchmarks/judge-env.json: ` +
          `${conflicts.join('; ')}. Unset the variables to run canonically, or pass ` +
          `--override-judge-env to knowingly produce non-canonical artifacts.`,
      );
    }
    return conflicts;
  }
  process.env.SWARM_JUDGE_PROVIDER = manifest.provider;
  process.env.SWARM_JUDGE_MODEL = manifest.model;
  return [];
}

export interface EvasionRobustness {
  /** Detection rate at the category's own max tested depth held at or
   *  above its depth-0 rate. */
  robust: boolean;
  /** The deepest evader stack this category was tested at. Categories
   *  are tested to different depths (behavioral evaders extend some),
   *  so robustness is judged per category, never at a global depth. */
  testedDepth: number;
}

// Returns, per category, whether its detection rate held flat from
// evasion depth 0 to that category's own max tested depth, plus the
// depth. A category with a gap in its depth rows is an error, not a
// default: a silently-missing row is how the robust column went stale.
export function loadEvasionRobust(root: string): Map<string, EvasionRobustness> {
  const file = path.join(root, 'benchmarks', 'oracle-corpus', 'evasion-data.csv');
  const out = new Map<string, EvasionRobustness>();
  if (!fs.existsSync(file)) return out;
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);
  const byCategory = new Map<string, Map<number, number>>();
  for (const l of lines) {
    const [category, depthStr, , , rate] = l.split(',');
    if (category === undefined || category === '' || depthStr === undefined || rate === undefined) {
      throw new Error(
        `evasion-data.csv: malformed row "${l}". ` +
          'Regenerate the file with npm run oracle:evasion.',
      );
    }
    const depth = Number(depthStr);
    const rateNum = Number(rate);
    if (!Number.isInteger(depth) || Number.isNaN(rateNum)) {
      throw new Error(
        `evasion-data.csv: non-numeric depth or rate in row "${l}". ` +
          'Regenerate the file with npm run oracle:evasion.',
      );
    }
    const depths = byCategory.get(category) ?? new Map<number, number>();
    depths.set(depth, rateNum);
    byCategory.set(category, depths);
  }
  for (const [category, depths] of byCategory) {
    const testedDepth = Math.max(...depths.keys());
    for (let d = 0; d <= testedDepth; d += 1) {
      if (!depths.has(d)) {
        throw new Error(
          `evasion-data.csv: category "${category}" is missing its depth-${d} row ` +
            `(tested depths 0..${testedDepth} must be contiguous). ` +
            'Regenerate the file with npm run oracle:evasion.',
        );
      }
    }
    const d0 = depths.get(0);
    const dMax = depths.get(testedDepth);
    if (d0 === undefined || dMax === undefined) {
      throw new Error(
        `evasion-data.csv: category "${category}" has no depth-0 or max-depth row. ` +
          'Regenerate the file with npm run oracle:evasion.',
      );
    }
    out.set(category, { robust: dMax >= d0 - 1e-9, testedDepth });
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
  lines.push(
    '| category | kind | injected | detection rate | tested evasion depth | survives cosmetic evasion |',
  );
  lines.push('|---|---|---|---|---|---|');
  for (const r of results.structural) {
    const evasion = robust.get(r.detector);
    lines.push(
      `| ${r.detector} | structural | ${r.injections} | ${r.recall.toFixed(2)} (detector) | ` +
        `${evasion === undefined ? 'n/a' : evasion.testedDepth} | ` +
        `${evasion === undefined ? 'n/a' : evasion.robust ? 'yes (robust)' : 'no'} |`,
    );
  }
  for (const r of results.semantic) {
    const evasion = robust.get(r.category);
    lines.push(
      `| ${r.category} | semantic | ${r.injections} | ${r.judgeRecall.toFixed(2)} (judge-primary) | ` +
        `${evasion === undefined ? 'n/a' : evasion.testedDepth} | n/a |`,
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
      'evader stack did not lower the detection rate at that category\'s own ' +
      'max tested depth (the tested-depth column; detail in evasion-report.md). ' +
      'Categories are tested to different depths, so robustness is judged per ' +
      'category.',
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
  const conflicts = applyCanonicalJudgeEnv(root, process.argv.includes('--override-judge-env'));
  if (conflicts.length > 0) {
    process.stdout.write(
      `benchmarks:full > WARNING: running under a non-canonical judge env ` +
        `(--override-judge-env): ${conflicts.join('; ')}. Do not commit the outputs.\n`,
    );
  }
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
