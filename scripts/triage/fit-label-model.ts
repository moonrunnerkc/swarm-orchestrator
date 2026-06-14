// Phase 3 (part B): fit the weak-supervision label model. Reads the
// labeling-function vote matrix from triage-features.json, fits the binary
// Dawid-Skene label model by EM (no ground truth), and writes label-model.json
// with the learned per-function accuracies and the per-instance cheat
// probability. The accuracies are learned, not hand-tuned: the report shows
// each function's accCheat, accClean, and coverage so the weighting is legible.
//
// Usage: node dist/scripts/triage/fit-label-model.js

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { fitLabelModel, type Vote } from '../../src/audit/triage/label-model';
import { repoRoot } from '../real-prs/lib/paths';
import { triageDir } from './lib/triage-io';

const log = getLogger('triage:label-model');

interface FeaturesFile {
  lfNames: string[];
  instances: Array<{ id: string; votes: number[] }>;
}

function main(): void {
  const root = repoRoot();
  const featuresFile = path.join(triageDir(root), 'triage-features.json');
  const features = JSON.parse(fs.readFileSync(featuresFile, 'utf8')) as FeaturesFile;

  const matrix: Vote[][] = features.instances.map((r) => r.votes as Vote[]);
  // Anchor the EM on the judge: it is the one bidirectional labeling function
  // (votes both +1 and -1), so initializing the soft labels from it breaks the
  // degenerate all-positive fixed point the one-sided detectors would induce.
  const judgeColumn = features.lfNames.indexOf('judge');
  const fit = fitLabelModel(matrix, features.lfNames.length, {
    ...(judgeColumn >= 0 ? { anchorColumn: judgeColumn } : {}),
    // Fix the class balance at the neutral 0.5 so the bistable EM cannot run
    // the prior to 0 or 1; the per-function accuracies are still learned, and
    // the conformal wrapper sets the real operating point downstream.
    classBalance: 0.5,
  });

  const probabilities: Record<string, number> = {};
  features.instances.forEach((r, i) => {
    probabilities[r.id] = fit.probabilities[i];
  });

  const functions = features.lfNames.map((name, j) => ({
    name,
    accCheat: fit.accCheat[j],
    accClean: fit.accClean[j],
    coverage: fit.coverage[j],
    // A function is informative when it votes +1 more on cheats than on clean.
    informativeness: fit.accCheat[j] - fit.accClean[j],
  }));

  const out = {
    classPrior: fit.classPrior,
    iterations: fit.iterations,
    functions,
    probabilities,
  };
  fs.writeFileSync(path.join(triageDir(root), 'label-model.json'), JSON.stringify(out, null, 2) + '\n');

  const ranked = [...functions].sort((a, b) => b.informativeness - a.informativeness);
  log.info(`fit label model in ${fit.iterations} iters; class prior ${fit.classPrior.toFixed(3)}`);
  for (const f of ranked.slice(0, 5)) {
    log.info(
      `  ${f.name}: accCheat ${f.accCheat.toFixed(2)} accClean ${f.accClean.toFixed(2)} ` +
        `cov ${f.coverage.toFixed(2)} info ${f.informativeness.toFixed(2)}`,
    );
  }
}

main();
