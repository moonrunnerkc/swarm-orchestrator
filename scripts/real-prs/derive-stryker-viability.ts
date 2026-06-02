// Derive benchmarks/regression-corpus/stryker-viability.json from the real
// evidence-run outcomes.
//
// Two viabilities are tracked, because they are different preconditions:
//   - mutationStatus: did Stryker complete on at least one PR (needs a green
//     baseline suite in the sandbox). This is the load-bearing number for the
//     report's mutation narrative.
//   - status: did ANY check (mutation OR coverage) run. The evidence runner
//     keys its red-repo skip off this, so a repo where coverage and issue-repro
//     still produce findings is not skipped just because Stryker could not run.
//
// A stryker-patches/<slug>.md note marks a repo yellow. Viability is measured,
// never asserted.

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
  const viability: Record<
    string,
    {
      status: 'green' | 'yellow' | 'red';
      mutationStatus: 'green' | 'yellow' | 'red';
      prsEvaluated: number;
      prsRan: number;
      prsMutationRan: number;
      reason?: string;
      mutationReason?: string;
    }
  > = {};
  for (const slug of fs.readdirSync(base)) {
    const slugDir = path.join(base, slug);
    if (!fs.statSync(slugDir).isDirectory()) continue;
    let evaluated = 0;
    let ran = 0;
    let mutationRan = 0;
    const skipReasons: string[] = [];
    for (const prDir of fs.readdirSync(slugDir)) {
      const f = path.join(slugDir, prDir, 'result.json');
      if (!fs.existsSync(f)) continue;
      const r = JSON.parse(fs.readFileSync(f, 'utf8')) as EgResult;
      evaluated += 1;
      const mutRan = r.mutationRuns.some((m) => m.ran);
      const anyRan = mutRan || r.coverageRuns.some((c) => c.ran);
      if (anyRan) ran += 1;
      if (mutRan) mutationRan += 1;
      for (const m of r.mutationRuns) if (!m.ran && m.skipReason !== null) skipReasons.push(m.skipReason);
    }
    if (evaluated === 0) continue;
    const hasPatch = fs.existsSync(path.join(patchesDir, `${slug}.md`));
    // status: did ANY check run (runner skip key). mutationStatus: did Stryker run.
    const status: 'green' | 'yellow' | 'red' = ran > 0 ? (hasPatch ? 'yellow' : 'green') : hasPatch ? 'yellow' : 'red';
    const mutationStatus: 'green' | 'yellow' | 'red' =
      mutationRan > 0 ? (hasPatch ? 'yellow' : 'green') : hasPatch ? 'yellow' : 'red';
    viability[slug] = {
      status,
      mutationStatus,
      prsEvaluated: evaluated,
      prsRan: ran,
      prsMutationRan: mutationRan,
      ...(ran === 0 && skipReasons.length > 0 ? { reason: commonReason(skipReasons) } : {}),
      ...(mutationRan === 0 && skipReasons.length > 0 ? { mutationReason: commonReason(skipReasons) } : {}),
    };
  }
  const outFile = path.join(regressionDir(), 'stryker-viability.json');
  fs.writeFileSync(outFile, JSON.stringify(viability, null, 2) + '\n');
  const green = Object.values(viability).filter((v) => v.status === 'green').length;
  const yellow = Object.values(viability).filter((v) => v.status === 'yellow').length;
  const red = Object.values(viability).filter((v) => v.status === 'red').length;
  const mutGreen = Object.values(viability).filter((v) => v.mutationStatus === 'green').length;
  log.info(
    `viability: ${green} green / ${yellow} yellow / ${red} red (any-check); ${mutGreen} mutation-green -> ${outFile}`,
  );
}

main();
