// Write benchmarks/real-corpus/block-eligibility.json from the revert
// calibration. Separate from the advisory promotions.json: that file is the
// detector-versus-label precision policy, this one is the verifiable-evidence
// block policy, calibrated against whether PRs were reverted or hotfixed.
//
// Reads benchmarks/real-corpus/trigger-calibration.json (written by the
// calibration run). Until that run exists the calibration is treated as empty,
// so every trigger comes back not block-eligible with an honest reason, which
// is the correct state for an uncalibrated gate.

import * as fs from 'fs';
import * as path from 'path';
import { calibrateTriggers, type TriggerCalibration } from '../../src/audit/gate/calibrate-triggers';
import { computeBlockEligibility } from '../../src/audit/gate/block-eligibility';

interface CalibrationFile {
  generatedAt: string;
  rows: TriggerCalibration[];
}

interface Args {
  calibrationFile: string;
  out: string;
}

const UNCALIBRATED = '(uncalibrated: run npm run block-eligibility:calibrate)';

function parseArgs(argv: string[]): Args {
  let calibrationFile = path.join('benchmarks', 'real-corpus', 'trigger-calibration.json');
  let out = path.join('benchmarks', 'real-corpus', 'block-eligibility.json');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--calibration' && argv[i + 1] !== undefined) {
      calibrationFile = argv[i + 1]!;
      i += 1;
    } else if (arg === '--out' && argv[i + 1] !== undefined) {
      out = argv[i + 1]!;
      i += 1;
    }
  }
  return { calibrationFile, out };
}

/** Load the calibration rows from disk, or fall back to an all-zero calibration
 *  when the run has not happened yet (an uncalibrated, honestly-empty gate). */
export function loadCalibration(file: string): {
  calibrations: TriggerCalibration[];
  generatedAt: string;
} {
  if (!fs.existsSync(file)) {
    return { calibrations: calibrateTriggers([]), generatedAt: UNCALIBRATED };
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CalibrationFile;
  return { calibrations: parsed.rows, generatedAt: parsed.generatedAt };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { calibrations, generatedAt } = loadCalibration(args.calibrationFile);
  const core = computeBlockEligibility(calibrations, {
    computedBy: 'scripts/gate/compute-block-eligibility.ts',
    calibrationFile: args.calibrationFile,
    calibrationGeneratedAt: generatedAt,
  });
  const output = { generatedAt: new Date().toISOString(), ...core };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(
    `compute-block-eligibility: block-eligible=${core.blockEligibleCount} ` +
      `(${core.blockEligibleTriggers.join(', ') || 'none'}) out=${args.out}\n`,
  );
}

if (require.main === module) {
  main();
}
