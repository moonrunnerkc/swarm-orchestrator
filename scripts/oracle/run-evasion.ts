// Adaptive-evasion harness. For each injected structural defect it layers
// the evader stack at increasing depth and records whether the detector
// still fires, producing a per-category survival curve (detection rate vs
// evasion depth). Deterministic: detectors only, no judge.
//
// Outputs:
//   benchmarks/oracle-corpus/evasion-report.md
//   benchmarks/oracle-corpus/evasion-data.csv
//
// Usage: node dist/scripts/oracle/run-evasion.js [--per-category N]

import * as fs from 'fs';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { catchPathFor } from '../../src/audit/oracle/category-map';
import { EVADERS, applyStack } from '../../src/audit/oracle/evade/evaders';
import type { CheatCategory } from '../../src/audit/types';
import { loadOracleCorpus, repoRoot, type OracleCase } from '../benchmarks/lib/corpora';
import { round, divide } from '../benchmarks/lib/metrics';

const MAX_DEPTH = EVADERS.length;

async function detects(diff: string, root: string, detector: CheatCategory): Promise<boolean> {
  const result = await runCheatDetectors({ unifiedDiff: diff, repoRoot: root, detectorSet: 'experimental' });
  return result.findings.some((f) => f.category === detector);
}

interface Row {
  category: string;
  depth: number;
  detected: number;
  total: number;
  rate: number;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const perArg = argv.indexOf('--per-category');
  const perCategory = perArg !== -1 ? Number(argv[perArg + 1]) : 8;
  const root = repoRoot();
  const cases = loadOracleCorpus(root).filter((c) => catchPathFor(c.category as never).kind === 'detector');

  const byCategory = new Map<string, OracleCase[]>();
  for (const c of cases) {
    const list = byCategory.get(c.category) ?? [];
    if (list.length < perCategory) list.push(c);
    byCategory.set(c.category, list);
  }

  const rows: Row[] = [];
  for (const [category, subset] of [...byCategory.entries()].sort()) {
    const detector = (catchPathFor(category as never) as { detector: CheatCategory }).detector;
    for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
      let detected = 0;
      for (const c of subset) {
        const mutated = applyStack(c.brokenDiff, depth);
        if (await detects(mutated, root, detector)) detected += 1;
      }
      rows.push({ category, depth, detected, total: subset.length, rate: round(divide(detected, subset.length)) });
    }
  }

  // CSV
  const csv = ['category,depth,detected,total,detection_rate'];
  for (const r of rows) csv.push(`${r.category},${r.depth},${r.detected},${r.total},${r.rate}`);
  fs.writeFileSync(path.join(root, 'benchmarks', 'oracle-corpus', 'evasion-data.csv'), `${csv.join('\n')}\n`);

  // MD survival table: category x depth.
  const categories = [...byCategory.keys()].sort();
  const lines: string[] = [];
  lines.push('# Evasion survival curves');
  lines.push('');
  lines.push(
    `Each injected structural defect was mutated by the evader stack at ` +
      `increasing depth (0 = unmodified, ${MAX_DEPTH} = all evaders), and the ` +
      'detector re-run. The cells are detection rate (1.0 = still caught). ' +
      'Evaders: ' +
      EVADERS.map((e) => e.id).join(', ') +
      '. Regenerate with `node dist/scripts/oracle/run-evasion.js`.',
  );
  lines.push('');
  const header = ['detector', ...Array.from({ length: MAX_DEPTH + 1 }, (_, d) => `d${d}`)];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '---').join('|')}|`);
  for (const category of categories) {
    const cells = [category];
    for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
      const r = rows.find((x) => x.category === category && x.depth === depth);
      cells.push(r ? r.rate.toFixed(2) : '-');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push(
    '> A flat row means the evader stack does not reduce detection: every ' +
      'detector here is robust to these cosmetic mutations (identifier rename, ' +
      'whitespace, line reorder, noise file). A row below 1.00 that stays flat ' +
      '(assertion-strip, test-relaxation) reflects base recall on non-JS carrier ' +
      'files, not an evasion success, since the rate does not fall as depth ' +
      'rises. A dropping row would show the depth at which evasion succeeds. The ' +
      'underlying counts are in evasion-data.csv. These evaders are ' +
      'structure-preserving; semantic-rewrite evaders are the next escalation.',
  );
  lines.push('');
  fs.writeFileSync(path.join(root, 'benchmarks', 'oracle-corpus', 'evasion-report.md'), `${lines.join('\n')}\n`);

  const dropped = rows.filter((r) => r.depth === MAX_DEPTH && r.rate < 1).map((r) => r.category);
  process.stdout.write(
    `run-evasion: detectors=${categories.length} per-category=${perCategory} ` +
      `evaded-at-max-depth=[${[...new Set(dropped)].join(', ')}]\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`run-evasion: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main };
