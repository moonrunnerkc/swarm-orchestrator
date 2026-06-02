// Derive benchmarks/regression-corpus/stryker-viability.json from the real
// evidence-run outcomes. A repo is green when a mutation run completed on at
// least one of its PRs; otherwise it is red, tagged with the most common skip
// reason, unless a patch note in stryker-patches/<slug>.md marks it yellow.
// Viability is measured, never asserted.

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { regressionDir } from './lib/paths';

const log = getLogger('eg-viability');

interface EgResult {
  repo: string;
  mutationRuns: Array<{ ran: boolean; skipReason: string | null }>;
  coverageRuns: Array<{ ran: boolean; skipReason: string | null }>;
}

function commonReason(reasons: string[]): string {
  const counts = new Map<string, number>();
  for (const r of reasons) {
    // Collapse to a reason class so per-package noise does not fragment it.
    const key = r.replace(/\[[^\]]*\]/g, '').replace(/:.*/s, '').trim() || r.slice(0, 80);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
}

function main(): void {
  const base = path.join(regressionDir(), 'execution-grounded');
  const patchesDir = path.join(regressionDir(), 'stryker-patches');
  if (!fs.existsSync(base)) {
    log.error('no execution-grounded results found; run the evidence run first');
    process.exitCode = 1;
    return;
  }
  const viability: Record<string, { status: 'green' | 'yellow' | 'red'; prsEvaluated: number; prsRan: number; reason?: string }> = {};
  for (const slug of fs.readdirSync(base)) {
    const slugDir = path.join(base, slug);
    if (!fs.statSync(slugDir).isDirectory()) continue;
    let evaluated = 0;
    let ran = 0;
    const skipReasons: string[] = [];
    for (const prDir of fs.readdirSync(slugDir)) {
      const f = path.join(slugDir, prDir, 'result.json');
      if (!fs.existsSync(f)) continue;
      const r = JSON.parse(fs.readFileSync(f, 'utf8')) as EgResult;
      evaluated += 1;
      const didRun = r.mutationRuns.some((m) => m.ran) || r.coverageRuns.some((c) => c.ran);
      if (didRun) ran += 1;
      for (const m of r.mutationRuns) if (!m.ran && m.skipReason !== null) skipReasons.push(m.skipReason);
    }
    if (evaluated === 0) continue;
    const hasPatch = fs.existsSync(path.join(patchesDir, `${slug}.md`));
    let status: 'green' | 'yellow' | 'red';
    if (ran > 0) status = hasPatch ? 'yellow' : 'green';
    else status = hasPatch ? 'yellow' : 'red';
    viability[slug] = {
      status,
      prsEvaluated: evaluated,
      prsRan: ran,
      ...(ran === 0 && skipReasons.length > 0 ? { reason: commonReason(skipReasons) } : {}),
    };
  }
  const outFile = path.join(regressionDir(), 'stryker-viability.json');
  fs.writeFileSync(outFile, JSON.stringify(viability, null, 2) + '\n');
  const green = Object.values(viability).filter((v) => v.status === 'green').length;
  const yellow = Object.values(viability).filter((v) => v.status === 'yellow').length;
  const red = Object.values(viability).filter((v) => v.status === 'red').length;
  log.info(`viability: ${green} green, ${yellow} yellow, ${red} red -> ${outFile}`);
}

main();
