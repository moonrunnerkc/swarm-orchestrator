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
