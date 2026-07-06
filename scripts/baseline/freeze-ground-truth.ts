// Regenerate the committed ground-truth reference from the current artifacts.
// Run after a measured improvement, then raise the GROUND_TRUTH_V12 floors in
// scripts/baseline/ground-truth.ts to match. Never run this to paper over a
// regression: the whole point of the reference is that the bar only moves up.

import * as fs from 'fs';
import * as path from 'path';
import { buildFrozenReference, DEFAULT_SOURCES, readLiveMetrics } from './ground-truth';

const OUT = path.join('benchmarks', 'baselines', 'ground-truth-v12.json');

function main(): void {
  const live = readLiveMetrics();
  const ref = buildFrozenReference(live, DEFAULT_SOURCES, new Date().toISOString());
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(ref, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `freeze-ground-truth: wrote ${OUT} (${ref.floors.length} floors; oracle ` +
      `${live.oracleStructuralTp + live.oracleSemanticJudgeTp}/` +
      `${live.oracleStructuralInjections + live.oracleSemanticInjections}, real-corpus precision ` +
      `${live.realCorpusPrecisionPoint.toFixed(3)}, eg-viable ${live.egViableCount}/${live.egScreened})\n`,
  );
}

if (require.main === module) {
  main();
}
