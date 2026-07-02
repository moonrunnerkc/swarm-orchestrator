// Phase 4: train and score the ranker. Features are the labeling-function
// votes plus the structural diff features; targets are the label model's
// probabilistic labels (soft, never the held-out ground truth). The ranker
// trains on the train split only, then scores every instance. It is evaluated
// as a ranker on the held-out test split against the true labels: PR-AUC
// (average precision) and recall at a review budget, not exact-match accuracy.
//
// Usage: node dist/scripts/triage/rank.js

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { scoreLogistic, trainLogistic } from '../../src/audit/triage/ranker';
import {
  averagePrecision,
  baseRate,
  precisionAtBudget,
  recallAtBudget,
  type ScoredInstance,
} from '../../src/audit/triage/metrics';
import { repoRoot } from '../real-prs/lib/paths';
import { triageDir } from './lib/triage-io';

const log = getLogger('triage:rank');

const REVIEW_BUDGETS = [0.1, 0.2];

interface FeaturesFile {
  lfNames: string[];
  structuralNames: string[];
  instances: Array<{
    id: string;
    tier: string;
    knownLabel: 0 | 1 | null;
    split: string;
    votes: number[];
    structural: number[];
  }>;
}

function main(): void {
  const root = repoRoot();
  const features = JSON.parse(
    fs.readFileSync(path.join(triageDir(root), 'triage-features.json'), 'utf8'),
  ) as FeaturesFile;
  const labelModel = JSON.parse(
    fs.readFileSync(path.join(triageDir(root), 'label-model.json'), 'utf8'),
  ) as { probabilities: Record<string, number> };

  const rows = features.instances.map((r) => ({
    ...r,
    features: [...r.votes, ...r.structural],
    soft: labelModel.probabilities[r.id] ?? 0.5,
  }));

  const train = rows.filter((r) => r.split === 'train');
  const model = trainLogistic(
    train.map((r) => r.features),
    train.map((r) => r.soft),
    { iterations: 1000, learningRate: 0.2, l2: 1e-3 },
  );

  const scores: Record<string, number> = {};
  for (const r of rows) scores[r.id] = scoreLogistic(model, r.features);

  // Evaluate on the held-out test split against the true labels.
  const test: ScoredInstance[] = rows
    .filter((r) => r.split === 'test' && r.knownLabel !== null)
    .map((r) => ({ score: scores[r.id], label: r.knownLabel as 0 | 1 }));

  const metrics = {
    testSize: test.length,
    testPositives: test.filter((t) => t.label === 1).length,
    baseRate: baseRate(test),
    prAuc: averagePrecision(test),
    recallAtBudget: Object.fromEntries(REVIEW_BUDGETS.map((b) => [b, recallAtBudget(test, b)])),
    precisionAtBudget: Object.fromEntries(REVIEW_BUDGETS.map((b) => [b, precisionAtBudget(test, b)])),
  };

  const featureNames = [...features.lfNames, ...features.structuralNames];
  fs.writeFileSync(
    path.join(triageDir(root), 'ranker.json'),
    JSON.stringify(
      { featureNames, weights: model.weights, bias: model.bias, trainSize: train.length, scores, metrics },
      null,
      2,
    ) + '\n',
  );

  log.info(
    `trained on ${train.length}; test n=${metrics.testSize} (pos ${metrics.testPositives}, ` +
      `base ${metrics.baseRate.toFixed(3)}); PR-AUC ${metrics.prAuc.toFixed(3)}; ` +
      `recall@10% ${recallAtBudget(test, 0.1).toFixed(3)}; recall@20% ${recallAtBudget(test, 0.2).toFixed(3)}`,
  );
}

main();
