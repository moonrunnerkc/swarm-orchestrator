// CI guard: the committed ground-truth reference must still carry the code
// floors (nobody hand-lowered the bar), and the live metrics recomputed from
// the current committed artifacts must sit at or above every floor. This is
// what stops the v12 upgrade from regressing oracle recall or real-corpus
// precision below the frozen baseline while shipping unrelated work. Mirrors
// scripts/promotions/check-policy.ts and scripts/gate/check-block-policy.ts.

import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateBaseline,
  GROUND_TRUTH_V12,
  readLiveMetrics,
  referenceMatchesConstants,
  type FrozenReference,
} from './ground-truth';

const REFERENCE = path.join('benchmarks', 'baselines', 'ground-truth-v12.json');

function fail(message: string): void {
  process.stderr.write(`check-ground-truth: ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  if (!fs.existsSync(REFERENCE)) {
    fail(`reference file not found: ${REFERENCE}. Run: npm run baseline:freeze`);
    return;
  }
  const ref = JSON.parse(fs.readFileSync(REFERENCE, 'utf8')) as FrozenReference;

  const mismatch = referenceMatchesConstants(ref);
  if (mismatch !== null) {
    fail(mismatch);
    return;
  }

  const live = readLiveMetrics();
  const result = evaluateBaseline(GROUND_TRUTH_V12, live);
  if (!result.pass) {
    for (const r of result.regressions) {
      process.stderr.write(
        `check-ground-truth: REGRESSION ${r.id}: live ${r.live} < floor ${r.floor} ` +
          `(${r.label}); read from ${r.source}\n`,
      );
    }
    fail(
      `${result.regressions.length} of ${result.checked} frozen floors regressed. A metric that ` +
        'genuinely dropped is not admissible; fix the change. Only if a floor was superseded by a ' +
        'better measurement do you re-freeze: npm run baseline:freeze, then raise the ' +
        'GROUND_TRUTH_V12 floors in scripts/baseline/ground-truth.ts.',
    );
    return;
  }

  const oracleTp = live.oracleStructuralTp + live.oracleSemanticJudgeTp;
  const oracleN = live.oracleStructuralInjections + live.oracleSemanticInjections;
  process.stdout.write(
    `check-ground-truth: all ${result.checked} floors held (oracle ${oracleTp}/${oracleN}, ` +
      `real-corpus precision ${live.realCorpusPrecisionPoint.toFixed(3)} ` +
      `[wilson-lower ${live.realCorpusPrecisionWilsonLower.toFixed(3)}], ` +
      `eg-viable ${live.egViableCount}/${live.egScreened})\n`,
  );
}

if (require.main === module) {
  main();
}
