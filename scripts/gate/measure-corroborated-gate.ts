// Write benchmarks/real-corpus/corroborated-gate-precision.json: the measured
// readiness of the corroborated structural gate over the outcome-bad EG-viable
// slice. Deterministic given the two input artifacts (only generatedAt varies),
// so scripts/gate/check-corroborated-gate.ts can recompute and compare.
//
// npm: corroborated-gate:measure

import * as fs from 'fs';
import * as path from 'path';
import {
  computeCorroboratedGatePrecision,
  type CorroboratedGatePrecisionComparable,
} from './corroborated-gate-precision';
import { summarizeCorroboratedGate } from '../../src/audit/gate/corroborated-gate';

interface Args {
  corroboratedFile: string;
  viabilityFile: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  let corroboratedFile = path.join('benchmarks', 'real-corpus', 'eg-viable-corroborated.json');
  let viabilityFile = path.join('benchmarks', 'real-corpus', 'eg-viability.json');
  let out = path.join('benchmarks', 'real-corpus', 'corroborated-gate-precision.json');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--corroborated' && argv[i + 1] !== undefined) {
      corroboratedFile = argv[i + 1]!;
      i += 1;
    } else if (arg === '--viability' && argv[i + 1] !== undefined) {
      viabilityFile = argv[i + 1]!;
      i += 1;
    } else if (arg === '--out' && argv[i + 1] !== undefined) {
      out = argv[i + 1]!;
      i += 1;
    }
  }
  return { corroboratedFile, viabilityFile, out };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const comparable = computeCorroboratedGatePrecision({
    corroboratedFile: args.corroboratedFile,
    viabilityFile: args.viabilityFile,
  });
  const output: { generatedAt: string } & CorroboratedGatePrecisionComparable = {
    generatedAt: new Date().toISOString(),
    ...comparable,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(output, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(
    `measure-corroborated-gate: wrote ${args.out} — ${summarizeCorroboratedGate(comparable.aggregate)} ` +
      `(provisionable=${comparable.slice.provisionableCount}, n_bad=${comparable.slice.outcomeBadInProvisionable})`,
  );
}

if (require.main === module) {
  main();
}
