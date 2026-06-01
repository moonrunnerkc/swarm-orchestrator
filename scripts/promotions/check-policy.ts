// CI guard: the committed promotion policy must equal a fresh recompute
// from the current scores snapshot. This is what stops a detector from
// being hand-promoted into the blocking gate without the measured
// precision to back it (the failure mode that put three zero-precision
// detectors back into the default set on an earlier branch). The policy
// is a pure function of the scores; if someone edits promotions.json by
// hand, or updates the scores without regenerating the policy, this
// fails and tells them to re-run compute-promotions.

import * as fs from 'fs';
import * as path from 'path';
import { computePromotions, type PromotionsOutput } from './compute-promotions';

interface Args {
  scoresFile: string;
  policyFile: string;
}

function parseArgs(argv: string[]): Args {
  let scoresFile = path.join('benchmarks', 'real-corpus', 'scores', 'latest.json');
  let policyFile = path.join('benchmarks', 'real-corpus', 'promotions.json');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--scores' && argv[i + 1] !== undefined) {
      scoresFile = argv[i + 1]!;
      i += 1;
    } else if (arg === '--policy' && argv[i + 1] !== undefined) {
      policyFile = argv[i + 1]!;
      i += 1;
    }
  }
  return { scoresFile, policyFile };
}

// Compares everything except the wall-clock `generatedAt`, which is
// expected to differ between the commit and the recompute.
function comparable(p: PromotionsOutput): Omit<PromotionsOutput, 'generatedAt'> {
  const { generatedAt: _ignored, ...rest } = p;
  void _ignored;
  return rest;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.policyFile)) {
    fail(`policy file not found: ${args.policyFile}. Run: npm run promotions`);
    return;
  }
  const committed = JSON.parse(fs.readFileSync(args.policyFile, 'utf8')) as PromotionsOutput;
  const fresh = computePromotions({
    scoresFile: args.scoresFile,
    out: args.policyFile,
    gatePrecision: committed.gatePrecisionThreshold,
    minTruePositive: committed.minTruePositiveForGate,
  });
  // Defense in depth on top of the recompute comparison: a judge-primary
  // category may carry block:true only with a per-consumer FP measurement
  // attached. A hand-edit that flips block without the measurement would
  // already fail the recompute below (the recompute reads no measurement
  // and so produces block:false), but we assert it explicitly so the
  // failure names the real problem instead of a generic policy mismatch.
  const jp = committed.judgePrimary;
  if (jp !== undefined) {
    for (const cat of jp.categories) {
      if (cat.block === true && cat.measurement === null) {
        fail(
          `judge-primary category "${cat.category}" is set to block without a per-consumer ` +
            'false-positive measurement on file. A judge-primary finding may gate only after ' +
            'the path is measured on the consumer\'s own merged-PR window within the FP bar ' +
            `(delta <= ${jp.maxFpDeltaPpForBlock}pp over baseline, window >= ` +
            `${jp.minWindowPrCountForBlock} PRs). Record the measurement and re-run: ` +
            'npm run promotions:compute.',
        );
        return;
      }
    }
  }
  const a = JSON.stringify(comparable(committed));
  const b = JSON.stringify(comparable(fresh));
  if (a !== b) {
    fail(
      'promotions.json is stale: it does not match a fresh recompute from ' +
        `${args.scoresFile}. Re-run: npm run promotions, and commit the result. ` +
        'A detector cannot be promoted into the gate without the scored ' +
        'precision to support it.',
    );
    return;
  }
  // eslint-disable-next-line no-console
  console.log(
    `check-policy: promotions.json matches the recompute from ${args.scoresFile} ` +
      `(gate-eligible=${fresh.gateEligibleDetectors.length}, ` +
      `advisory=${fresh.advisoryOnlyDetectors.length})`,
  );
}

function fail(message: string): void {
  // eslint-disable-next-line no-console
  console.error(`check-policy: ${message}`);
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
