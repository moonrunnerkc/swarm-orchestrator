/**
 * The arithmetic an evaluation is read through.
 *
 * Written here rather than in a notebook because a number nobody can re-derive is a claim, and
 * the difference between those is the whole point of this project. Each of these is a few lines
 * and each is tested, so a reported interval can be checked by reading the function that made it.
 */
export interface Interval {
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
}

/** 95%, which is the convention these are read against. Named rather than inlined. */
const z = 1.959963984540054;

/**
 * Wilson rather than the normal approximation: the normal one runs off the end of the unit
 * interval at the extremes, and the extremes are where a small evaluation lives.
 */
export function wilsonInterval(successes: number, trials: number): Interval {
  if (trials === 0) {
    return { point: 0, lower: 0, upper: 1 };
  }
  const rate = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = rate + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((rate * (1 - rate)) / trials + (z * z) / (4 * trials * trials));
  return {
    point: rate,
    lower: Math.max(0, (centre - spread) / denominator),
    upper: Math.min(1, (centre + spread) / denominator),
  };
}

export interface McNemarResult {
  readonly discordant: number;
  readonly statistic: number;
  readonly significant: boolean;
  readonly reason: string;
}

/**
 * Paired, because the arms ran the same tasks. Tasks both arms got right and tasks both got
 * wrong say nothing about which is better, so only the disagreements are counted: that is what
 * pairing buys, and an unpaired test over the same data throws it away.
 */
export function mcNemar(input: {
  readonly onlyFirst: number;
  readonly onlySecond: number;
}): McNemarResult {
  const discordant = input.onlyFirst + input.onlySecond;
  if (discordant < 10) {
    return {
      discordant,
      statistic: 0,
      significant: false,
      reason:
        `too few tasks disagreed (${discordant}) for the approximation to hold. Below ten the ` +
        "chi-square is not the right instrument and a verdict from it is arithmetic rather " +
        "than evidence",
    };
  }
  // With the continuity correction, which is what makes it usable at these counts.
  const statistic = (Math.abs(input.onlyFirst - input.onlySecond) - 1) ** 2 / discordant;
  const significant = statistic > 3.841458820694124;
  return {
    discordant,
    statistic,
    significant,
    reason: significant
      ? `the arms disagreed ${input.onlyFirst} to ${input.onlySecond} over ${discordant} tasks, ` +
        `which is past the 5% threshold (chi-square ${statistic.toFixed(2)})`
      : `the arms disagreed ${input.onlyFirst} to ${input.onlySecond}, which is within what ` +
        `chance produces (chi-square ${statistic.toFixed(2)})`,
  };
}

/**
 * A percentile interval by resampling, for cost and latency, which are not proportions and are
 * not normal. Seeded, because an interval nobody can reproduce is not a measurement.
 */
