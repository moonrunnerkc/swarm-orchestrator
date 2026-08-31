import type { CalibrationRepeatObservation } from "./calibration-run.ts";
import {
  type CalibrationDimension,
  calibrationDimensions,
  type Distribution,
  distributionOf,
} from "./dimensions.ts";
import type { TaskClass } from "./task-class.ts";

interface CaseBreakdown {
  readonly caseId: string;
  readonly taskClass: TaskClass;
  readonly repeats: number;
  readonly gatePassed: number;
  /**
   * Repeats where the model never answered, so the gate judged a workspace no attempt was
   * made on. Kept apart from gatePassed for the reason invariant 7 keeps "not measured"
   * apart from zero: a provider outage and a model that cannot do the case both produce
   * "0 of 3 green", and reading the first as the second is a measurement of nothing
   * reported as a measurement of the model.
   */
  readonly didNotRun: number;
}

export interface ModelSummary {
  readonly model: string;
  readonly repeats: number;
  /** Of those repeats, the ones the model answered at all. Every dimension below is over these. */
  readonly executedRepeats: number;
  readonly dimensions: Readonly<Record<CalibrationDimension, Distribution>>;
  /** Per case as well as pooled: a stratified set that only reports a pooled number is not one. */
  readonly byCase: readonly CaseBreakdown[];
  /**
   * The repeats that measured nothing, counted by the reason code the run recorded. Carried
   * here so a report saying "59 of 60 executed" can say what the sixtieth was, rather than
   * leaving a reader to open the ledger to find out whether a model or a backend was at fault.
   */
  readonly abstentions: Readonly<Record<string, number>>;
  /** Every repeat record behind these numbers, so a score resolves to the runs that made it. */
  readonly runRecords: readonly string[];
}

/** One repeat's value for one dimension, or null when that repeat did not measure it. */
function valueFor(
  dimension: CalibrationDimension,
  observation: CalibrationRepeatObservation,
): number | null {
  switch (dimension) {
    case "tool-call-validity":
      return observation.toolCalls.validityRate;
    case "patch-apply":
      return observation.toolCalls.applyRate;
    case "gate-pass":
      return observation.gatePassed ? 1 : 0;
    case "tokens-per-second":
      return observation.modelCalls.tokensPerSecond;
    case "time-to-first-token":
      return observation.modelCalls.firstTokenMs;
    case "peak-memory":
      return observation.peakMemoryBytes;
  }
}

/**
 * Observations in, one summary per model out, with every dimension kept apart. Nothing here
 * combines two dimensions: there is no measured exchange rate between tokens per second and
 * gate pass rate, and inventing one is how a calibration report stops being a measurement.
 *
 * Only the repeats that executed reach a dimension. A repeat the model never answered says
 * nothing about the model, and it says it in every dimension at once: gate-pass would read
 * it as a failure the model earned, which is how a backend that never served the model ends
 * up scored as a model that solved nothing. Zero executed repeats therefore leaves every
 * distribution empty, which renders as not measured rather than as 0.000.
 */
export function summarizeByModel(
  observations: readonly CalibrationRepeatObservation[],
): readonly ModelSummary[] {
  const models = [...new Set(observations.map((observation) => observation.model))];

  return models.map((model) => {
    const mine = observations.filter((observation) => observation.model === model);
    const ran = mine.filter((observation) => observation.executed);
    const dimensions = Object.fromEntries(
      calibrationDimensions.map((dimension) => [
        dimension,
        distributionOf(ran.map((observation) => valueFor(dimension, observation))),
      ]),
    ) as Record<CalibrationDimension, Distribution>;

    return {
      model,
      repeats: mine.length,
      executedRepeats: ran.length,
      dimensions,
      byCase: breakDownByCase(mine),
      abstentions: countAbstentions(mine),
      // Every repeat, executed or not: what did not run is part of what this run recorded.
      runRecords: mine.map((observation) => observation.record),
    };
  });
}

function countAbstentions(
  observations: readonly CalibrationRepeatObservation[],
): Readonly<Record<string, number>> {
  const counted: Record<string, number> = {};
  for (const observation of observations) {
    if (observation.executed) {
      continue;
    }
    const reason = observation.abstentionReason ?? "unrecorded";
    counted[reason] = (counted[reason] ?? 0) + 1;
  }
  return counted;
}

function breakDownByCase(
  observations: readonly CalibrationRepeatObservation[],
): readonly CaseBreakdown[] {
  const caseIds = [...new Set(observations.map((observation) => observation.caseId))];

  return caseIds.map((caseId) => {
    const mine = observations.filter((observation) => observation.caseId === caseId);
    return {
      caseId,
      taskClass: mine[0]?.taskClass ?? "edit",
      repeats: mine.length,
      gatePassed: mine.filter((observation) => observation.executed && observation.gatePassed)
        .length,
      didNotRun: mine.filter((observation) => !observation.executed).length,
    };
  });
}
