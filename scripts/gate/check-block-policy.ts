// CI guard for the verifiable-evidence block policy. The committed
// block-eligibility.json must equal a fresh recompute from the current
// calibration, must not sit below the fixed eligibility floor, and must not
// mark a trigger eligible that does not clear its own recorded bar. This is
// what stops a trigger from being hand-promoted into the block gate without the
// revert-calibrated precision to back it, and stops the threshold being quietly
// lowered to admit one. Mirrors scripts/promotions/check-policy.ts.

import * as fs from 'fs';
import * as path from 'path';
import {
  computeBlockEligibility,
  DEFAULT_MIN_CONFIRMED_REVERTED,
  DEFAULT_WILSON_LOWER_THRESHOLD,
  type BlockEligibilityCore,
} from '../../src/audit/gate/block-eligibility';
import { isSelfCertifying } from '../../src/audit/gate/self-certifying';
import { loadCalibration } from './compute-block-eligibility';

interface BlockEligibilityFile extends BlockEligibilityCore {
  generatedAt: string;
}

interface Args {
  policyFile: string;
}

function parseArgs(argv: string[]): Args {
  let policyFile = path.join('benchmarks', 'real-corpus', 'block-eligibility.json');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--policy' && argv[i + 1] !== undefined) {
      policyFile = argv[i + 1]!;
      i += 1;
    }
  }
  return { policyFile };
}

/** Everything except the wall-clock generatedAt, which is expected to differ
 *  between the commit and the recompute. */
function comparable(p: BlockEligibilityFile): BlockEligibilityCore {
  const { generatedAt: _ignored, ...rest } = p;
  void _ignored;
  return rest;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.policyFile)) {
    fail(`policy file not found: ${args.policyFile}. Run: npm run block-eligibility:compute`);
    return;
  }
  const committed = JSON.parse(fs.readFileSync(args.policyFile, 'utf8')) as BlockEligibilityFile;

  // The bar is fixed and never lowered to admit a trigger. A committed file
  // whose threshold sits below the floor is a tuned-down gate, rejected.
  if (committed.wilsonLowerThreshold < DEFAULT_WILSON_LOWER_THRESHOLD) {
    fail(
      `wilsonLowerThreshold ${committed.wilsonLowerThreshold} is below the fixed floor ` +
        `${DEFAULT_WILSON_LOWER_THRESHOLD}. The block bar is never lowered to admit a trigger.`,
    );
    return;
  }
  if (committed.minConfirmedRevertedForBlock < DEFAULT_MIN_CONFIRMED_REVERTED) {
    fail(
      `minConfirmedRevertedForBlock ${committed.minConfirmedRevertedForBlock} is below the fixed ` +
        `floor ${DEFAULT_MIN_CONFIRMED_REVERTED}. The block bar is never lowered to admit a trigger.`,
    );
    return;
  }

  // Defense in depth: a row marked eligible must clear its own recorded bar.
  // The recompute below would already catch a flipped flag, but this names the
  // real problem instead of a generic policy mismatch.
  for (const row of committed.rows) {
    if (isSelfCertifying(row.trigger)) {
      // Self-certifying triggers are eligible by tier (runtime per-instance
      // controlsAllGreen decides the actual block). We do not enforce the
      // Wilson/min bar for them here; the recompute already sets their
      // blockEligible based on the tier. Non-green control firings are refused
      // at the detect layer (and would be caught if we stored per-firing
      // control state in calibration).
      continue;
    }
    if (
      row.blockEligible &&
      (row.wilsonLowerBound < committed.wilsonLowerThreshold ||
        row.truePositive < committed.minConfirmedRevertedForBlock)
    ) {
      fail(
        `trigger "${row.trigger}" is marked block-eligible but does not clear the bar ` +
          `(Wilson95 lower ${row.wilsonLowerBound.toFixed(3)} vs ${committed.wilsonLowerThreshold}, ` +
          `${row.truePositive} confirmed reverted TP vs ${committed.minConfirmedRevertedForBlock}). ` +
          'Re-run: npm run block-eligibility:compute.',
      );
      return;
    }
  }

  const { calibrations, generatedAt } = loadCalibration(committed.calibrationFile);
  const fresh = computeBlockEligibility(calibrations, {
    computedBy: committed.computedBy,
    calibrationFile: committed.calibrationFile,
    calibrationGeneratedAt: generatedAt,
    wilsonLowerThreshold: committed.wilsonLowerThreshold,
    minConfirmedRevertedForBlock: committed.minConfirmedRevertedForBlock,
  });
  if (JSON.stringify(comparable(committed)) !== JSON.stringify(fresh)) {
    fail(
      `block-eligibility.json is stale: it does not match a fresh recompute from ` +
        `${committed.calibrationFile}. Re-run: npm run block-eligibility:compute, and commit the ` +
        'result. A trigger cannot be promoted into the gate without the revert-calibrated ' +
        'precision to support it.',
    );
    return;
  }
  process.stdout.write(
    `check-block-policy: block-eligibility.json matches the recompute ` +
      `(block-eligible=${fresh.blockEligibleCount})\n`,
  );
}

function fail(message: string): void {
  process.stderr.write(`check-block-policy: ${message}\n`);
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