export function bootstrapInterval(
  sample: readonly number[],
  options: { readonly resamples: number; readonly seed: number },
): Interval {
  if (sample.length === 0) {
    return { point: 0, lower: 0, upper: 0 };
  }
  const mean = (values: readonly number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length;

  let state = options.seed >>> 0;
  const next = () => {
    // xorshift32: small, deterministic, and enough for a resampling index.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };

  const means: number[] = [];
  for (let resample = 0; resample < options.resamples; resample += 1) {
    const drawn: number[] = [];
    for (let index = 0; index < sample.length; index += 1) {
      drawn.push(sample[Math.floor(next() * sample.length)] ?? 0);
    }
    means.push(mean(drawn));
  }
  means.sort((left, right) => left - right);

  return {
    point: mean(sample),
    lower: means[Math.floor(0.025 * means.length)] ?? means[0] ?? 0,
    upper: means[Math.min(means.length - 1, Math.floor(0.975 * means.length))] ?? 0,
  };
}

export interface LaunchedRun {
  readonly launched: boolean;
  readonly completed: boolean;
  readonly accepted: boolean;
}

export interface IntentionToTreat {
  readonly launched: number;
  readonly completed: number;
  readonly crashed: number;
  readonly accepted: number;
  readonly rate: Interval;
}

/**
 * Every run that was launched, counted. A run that crashed is a run that did not produce an
 * accepted patch, and dropping it because it "did not really run" is how an arm's number
 * quietly becomes the number of the runs that happened to work. The crash rate is reported
 * beside it rather than folded into it, because those are different problems.
 */
export function intentionToTreat(runs: readonly LaunchedRun[]): IntentionToTreat {
  const launched = runs.filter((run) => run.launched).length;
  const completed = runs.filter((run) => run.launched && run.completed).length;
  const accepted = runs.filter((run) => run.launched && run.accepted).length;
  return {
    launched,
    completed,
    crashed: launched - completed,
    accepted,
    rate: wilsonInterval(accepted, launched),
  };
}

/** Hoeffding's finite-sample bound on independent paired differences in [-1, 1]. */
export function pairedNonInferiority(
  pairs: readonly { baseline: boolean; candidate: boolean }[],
  margin: number,
): Interval & { nonInferior: boolean; method: "paired-hoeffding-95" } {
  if (!(margin > 0 && margin <= 1)) throw new Error("prespecify a margin in (0, 1]");
  const point =
    pairs.length === 0
      ? 0
      : pairs.reduce((sum, pair) => sum + Number(pair.candidate) - Number(pair.baseline), 0) /
        pairs.length;
  const radius = pairs.length === 0 ? 1 : Math.sqrt((2 * Math.log(40)) / pairs.length);
  const lower = Math.max(-1, point - radius);
  const upper = Math.min(1, point + radius);
  return {
    point,
    lower,
    upper,
    nonInferior: pairs.length > 0 && lower > -margin,
    method: "paired-hoeffding-95",
  };
}

export interface ExactMcNemarResult {
  readonly onlyFirst: number;
  readonly onlySecond: number;
  readonly discordant: number;
  /** Two-sided, from the binomial itself. 1 where nothing disagreed: no evidence is not a tie. */
  readonly pValue: number;
  readonly method: "mcnemar-exact-binomial-two-sided";
}

/**
 * The exact form of the paired test, for the counts the chi-square above abstains on.
 *
 * Under the null each discordant pair falls either way with probability one half, so the smaller
 * count is a binomial tail and doubling it is the two-sided p-value. No approximation is involved,
 * which is what makes it usable at three discordant pairs where `mcNemar` rightly says nothing.
 */
export function mcNemarExact(input: {
  readonly onlyFirst: number;
  readonly onlySecond: number;
}): ExactMcNemarResult {
  for (const count of [input.onlyFirst, input.onlySecond]) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`a discordant count is a non-negative integer, and ${count} is not one`);
    }
  }
  const discordant = input.onlyFirst + input.onlySecond;
  const smaller = Math.min(input.onlyFirst, input.onlySecond);
  let tail = 0;
  // Built term by term from C(n, 0): factorials overflow long before these counts matter.
  let term = 0.5 ** discordant;
  for (let k = 0; k <= smaller; k += 1) {
    tail += term;
    term = (term * (discordant - k)) / (k + 1);
  }
  return {
    onlyFirst: input.onlyFirst,
    onlySecond: input.onlySecond,
    discordant,
    pValue: discordant === 0 ? 1 : Math.min(1, 2 * tail),
    method: "mcnemar-exact-binomial-two-sided",
  };
}

export interface PairedTable {
  readonly bothPass: number;
  readonly onlyFirst: number;
  readonly onlySecond: number;
  readonly bothFail: number;
}

/**
 * The difference between two pass rates measured on the same tasks, second minus first.
 *
 * Newcombe's 1998 square-and-add interval for paired proportions (his method 10): a Wilson
 * interval around each marginal rate, combined with a correction for how strongly the two
 * outcomes move together. Pairs that agree carry that correlation, so they narrow the interval
 * without moving the point, which an unpaired interval over the same table throws away. It stays
 * inside [-1, 1] and behaves at zero discordant pairs, where a Wald interval collapses to a point.
 */
export function pairedDifferenceInterval(
  table: PairedTable,
): Interval & { readonly pairs: number; readonly method: "newcombe-paired-score-95" } {
  const { bothPass: a, onlyFirst: b, onlySecond: c, bothFail: d } = table;
  for (const count of [a, b, c, d]) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        `a cell of a paired table is a non-negative integer, and ${count} is not one`,
      );
    }
  }
  const pairs = a + b + c + d;
  if (pairs === 0) {
    return { point: 0, lower: -1, upper: 1, pairs, method: "newcombe-paired-score-95" };
  }
  const first = wilsonInterval(a + b, pairs);
  const second = wilsonInterval(a + c, pairs);
  const margins = (a + b) * (c + d) * (a + c) * (b + d);
  const cross = a * d - b * c;
  // Newcombe's continuity-style shrink of a positive association, left alone where negative.
  const shrunk = cross > pairs / 2 ? cross - pairs / 2 : cross >= 0 ? 0 : cross;
  const phi = margins === 0 ? 0 : shrunk / Math.sqrt(margins);
  const below = Math.sqrt(
    (second.point - second.lower) ** 2 -
      2 * phi * (second.point - second.lower) * (first.upper - first.point) +
      (first.upper - first.point) ** 2,
  );
  const above = Math.sqrt(
    (second.upper - second.point) ** 2 -
      2 * phi * (second.upper - second.point) * (first.point - first.lower) +
      (first.point - first.lower) ** 2,
  );
  const point = (c - b) / pairs;
  return {
    point,
    lower: Math.max(-1, point - below),
    upper: Math.min(1, point + above),
    pairs,
    method: "newcombe-paired-score-95",
  };
}

export interface PairedOutcome {
  /** What the pair is, for listing the discordant ones by name. */
  readonly id: string;
  readonly first: boolean;
  readonly second: boolean;
}

