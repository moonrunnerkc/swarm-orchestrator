/**
 * What a calibration sweep looks like while it is running.
 *
 * A sweep has none of the things the single-run screen is built around: no one task, no one
 * plan, no one set of gates. It has a grid, models by cases by repeats, and the questions a
 * person watching it has are about the grid: how far through, which model is ahead, and whether
 * anything is going wrong in a way that means stopping now rather than in two hours.
 *
 * A projection and nothing else, in the same shape as `session-view.ts`: events in, view out,
 * no clock and no IO. Every number on the screen is one this counted from an event the harness
 * emitted, never one a model reported about itself.
 */

/** What the sweep was asked to do, known before the first run starts. */
export interface CalibrationPlan {
  readonly models: readonly string[];
  readonly cases: number;
  readonly repeats: number;
  readonly goldenSetVersion: string;
}

/** The run in flight, or null between runs. */
export interface CalibrationCurrent {
  readonly model: string;
  readonly caseId: string;
  readonly repeat: number;
}

/** One model's running tally. Every field is counted from finished runs. */
export interface CalibrationTally {
  readonly model: string;
  readonly finished: number;
  /** Of those, the ones that measured the model at all. */
  readonly executed: number;
  readonly green: number;
  /** Unexecuted runs by the reason code the harness recorded, never by a guess. */
  readonly abstentions: Readonly<Record<string, number>>;
}

/** A finished run, as the screen needs it. */
export interface CalibrationOutcome {
  readonly model: string;
  readonly caseId: string;
  readonly repeat: number;
  readonly executed: boolean;
  readonly gatePassed: boolean;
  readonly abstentionReason: string | null;
}

export type CalibrateEvent =
  | { readonly type: "plan"; readonly plan: CalibrationPlan }
  | { readonly type: "run-started"; readonly current: CalibrationCurrent }
  | { readonly type: "run-finished"; readonly outcome: CalibrationOutcome };

export interface CalibrateView {
  readonly plan: CalibrationPlan | null;
  readonly current: CalibrationCurrent | null;
  readonly finished: number;
  /** Models in the order the plan named them, so the table does not reorder as it fills. */
  readonly tallies: readonly CalibrationTally[];
  /** The last few finished runs, newest first. Bounded, because a sweep is 180 of them. */
  readonly recent: readonly CalibrationOutcome[];
}

/** Enough to see a pattern forming, few enough to fit beside everything else. */
const recentKept = 8;

export const emptyCalibrateView: CalibrateView = {
  plan: null,
  current: null,
  finished: 0,
  tallies: [],
  recent: [],
};

/** Total runs the plan implies, or null before the plan is known. */
export function plannedRuns(plan: CalibrationPlan | null): number | null {
  return plan === null ? null : plan.models.length * plan.cases * plan.repeats;
}

export function applyCalibrateEvent(view: CalibrateView, event: CalibrateEvent): CalibrateView {
  switch (event.type) {
    case "plan":
      return {
        ...view,
        plan: event.plan,
        tallies: event.plan.models.map((model) => ({
          model,
          finished: 0,
          executed: 0,
          green: 0,
          abstentions: {},
        })),
      };

    case "run-started":
      return { ...view, current: event.current };

    case "run-finished":
      return {
        ...view,
        current: null,
        finished: view.finished + 1,
        tallies: countInto(view.tallies, event.outcome),
        recent: [event.outcome, ...view.recent].slice(0, recentKept),
      };
  }
}

/**
 * A model the plan did not name is appended rather than dropped. The plan is what the sweep was
 * asked for and the outcomes are what it did, and a screen that silently discarded a run because
 * the two disagreed would be hiding exactly the disagreement worth seeing.
 */
function countInto(
  tallies: readonly CalibrationTally[],
  outcome: CalibrationOutcome,
): readonly CalibrationTally[] {
  const known = tallies.some((tally) => tally.model === outcome.model);
  const base = known
    ? tallies
    : [...tallies, { model: outcome.model, finished: 0, executed: 0, green: 0, abstentions: {} }];

  return base.map((tally) => {
    if (tally.model !== outcome.model) {
      return tally;
    }
    const abstentions = { ...tally.abstentions };
    if (!outcome.executed) {
      const reason = outcome.abstentionReason ?? "unrecorded";
      abstentions[reason] = (abstentions[reason] ?? 0) + 1;
    }
    return {
      model: tally.model,
      finished: tally.finished + 1,
      executed: tally.executed + (outcome.executed ? 1 : 0),
      // Green only where the run also measured the model: a gate that passed over a workspace
      // no attempt was made on is not the model solving the case.
      green: tally.green + (outcome.executed && outcome.gatePassed ? 1 : 0),
      abstentions,
    };
  });
}
