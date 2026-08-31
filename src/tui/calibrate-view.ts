import type { CalibrationRepeatObservation } from "../select/calibration-run.ts";

/**
 * What a calibration sweep looks like while it is running, projected from the repeat records
 * as they land.
 *
 * A second view rather than a second use of the session screen, and the debt list said why:
 * the session screen renders one run, with one task, one workspace, one plan and one gate
 * strip, and a sweep has none of those as a single thing. Sixty runs in flight have no plan to
 * show and no gate strip that means anything across three models. What they do have is a
 * denominator, a position in it, and a per-model tally, and those are what this projects.
 *
 * Projected from the observations each repeat produced, which are themselves counted off that
 * repeat's ledger records. Nothing here reads a number the harness did not compute.
 */

export interface CalibratePlan {
  readonly models: readonly string[];
  readonly cases: number;
  readonly repeats: number;
  readonly goldenSetVersion: string;
  /** The endpoint the local models are served from, or null where none is involved. */
  readonly backend: string | null;
}

/** One repeat that is running now. Absent between repeats and once the sweep is done. */
export interface CalibrateInFlight {
  readonly model: string;
  readonly caseId: string;
  readonly repeat: number;
  /** Clock reading when it started, so the screen can say how long it has been going. */
  readonly startedAtMs: number;
}

export interface CalibrateModelTally {
  readonly model: string;
  readonly attempted: number;
  readonly executed: number;
  readonly green: number;
  /** How many repeats abstained under each reason code, from the repeat records. */
  readonly abstentions: Readonly<Record<string, number>>;
}

export interface CalibrateView {
  readonly plan: CalibratePlan;
  readonly finished: number;
  readonly inFlight: CalibrateInFlight | null;
  readonly byModel: readonly CalibrateModelTally[];
  /** What the sweep settled on, once it has. Null while it is still running. */
  readonly pick: string | null;
  readonly settled: boolean;
}

export type CalibrateEvent =
  | { readonly type: "planned"; readonly plan: CalibratePlan }
  | { readonly type: "repeat-started"; readonly run: CalibrateInFlight }
  | { readonly type: "repeat-finished"; readonly observation: CalibrationRepeatObservation }
  | { readonly type: "settled"; readonly pick: string | null };

export const emptyCalibrateView: CalibrateView = {
  plan: { models: [], cases: 0, repeats: 0, goldenSetVersion: "", backend: null },
  finished: 0,
  inFlight: null,
  byModel: [],
  pick: null,
  settled: false,
};

/** Total repeats the sweep will run, which is the denominator every progress line needs. */
export function plannedRepeats(plan: CalibratePlan): number {
  return plan.models.length * plan.cases * plan.repeats;
}

export function applyCalibrateEvent(view: CalibrateView, event: CalibrateEvent): CalibrateView {
  switch (event.type) {
    case "planned":
      return {
        ...view,
        plan: event.plan,
        // One tally per model from the start, so a model that has not run yet is a row of
        // zeroes rather than a row that appears partway down the screen.
        byModel: event.plan.models.map((model) => ({
          model,
          attempted: 0,
          executed: 0,
          green: 0,
          abstentions: {},
        })),
      };
    case "repeat-started":
      return { ...view, inFlight: event.run };
    case "repeat-finished":
      return {
        ...view,
        finished: view.finished + 1,
        inFlight: null,
        byModel: withObservation(view.byModel, event.observation),
      };
    case "settled":
      return { ...view, inFlight: null, pick: event.pick, settled: true };
  }
}

function withObservation(
  tallies: readonly CalibrateModelTally[],
  observation: CalibrationRepeatObservation,
): readonly CalibrateModelTally[] {
  const known = tallies.some((tally) => tally.model === observation.model);
  const updated = tallies.map((tally) =>
    tally.model === observation.model ? merge(tally, observation) : tally,
  );
  // A repeat for a model the plan did not name still counts. Dropping it would make the
  // screen disagree with the ledger about how many runs happened.
  return known
    ? updated
    : [
        ...updated,
        merge(
          { model: observation.model, attempted: 0, executed: 0, green: 0, abstentions: {} },
          observation,
        ),
      ];
}

function merge(
  tally: CalibrateModelTally,
  observation: CalibrationRepeatObservation,
): CalibrateModelTally {
  const abstentions = { ...tally.abstentions };
  const reason = observation.abstention?.reason;
  if (reason !== undefined) {
    abstentions[reason] = (abstentions[reason] ?? 0) + 1;
  }

  return {
    model: tally.model,
    attempted: tally.attempted + 1,
    executed: tally.executed + (observation.executed ? 1 : 0),
    // Green only where the model answered. A gate exiting zero over a workspace nothing
    // touched is the number that made a calibration report look like a measurement.
    green: tally.green + (observation.executed && observation.gatePassed ? 1 : 0),
    abstentions,
  };
}
