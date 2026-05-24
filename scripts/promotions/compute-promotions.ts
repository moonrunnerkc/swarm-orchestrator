// Compute the per-detector promotion record at
// `benchmarks/real-corpus/promotions.json` so the gate-eligible list is
// auditable.
//
// Reads the most recent real-corpus scores snapshot
// (`benchmarks/real-corpus/scores/latest.json` by default) and emits
// one row per detector with:
//
//   - the measured F1, precision, recall, firing count
//   - the proposed status: `gate-eligible` (F1 ≥ threshold),
//     `advisory-only` (fired but below threshold), or `unmeasured`
//     (did not fire on the sample)
//   - the threshold the gate decision was made against
//   - the corpus identifier the numbers came from
//
// Run this after the labels-v2 corpus is final and re-ran through the
// scorer; the downstream consumer is the gate-mode CLI and the
// README's "what gates today" table.

import * as fs from 'fs';
import * as path from 'path';

interface ScoresSnapshot {
  generatedAt: string;
  detectorVersions: Record<string, string>;
  perDetector: Array<{
    detector: string;
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    precision: number;
    recall: number;
    f1: number;
  }>;
}

export type PromotionStatus = 'gate-eligible' | 'advisory-only' | 'unmeasured';

export interface PromotionRow {
  detector: string;
  detectorVersion: string;
  status: PromotionStatus;
  f1: number;
  precision: number;
  recall: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  firingCount: number;
  reason: string;
}

export interface PromotionsOutput {
  generatedAt: string;
  computedBy: string;
  scoresFile: string;
  scoresGeneratedAt: string;
  f1GateThreshold: number;
  precisionFloorForAdvisory: number;
  rows: PromotionRow[];
  gateEligibleDetectors: string[];
  advisoryOnlyDetectors: string[];
  unmeasuredDetectors: string[];
}

interface Args {
  scoresFile: string;
  out: string;
  f1Threshold: number;
}

function parseArgs(argv: string[]): Args {
  let scoresFile = path.join('benchmarks', 'real-corpus', 'scores', 'latest.json');
  let out = path.join('benchmarks', 'real-corpus', 'promotions.json');
  let f1Threshold = 0.5;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--scores' && argv[i + 1] !== undefined) {
      scoresFile = argv[i + 1]!;
      i += 1;
    } else if (arg === '--out' && argv[i + 1] !== undefined) {
      out = argv[i + 1]!;
      i += 1;
    } else if (arg === '--threshold' && argv[i + 1] !== undefined) {
      f1Threshold = Number(argv[i + 1]);
      i += 1;
    }
  }
  return { scoresFile, out, f1Threshold };
}

export function computePromotions(args: Args): PromotionsOutput {
  const text = fs.readFileSync(args.scoresFile, 'utf8');
  const scores = JSON.parse(text) as ScoresSnapshot;
  const rows: PromotionRow[] = scores.perDetector.map((row) => {
    const firingCount = row.truePositive + row.falsePositive;
    if (firingCount === 0 && row.falseNegative === 0) {
      return {
        detector: row.detector,
        detectorVersion: scores.detectorVersions[row.detector] ?? 'unknown',
        status: 'unmeasured' as PromotionStatus,
        f1: row.f1,
        precision: row.precision,
        recall: row.recall,
        truePositive: row.truePositive,
        falsePositive: row.falsePositive,
        trueNegative: row.trueNegative,
        falseNegative: row.falseNegative,
        firingCount,
        reason: 'did not fire and no broken-labeled targets in the sample',
      };
    }
    if (row.f1 >= args.f1Threshold) {
      return {
        detector: row.detector,
        detectorVersion: scores.detectorVersions[row.detector] ?? 'unknown',
        status: 'gate-eligible' as PromotionStatus,
        f1: row.f1,
        precision: row.precision,
        recall: row.recall,
        truePositive: row.truePositive,
        falsePositive: row.falsePositive,
        trueNegative: row.trueNegative,
        falseNegative: row.falseNegative,
        firingCount,
        reason: `F1 ${row.f1.toFixed(3)} >= ${args.f1Threshold} threshold on ${args.scoresFile}`,
      };
    }
    return {
      detector: row.detector,
      detectorVersion: scores.detectorVersions[row.detector] ?? 'unknown',
      status: 'advisory-only' as PromotionStatus,
      f1: row.f1,
      precision: row.precision,
      recall: row.recall,
      truePositive: row.truePositive,
      falsePositive: row.falsePositive,
      trueNegative: row.trueNegative,
      falseNegative: row.falseNegative,
      firingCount,
      reason: `F1 ${row.f1.toFixed(3)} < ${args.f1Threshold} threshold on ${args.scoresFile}`,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/promotions/compute-promotions.ts',
    scoresFile: args.scoresFile,
    scoresGeneratedAt: scores.generatedAt,
    f1GateThreshold: args.f1Threshold,
    precisionFloorForAdvisory: 0,
    rows,
    gateEligibleDetectors: rows.filter((r) => r.status === 'gate-eligible').map((r) => r.detector),
    advisoryOnlyDetectors: rows.filter((r) => r.status === 'advisory-only').map((r) => r.detector),
    unmeasuredDetectors: rows.filter((r) => r.status === 'unmeasured').map((r) => r.detector),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = computePromotions(args);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2) + '\n');
  // eslint-disable-next-line no-console
  console.log(
    `compute-promotions: gate-eligible=${out.gateEligibleDetectors.length} ` +
      `advisory-only=${out.advisoryOnlyDetectors.length} ` +
      `unmeasured=${out.unmeasuredDetectors.length} ` +
      `out=${args.out}`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(2);
  });
}
