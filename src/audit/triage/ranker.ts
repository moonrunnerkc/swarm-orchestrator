// The triage ranker: a small discriminative model trained on the label
// model's probabilistic labels. Where the detectors key on exact regex and
// AST patterns and the label model fuses their votes, the ranker learns a
// continuous score from features (the labeling-function votes plus cheap
// structural diff features), so it can rank a PR the detectors only partially
// fired on. It is scored as a ranker (PR-AUC, recall at a review budget), not
// as an exact-match classifier.
//
// Logistic regression by full-batch gradient descent with L2, trained against
// soft targets (cross-entropy with probabilistic labels in [0, 1]). Features
// are standardized from the training set; the same transform is applied at
// score time. Pure and deterministic (zero init, fixed iteration count), so a
// trained model replays byte-identical and is unit-testable.

export interface LogisticModel {
  readonly weights: readonly number[];
  readonly bias: number;
  /** Per-feature standardization, frozen from the training set. */
  readonly mean: readonly number[];
  readonly std: readonly number[];
}

export interface TrainOptions {
  readonly iterations?: number;
  readonly learningRate?: number;
  /** L2 penalty strength. */
  readonly l2?: number;
}

const DEFAULTS = { iterations: 500, learningRate: 0.1, l2: 1e-3 };

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Column means and standard deviations; std floored at 1 for constant columns. */
function standardization(x: ReadonlyArray<readonly number[]>): { mean: number[]; std: number[] } {
  const d = x[0]?.length ?? 0;
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(0);
  for (const row of x) for (let j = 0; j < d; j += 1) mean[j] += row[j];
  for (let j = 0; j < d; j += 1) mean[j] /= x.length;
  for (const row of x) for (let j = 0; j < d; j += 1) std[j] += (row[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j += 1) {
    std[j] = Math.sqrt(std[j] / x.length);
    if (std[j] < 1e-9) std[j] = 1;
  }
  return { mean, std };
}

function applyStd(row: readonly number[], mean: readonly number[], std: readonly number[]): number[] {
  return row.map((v, j) => (v - mean[j]) / std[j]);
}

/**
 * Train logistic regression against soft targets.
 *
 * @param x feature rows
 * @param y soft labels in [0, 1] (the label model's probabilities)
 * @param options gradient-descent controls
 */
export function trainLogistic(
  x: ReadonlyArray<readonly number[]>,
  y: readonly number[],
  options: TrainOptions = {},
): LogisticModel {
  const iterations = options.iterations ?? DEFAULTS.iterations;
  const lr = options.learningRate ?? DEFAULTS.learningRate;
  const l2 = options.l2 ?? DEFAULTS.l2;
  const n = x.length;
  const d = x[0]?.length ?? 0;

  if (n === 0 || d === 0) {
    return { weights: new Array<number>(d).fill(0), bias: 0, mean: new Array<number>(d).fill(0), std: new Array<number>(d).fill(1) };
  }

  const { mean, std } = standardization(x);
  const xs = x.map((row) => applyStd(row, mean, std));
  const weights = new Array<number>(d).fill(0);
  let bias = 0;

  for (let iter = 0; iter < iterations; iter += 1) {
    const gradW = new Array<number>(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i += 1) {
      let z = bias;
      for (let j = 0; j < d; j += 1) z += weights[j] * xs[i][j];
      const err = sigmoid(z) - y[i];
      gradB += err;
      for (let j = 0; j < d; j += 1) gradW[j] += err * xs[i][j];
    }
    bias -= lr * (gradB / n);
    for (let j = 0; j < d; j += 1) weights[j] -= lr * (gradW[j] / n + l2 * weights[j]);
  }

  return { weights, bias, mean, std };
}

/** Score one feature row: the model's probability the PR is a cheat. */
export function scoreLogistic(model: LogisticModel, row: readonly number[]): number {
  const xs = applyStd(row, model.mean, model.std);
  let z = model.bias;
  for (let j = 0; j < model.weights.length; j += 1) z += model.weights[j] * xs[j];
  return sigmoid(z);
}