export interface PairedComparison {
  readonly pairs: number;
  readonly cells: PairedTable;
  /** The pairs where only the first passed, and where only the second did, by name. */
  readonly onlyFirstIds: readonly string[];
  readonly onlySecondIds: readonly string[];
  readonly firstPassRate: number | null;
  readonly secondPassRate: number | null;
  readonly mcnemar: ExactMcNemarResult;
  /** Second minus first. */
  readonly difference: ReturnType<typeof pairedDifferenceInterval>;
}

/**
 * One paired comparison, whole: the table, the exact test and the interval, from the pairs and
 * nothing else. The one place a paired table is counted, so two experiments reading pass and fail
 * off the same tasks cannot count a cell two ways.
 */
export function pairedComparison(pairs: readonly PairedOutcome[]): PairedComparison {
  const cells: PairedTable = {
    bothPass: pairs.filter((one) => one.first && one.second).length,
    onlyFirst: pairs.filter((one) => one.first && !one.second).length,
    onlySecond: pairs.filter((one) => !one.first && one.second).length,
    bothFail: pairs.filter((one) => !one.first && !one.second).length,
  };
  return {
    pairs: pairs.length,
    cells,
    onlyFirstIds: pairs.filter((one) => one.first && !one.second).map((one) => one.id),
    onlySecondIds: pairs.filter((one) => !one.first && one.second).map((one) => one.id),
    firstPassRate: pairs.length === 0 ? null : (cells.bothPass + cells.onlyFirst) / pairs.length,
    secondPassRate: pairs.length === 0 ? null : (cells.bothPass + cells.onlySecond) / pairs.length,
    mcnemar: mcNemarExact({ onlyFirst: cells.onlyFirst, onlySecond: cells.onlySecond }),
    difference: pairedDifferenceInterval(cells),
  };
}

/**
 * Holm's step-down adjustment of a family of p-values, returned in the order given.
 *
 * A study that tests several treatments against one control, under several models, makes several
 * claims at once, and one of six tests at 5% comes out below it by chance about a quarter of the
 * time. Holm keeps the chance of any false claim in the family at 5% without assuming the tests
 * are independent, which the arms of one pair are not.
 */
export function holmAdjusted(pValues: readonly number[]): number[] {
  for (const value of pValues) {
    if (!(value >= 0 && value <= 1))
      throw new Error(`a p-value lies in [0, 1], and ${value} does not`);
  }
  const order = pValues
    .map((value, at) => ({ value, at }))
    .sort((one, other) => one.value - other.value || one.at - other.at);
  const adjusted = new Array<number>(pValues.length).fill(1);
  let running = 0;
  order.forEach((entry, rank) => {
    running = Math.max(running, Math.min(1, (pValues.length - rank) * entry.value));
    adjusted[entry.at] = running;
  });
  return adjusted;
}

export interface ClusteredRow {
  /** The unit rows are resampled by: a task, whose rows under several models are not independent. */
  readonly cluster: string;
  readonly first: boolean;
  readonly second: boolean;
}

/**
 * A pooled paired difference, second minus first, with a percentile interval from resampling
 * whole clusters.
 *
 * Two models on one task are two rows about one task, and treating them as independent draws
 * narrows the interval by the correlation it ignores. So each resample draws tasks with
 * replacement and keeps every row of a drawn task together. Seeded, with the generator
 * `bootstrapInterval` uses, so the interval is re-derivable from the rows.
 */
export function clusteredDifferenceInterval(
  rows: readonly ClusteredRow[],
  options: { readonly resamples: number; readonly seed: number },
): Interval & {
  readonly rows: number;
  readonly clusters: number;
  readonly method: "task-clustered-bootstrap-percentile-95";
} {
  const byCluster = new Map<string, number[]>();
  for (const row of rows) {
    byCluster.set(row.cluster, [
      ...(byCluster.get(row.cluster) ?? []),
      Number(row.second) - Number(row.first),
    ]);
  }
  const clusters = [...byCluster.keys()].sort();
  const method = "task-clustered-bootstrap-percentile-95" as const;
  if (clusters.length === 0) {
    return { point: 0, lower: -1, upper: 1, rows: 0, clusters: 0, method };
  }
  const meanOf = (differences: readonly number[]) =>
    differences.reduce((total, value) => total + value, 0) / differences.length;
  let state = options.seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  const estimates: number[] = [];
  for (let resample = 0; resample < options.resamples; resample += 1) {
    const drawn: number[] = [];
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[Math.floor(next() * clusters.length)] ?? "";
      drawn.push(...(byCluster.get(cluster) ?? []));
    }
    estimates.push(meanOf(drawn));
  }
  estimates.sort((left, right) => left - right);
  return {
    point: meanOf([...byCluster.values()].flat()),
    lower: estimates[Math.floor(0.025 * estimates.length)] ?? -1,
    upper: estimates[Math.min(estimates.length - 1, Math.floor(0.975 * estimates.length))] ?? 1,
    rows: rows.length,
    clusters: clusters.length,
    method,
  };
}
