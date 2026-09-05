/**
 * When a run is allowed to explore, and whether learned routing has earned being the default.
 *
 * A tenth of ordinary production runs were routed to a random model, so the estimate would not
 * be fed purely by its own routing. That is the right thing to do while measuring and the wrong
 * thing to do to somebody's actual work, and nothing told them it had happened. Exploration is
 * now something a caller asks for.
 */
export type RoutingMode = "production" | "calibration" | "canary";

const explorationByMode: Readonly<Record<RoutingMode, number>> = {
  // Somebody's actual work is not a sample.
  production: 0,
  calibration: 0.25,
  // The deliberate slice: enough to keep an estimate honest, named as the thing it is.
  canary: 0.1,
};

export function explorationRateFor(mode: RoutingMode): number {
  return explorationByMode[mode];
}

export interface ArmMeasurement {
  readonly successes: number;
  readonly trials: number;
  readonly costPerAccepted: number;
  readonly p95LatencyMs: number;
}

export interface RoutingJustification {
  readonly justified: boolean;
  readonly reason: string;
  /** The interval the non-inferiority call was made against, so the call can be checked. */
  readonly successDifferenceInterval: readonly [number, number];
}

/** Below this the comparison is noise, and calling noise evidence is the thing to avoid. */
const minimumHeldOutTrials = 30;

/**
 * The margin learned routing is allowed to be worse by and still count as non-inferior. Five
 * points, named rather than tuned: a margin picked after seeing the result is not a margin.
 */
const nonInferiorityMargin = 0.05;

export function learnedRoutingJustified(input: {
  readonly baseline: ArmMeasurement;
  readonly learned: ArmMeasurement;
}): RoutingJustification {
  const { baseline, learned } = input;
  const interval = successDifferenceInterval(baseline, learned);

  if (baseline.trials < minimumHeldOutTrials || learned.trials < minimumHeldOutTrials) {
    return {
      justified: false,
      reason:
        `too few held-out tasks to compare: ${baseline.trials} and ${learned.trials}, and ` +
        `${minimumHeldOutTrials} is the floor. Below it the difference is noise, and calling ` +
        "noise evidence is the thing this exists to avoid",
      successDifferenceInterval: interval,
    };
  }

  // Non-inferiority: the whole plausible range of the difference has to sit above the margin.
  // A point estimate that happens to be higher is not evidence that it is not worse.
  if (interval[0] < -nonInferiorityMargin) {
    return {
      justified: false,
      reason:
        `success is not shown non-inferior: the difference could be as bad as ` +
        `${(interval[0] * 100).toFixed(1)} points, past the ${nonInferiorityMargin * 100}-point ` +
        "margin. Cheaper does not buy back a worse result",
      successDifferenceInterval: interval,
    };
  }

  const cheaper = learned.costPerAccepted < baseline.costPerAccepted;
  const faster = learned.p95LatencyMs < baseline.p95LatencyMs;
  if (!cheaper && !faster) {
    return {
      justified: false,
      reason:
        "success held, but it is neither cheaper nor faster, so the extra machinery buys " +
        "nothing. A router that changes nothing measurable is complexity with no case for it",
      successDifferenceInterval: interval,
    };
  }

  return {
    justified: true,
    reason:
      `success is non-inferior within ${nonInferiorityMargin * 100} points and it is ` +
      `${cheaper ? "cheaper" : "no dearer"}${faster ? " and faster" : ""}: ` +
      `${learned.costPerAccepted.toFixed(2)} against ${baseline.costPerAccepted.toFixed(2)} per ` +
      `accepted patch, p95 ${learned.p95LatencyMs}ms against ${baseline.p95LatencyMs}ms`,
    successDifferenceInterval: interval,
  };
}

/**
 * A normal-approximation interval on the difference of two rates. Deliberately simple and
 * deliberately reported: the number it produces is checkable, which a bare verdict is not.
 */
function successDifferenceInterval(
  baseline: ArmMeasurement,
  learned: ArmMeasurement,
): readonly [number, number] {
  const baseRate = baseline.trials === 0 ? 0 : baseline.successes / baseline.trials;
  const learnedRate = learned.trials === 0 ? 0 : learned.successes / learned.trials;
  const variance =
    (baseline.trials === 0 ? 0 : (baseRate * (1 - baseRate)) / baseline.trials) +
    (learned.trials === 0 ? 0 : (learnedRate * (1 - learnedRate)) / learned.trials);
  const halfWidth = 1.96 * Math.sqrt(variance);
  const difference = learnedRate - baseRate;
  return [difference - halfWidth, difference + halfWidth];
}
