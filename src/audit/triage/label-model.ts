// Weak-supervision label model. The 11 detectors, the judge, and the revert
// signal are labeling functions: each votes +1 (cheat), -1 (clean), or 0
// (abstain) on a PR. With no ground truth, the model learns each labeling
// function's accuracy from how the functions agree and disagree, then emits a
// probability per PR. This is the binary Dawid-Skene generative model
// (conditional independence of the labeling functions given the latent label),
// fit by EM, which is the classical precursor to the Snorkel label model and
// is what "learn the weights, do not hand-tune them" means here.
//
// Pure and dependency-free so it is unit-testable: feed votes from labeling
// functions of known accuracy and the fit must recover those accuracies and
// beat majority vote at recovering the latent labels.

/** A vote: +1 cheat, -1 clean, 0 abstain. */
export type Vote = -1 | 0 | 1;

export interface LabelModelOptions {
  /** Max EM iterations. */
  readonly maxIter?: number;
  /** Convergence tolerance on the mean posterior change. */
  readonly tol?: number;
  /** Laplace smoothing pseudocount, keeps accuracies off 0 and 1. */
  readonly smoothing?: number;
}

export interface LabelModelFit {
  /** Learned class prior P(y = cheat). */
  readonly classPrior: number;
  /** Per labeling function, P(vote = +1 | y = cheat) over its non-abstain votes. */
  readonly accCheat: readonly number[];
  /** Per labeling function, P(vote = +1 | y = clean) over its non-abstain votes. */
  readonly accClean: readonly number[];
  /** Per labeling function coverage: fraction of instances it did not abstain on. */
  readonly coverage: readonly number[];
  /** Posterior P(y = cheat | votes) per instance. */
  readonly probabilities: readonly number[];
  readonly iterations: number;
}

const DEFAULTS = { maxIter: 200, tol: 1e-6, smoothing: 1 };

/** Fraction of +1 among an instance's non-abstain votes; 0.5 when all abstain.
 *  Used to initialize the posterior before EM. */
function majorityInit(votes: readonly Vote[]): number {
  let pos = 0;
  let cast = 0;
  for (const v of votes) {
    if (v === 0) continue;
    cast += 1;
    if (v === 1) pos += 1;
  }
  return cast === 0 ? 0.5 : pos / cast;
}

/**
 * Fit the label model by EM and return learned accuracies plus per-instance
 * cheat probabilities.
 *
 * @param matrix instances x labeling-functions vote matrix
 * @param numFunctions the number of labeling functions (columns)
 * @param options EM controls
 */
export function fitLabelModel(
  matrix: ReadonlyArray<readonly Vote[]>,
  numFunctions: number,
  options: LabelModelOptions = {},
): LabelModelFit {
  const maxIter = options.maxIter ?? DEFAULTS.maxIter;
  const tol = options.tol ?? DEFAULTS.tol;
  const s = options.smoothing ?? DEFAULTS.smoothing;
  const n = matrix.length;

  if (n === 0) {
    return {
      classPrior: 0.5,
      accCheat: new Array(numFunctions).fill(0.5),
      accClean: new Array(numFunctions).fill(0.5),
      coverage: new Array(numFunctions).fill(0),
      probabilities: [],
      iterations: 0,
    };
  }

  // Posterior P(y=cheat | votes), initialized to the per-instance majority.
  let post = matrix.map(majorityInit);
  let accCheat = new Array<number>(numFunctions).fill(0.7);
  let accClean = new Array<number>(numFunctions).fill(0.3);
  let prior = post.reduce((a, b) => a + b, 0) / n;
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter += 1) {
    iterations = iter + 1;
    // M-step: accuracies and prior from the current soft labels.
    const nextAccCheat = new Array<number>(numFunctions).fill(0);
    const nextAccClean = new Array<number>(numFunctions).fill(0);
    for (let j = 0; j < numFunctions; j += 1) {
      let cheatPosW = 0;
      let cheatW = 0;
      let cleanPosW = 0;
      let cleanW = 0;
      for (let i = 0; i < n; i += 1) {
        const v = matrix[i][j];
        if (v === 0) continue;
        const pc = post[i];
        cheatW += pc;
        cleanW += 1 - pc;
        if (v === 1) {
          cheatPosW += pc;
          cleanPosW += 1 - pc;
        }
      }
      nextAccCheat[j] = (cheatPosW + s) / (cheatW + 2 * s);
      nextAccClean[j] = (cleanPosW + s) / (cleanW + 2 * s);
    }
    const nextPrior = post.reduce((a, b) => a + b, 0) / n;

    // E-step: posterior from the updated parameters, in log space.
    const nextPost = new Array<number>(n);
    let delta = 0;
    for (let i = 0; i < n; i += 1) {
      let logCheat = Math.log(nextPrior);
      let logClean = Math.log(1 - nextPrior);
      for (let j = 0; j < numFunctions; j += 1) {
        const v = matrix[i][j];
        if (v === 0) continue;
        if (v === 1) {
          logCheat += Math.log(nextAccCheat[j]);
          logClean += Math.log(nextAccClean[j]);
        } else {
          logCheat += Math.log(1 - nextAccCheat[j]);
          logClean += Math.log(1 - nextAccClean[j]);
        }
      }
      const m = Math.max(logCheat, logClean);
      const p = Math.exp(logCheat - m) / (Math.exp(logCheat - m) + Math.exp(logClean - m));
      nextPost[i] = p;
      delta += Math.abs(p - post[i]);
    }

    accCheat = nextAccCheat;
    accClean = nextAccClean;
    prior = nextPrior;
    post = nextPost;
    if (delta / n < tol) break;
  }

  return {
    classPrior: prior,
    accCheat,
    accClean,
    coverage: coverageOf(matrix, numFunctions),
    probabilities: post,
    iterations,
  };
}

/** Per-function coverage: fraction of instances the function did not abstain on. */
export function coverageOf(
  matrix: ReadonlyArray<readonly Vote[]>,
  numFunctions: number,
): number[] {
  const cov = new Array<number>(numFunctions).fill(0);
  if (matrix.length === 0) return cov;
  for (let j = 0; j < numFunctions; j += 1) {
    let cast = 0;
    for (let i = 0; i < matrix.length; i += 1) if (matrix[i][j] !== 0) cast += 1;
    cov[j] = cast / matrix.length;
  }
  return cov;
}
