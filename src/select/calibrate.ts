import { rm } from "node:fs/promises";
import type { JsonValue } from "../evidence/canonical-json.ts";
import type { ClaimEvaluation } from "../evidence/claim.ts";
import {
  type CalibrationPick,
  compareWithShortlist,
  pickFromCalibration,
  type ShortlistComparison,
} from "./calibration-report.ts";
import {
  type CalibrationRepeatObservation,
  type CalibrationRunDependencies,
  runCalibrationRepeat,
} from "./calibration-run.ts";
import { type ModelSummary, summarizeByModel } from "./calibration-summary.ts";
import { calibrationDimensions, dimensionSpecs, statisticOf } from "./dimensions.ts";
import type { GoldenSet } from "./golden-set.ts";

interface CalibrationOptions {
  /** Model specs to compare, in the order they should be reported. */
  readonly models: readonly string[];
  /** Repeats per case per model. Three is the floor: two cannot show a spread. */
  readonly repeats: number;
  readonly goldenSet: GoldenSet;
  /** The static shortlist's pick, so the report can corroborate or contradict it. */
  readonly staticPick: string | null;
  readonly deps: CalibrationRunDependencies;
}

interface CalibrationResult {
  readonly goldenSetVersion: string;
  readonly cases: number;
  readonly repeats: number;
  readonly observations: readonly CalibrationRepeatObservation[];
  readonly models: readonly ModelSummary[];
  readonly pick: CalibrationPick;
  readonly comparison: ShortlistComparison;
  /** Model spec to the digest of its summary record, which the report's claim cites. */
  readonly summaryRecords: Readonly<Record<string, string>>;
  readonly claims: readonly ClaimEvaluation[];
}

/**
 * Section 3.9's micro-eval. Every case against every model, repeated, in a fresh workspace
 * each time, with the numbers coming off the records each run produced. Nothing here decides
 * anything: it measures, and the pick is a separate reading of what it measured.
 */
export async function runCalibration(options: CalibrationOptions): Promise<CalibrationResult> {
  const observations: CalibrationRepeatObservation[] = [];

  for (const modelSpec of options.models) {
    for (const one of options.goldenSet.cases) {
      for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
        const observation = await runCalibrationRepeat(
          { case: one, modelSpec, repeat },
          options.deps,
        );
        observations.push(observation);
        // The numbers are in the ledger by now, so the tree itself is no longer evidence.
        await rm(observation.workspace, { recursive: true, force: true });
      }
    }
  }

  const models = summarizeByModel(observations);
  const pick = pickFromCalibration(models);
  const summaryRecords: Record<string, string> = {};
  const claims: ClaimEvaluation[] = [];

  for (const model of models) {
    const recorded = await options.deps.evidence.record({
      type: "calibration-summary",
      actor: "harness",
      provenance: ["tool-output"],
      payload: summaryPayload(model, options),
    });
    summaryRecords[model.model] = recorded.record.payloadDigest;

    claims.push(
      await options.deps.evidence.submitClaim(
        {
          predicate: `repeats == ${model.repeats} && gatePassed == ${greenRepeats(model)}`,
          record: recorded.record.payloadDigest,
          narrative:
            `${model.model} solved ${greenRepeats(model)} of ${model.repeats} calibration runs ` +
            `over ${options.goldenSet.cases.length} case(s).`,
        },
        "harness",
      ),
    );
  }

  return {
    goldenSetVersion: options.goldenSet.version,
    cases: options.goldenSet.cases.length,
    repeats: options.repeats,
    observations,
    models,
    pick,
    comparison: compareWithShortlist(pick, options.staticPick, models),
    summaryRecords,
    claims,
  };
}

function greenRepeats(model: ModelSummary): number {
  return model.byCase.reduce((sum, one) => sum + one.gatePassed, 0);
}

/**
 * Flat where a predicate has to reach, nested where a reviewer reads. The distributions carry
 * their raw values, so the report's spread is checkable against the runs behind it.
 */
function summaryPayload(model: ModelSummary, options: CalibrationOptions): JsonValue {
  const dimensions: Record<string, JsonValue> = {};
  for (const dimension of calibrationDimensions) {
    const spec = dimensionSpecs.find((candidate) => candidate.id === dimension);
    const distribution = model.dimensions[dimension];
    dimensions[dimension] = {
      samples: distribution.samples,
      unmeasured: distribution.unmeasured,
      min: distribution.min,
      median: distribution.median,
      max: distribution.max,
      mean: distribution.mean,
      deviation: distribution.deviation,
      ranked: spec === undefined ? null : statisticOf(distribution, spec),
      values: [...distribution.values],
    };
  }

  return {
    model: model.model,
    goldenSetVersion: options.goldenSet.version,
    cases: options.goldenSet.cases.length,
    repeats: model.repeats,
    gatePassed: greenRepeats(model),
    dimensions,
    byCase: model.byCase.map((one) => ({ ...one })),
    runRecords: [...model.runRecords],
  };
}
