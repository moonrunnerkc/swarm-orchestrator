// CI guard: the committed corroborated-gate precision artifact must equal a
// fresh recompute from the two input artifacts, and it must never claim the
// gate is 'ready' on an unprovable denominator. This is the honesty backstop
// of the v12 measurement loop: it stops the corroborated structural gate from
// being hand-lit without the measured precision to back it, and it stops a
// 'ready' verdict on a slice with no outcome-bad PRs (undefined n) from ever
// landing on main.
//
// npm: corroborated-gate:check

import * as fs from 'fs';
import * as path from 'path';
import {
  computeCorroboratedGatePrecision,
  type CorroboratedGatePrecisionComparable,
} from './corroborated-gate-precision';

interface Args {
  corroboratedFile: string;
  viabilityFile: string;
  policyFile: string;
}

function parseArgs(argv: string[]): Args {
  let corroboratedFile = path.join('benchmarks', 'real-corpus', 'eg-viable-corroborated.json');
  let viabilityFile = path.join('benchmarks', 'real-corpus', 'eg-viability.json');
  let policyFile = path.join('benchmarks', 'real-corpus', 'corroborated-gate-precision.json');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--corroborated' && argv[i + 1] !== undefined) {
      corroboratedFile = argv[i + 1]!;
      i += 1;
    } else if (arg === '--viability' && argv[i + 1] !== undefined) {
      viabilityFile = argv[i + 1]!;
      i += 1;
    } else if (arg === '--policy' && argv[i + 1] !== undefined) {
      policyFile = argv[i + 1]!;
      i += 1;
    }
  }
  return { corroboratedFile, viabilityFile, policyFile };
}

function comparable(
  o: { generatedAt?: string } & CorroboratedGatePrecisionComparable,
): CorroboratedGatePrecisionComparable {
  const { generatedAt: _ignored, ...rest } = o;
  void _ignored;
  return rest;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.policyFile)) {
    fail(`policy file not found: ${args.policyFile}. Run: npm run corroborated-gate:measure`);
    return;
  }
  const committed = JSON.parse(fs.readFileSync(args.policyFile, 'utf8')) as {
    generatedAt?: string;
  } & CorroboratedGatePrecisionComparable;

  // Defense in depth on top of the recompute: a 'ready' verdict is only
  // admissible with a positive class and a Wilson lower bound at or above the
  // committed floor. A hand-edit to 'ready' on undefined n would already fail
  // the recompute, but we assert it explicitly so the failure names the real
  // problem: the gate cannot be lit on a denominator with no outcome-bad PRs.
  const agg = committed.aggregate;
  if (agg.status === 'ready') {
    if (committed.slice.outcomeBadInProvisionable === 0) {
      fail(
        'corroborated-gate is marked ready but the measured slice has no outcome-bad PR ' +
          '(n_bad=0). Readiness on undefined n is not admissible: the gate cannot be lit ' +
          'without a positive class. Re-run: npm run corroborated-gate:measure.',
      );
      return;
    }
    if (agg.wilson === null || agg.wilson.lower < committed.wilsonFloor) {
      fail(
        `corroborated-gate is marked ready but its Wilson-95 lower bound ` +
          `${agg.wilson === null ? 'is null' : agg.wilson.lower} is below the floor ` +
          `${committed.wilsonFloor}. Re-run: npm run corroborated-gate:measure.`,
      );
      return;
    }
  }

  const fresh = computeCorroboratedGatePrecision({
    corroboratedFile: args.corroboratedFile,
    viabilityFile: args.viabilityFile,
  });
  if (JSON.stringify(comparable(committed)) !== JSON.stringify(fresh)) {
    fail(
      'corroborated-gate-precision.json is stale: it does not match a fresh recompute from ' +
        `${args.corroboratedFile} and ${args.viabilityFile}. ` +
        'Re-run: npm run corroborated-gate:measure, and commit the result.',
    );
    return;
  }
  // eslint-disable-next-line no-console
  console.log(
    `check-corroborated-gate: corroborated-gate-precision.json matches the recompute ` +
      `(status=${fresh.aggregate.status}, n_bad=${fresh.slice.outcomeBadInProvisionable}, ` +
      `tp=${fresh.aggregate.truePositive}/${fresh.aggregate.trials})`,
  );
}

function fail(message: string): void {
  // eslint-disable-next-line no-console
  console.error(`check-corroborated-gate: ${message}`);
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
