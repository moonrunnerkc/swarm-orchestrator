import { strict as assert } from 'assert';
import { fitLabelModel, type Vote } from '../../../src/audit/triage/label-model';

/** Deterministic LCG so the synthetic data is reproducible without a seed file. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Generate a vote matrix from latent labels and per-function accuracies.
 * accuracy[j] is P(vote agrees with the true label | the function votes);
 * coverage[j] is P(the function votes at all).
 */
function synth(
  n: number,
  prior: number,
  accuracy: readonly number[],
  coverage: readonly number[],
): { matrix: Vote[][]; truth: number[] } {
  const rand = lcg(12345);
  const truth: number[] = [];
  const matrix: Vote[][] = [];
  for (let i = 0; i < n; i += 1) {
    const y = rand() < prior ? 1 : 0;
    truth.push(y);
    const row: Vote[] = [];
    for (let j = 0; j < accuracy.length; j += 1) {
      if (rand() > coverage[j]) {
        row.push(0);
        continue;
      }
      const agrees = rand() < accuracy[j];
      const voteForOne = agrees ? y === 1 : y === 0;
      row.push(voteForOne ? 1 : -1);
    }
    matrix.push(row);
  }
  return { matrix, truth };
}

function majorityVoteAccuracy(matrix: Vote[][], truth: number[]): number {
  let correct = 0;
  for (let i = 0; i < matrix.length; i += 1) {
    let sum = 0;
    for (const v of matrix[i]) sum += v;
    const pred = sum >= 0 ? 1 : 0;
    if (pred === truth[i]) correct += 1;
  }
  return correct / matrix.length;
}

describe('triage/label-model', () => {
  it('recovers labeling-function accuracies and the class prior without ground truth', () => {
    // Three strong functions, one noise function, one adversarial function.
    const accuracy = [0.9, 0.88, 0.85, 0.5, 0.2];
    const coverage = [0.8, 0.8, 0.7, 0.6, 0.5];
    const { matrix, truth } = synth(600, 0.4, accuracy, coverage);
    const fit = fitLabelModel(matrix, accuracy.length);

    // Class prior recovered within a few points.
    assert.ok(Math.abs(fit.classPrior - 0.4) < 0.08, `prior ${fit.classPrior}`);
    // Strong functions: P(+1|cheat) high, P(+1|clean) low.
    for (const j of [0, 1, 2]) {
      assert.ok(fit.accCheat[j] > 0.78, `LF${j} accCheat ${fit.accCheat[j]}`);
      assert.ok(fit.accClean[j] < 0.25, `LF${j} accClean ${fit.accClean[j]}`);
    }
    // The adversarial function (votes opposite the truth) is learned as such:
    // it votes +1 more often on clean than on cheat.
    assert.ok(fit.accClean[4] > fit.accCheat[4], 'adversarial LF learned inverted');
  });

  it('beats majority vote at recovering the latent labels', () => {
    const accuracy = [0.9, 0.85, 0.8, 0.55, 0.2];
    const coverage = [0.7, 0.7, 0.6, 0.6, 0.5];
    const { matrix, truth } = synth(600, 0.45, accuracy, coverage);
    const fit = fitLabelModel(matrix, accuracy.length);

    let correct = 0;
    for (let i = 0; i < matrix.length; i += 1) {
      const pred = fit.probabilities[i] >= 0.5 ? 1 : 0;
      if (pred === truth[i]) correct += 1;
    }
    const modelAcc = correct / matrix.length;
    const mvAcc = majorityVoteAccuracy(matrix, truth);
    assert.ok(modelAcc >= mvAcc, `label model ${modelAcc} should beat majority ${mvAcc}`);
    assert.ok(modelAcc > 0.8, `label model accuracy ${modelAcc}`);
  });

  it('reports coverage per function', () => {
    const matrix: Vote[][] = [
      [1, 0, 0],
      [-1, 0, 1],
      [0, 0, 1],
      [1, 0, -1],
    ];
    const fit = fitLabelModel(matrix, 3);
    assert.equal(fit.coverage[0], 0.75);
    assert.equal(fit.coverage[1], 0); // always abstains
    assert.equal(fit.coverage[2], 0.75);
  });

  it('handles the empty matrix without dividing by zero', () => {
    const fit = fitLabelModel([], 3);
    assert.equal(fit.probabilities.length, 0);
    assert.equal(fit.classPrior, 0.5);
  });
});
