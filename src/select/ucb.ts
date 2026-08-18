import type { RandomSource } from "../core/random-source.ts";
import type { AssignmentKind, RewardEntry } from "./routing-log.ts";
import type { TaskClass } from "./task-class.ts";

export interface RouterSettings {
  /** Rewards for a task class before the bandit takes over from the calibration pick. */
  readonly minSamples: number;
  /** Share of assignments made at random, so the estimate is not fed purely by its own routing. */
  readonly epsilon: number;
  /** UCB1's exploration constant. */
  readonly exploration: number;
}

/**
 * Twenty is a floor, not a finding: below it the arms differ by noise. Ten percent random
 * assignment is section 3.8's second correction, because the router selects the model and
 * would otherwise learn only from what it already prefers.
 */
export const defaultRouterSettings: RouterSettings = {
  minSamples: 20,
  epsilon: 0.1,
  exploration: Math.SQRT2,
};

export interface Arm {
  readonly model: string;
  readonly samples: number;
  readonly meanReward: number;
  /** Null below the threshold, where nothing is being compared, and for an untried arm. */
  readonly bonus: number | null;
  readonly index: number | null;
}

export interface RoutingDecision {
  readonly taskClass: TaskClass;
  readonly model: string;
  readonly assignment: AssignmentKind;
  /** Rewards on record for this task class, which is what the threshold is measured against. */
  readonly samples: number;
  readonly threshold: number;
  readonly arms: readonly Arm[];
  readonly reason: string;
}

export interface RoutingInput {
  readonly taskClass: TaskClass;
  /** The models the router may choose between. The calibration pick should be one of them. */
  readonly candidates: readonly string[];
  /** Stands until the log has enough samples for this class to say anything. */
  readonly calibrationPick: string;
  readonly entries: readonly RewardEntry[];
  readonly random: RandomSource;
  readonly settings?: RouterSettings;
}

/**
 * Section 3.8's router. Three states, and which one it is in is recorded rather than inferred:
 * below the sample threshold the calibration pick stands, above it UCB1 chooses, and a tenth
 * of assignments are drawn at random whatever UCB thinks.
 */
export function routeModel(input: RoutingInput): RoutingDecision {
  const settings = input.settings ?? defaultRouterSettings;
  const forClass = input.entries.filter((entry) => entry.taskClass === input.taskClass);
  const arms = armsFor(input.candidates, forClass, settings);

  const decide = (
    model: string,
    assignment: AssignmentKind,
    reason: string,
    withIndices: readonly Arm[],
  ): RoutingDecision => ({
    taskClass: input.taskClass,
    model,
    assignment,
    samples: forClass.length,
    threshold: settings.minSamples,
    arms: withIndices,
    reason,
  });

  if (forClass.length < settings.minSamples) {
    return decide(
      input.calibrationPick,
      "calibration",
      `the ${input.taskClass} class has ${forClass.length} of the ${settings.minSamples} rewards ` +
        "the router needs, so the calibration pick stands",
      arms,
    );
  }

  const scored = arms;

  if (input.random.next() < settings.epsilon) {
    const drawn = input.candidates[Math.floor(input.random.next() * input.candidates.length)];
    if (drawn !== undefined) {
      return decide(
        drawn,
        "epsilon",
        `assigned at random, which ${percent(settings.epsilon)} of assignments are, so the ` +
          "estimate is not fed purely by its own routing",
        scored,
      );
    }
  }

  const untried = scored.find((arm) => arm.samples === 0);
  if (untried !== undefined) {
    return decide(
      untried.model,
      "ucb",
      `${untried.model} has never been tried on a ${input.taskClass} task, and an arm with no ` +
        "samples has no upper bound to compare",
      scored,
    );
  }

  const best = scored.reduce((leader, arm) =>
    (arm.index ?? 0) > (leader.index ?? 0) ? arm : leader,
  );
  return decide(
    best.model,
    "ucb",
    `${best.model} has the highest upper bound: mean ${round(best.meanReward)} over ` +
      `${best.samples} run(s), plus ${round(best.bonus ?? 0)} of confidence bonus`,
    scored,
  );
}

/**
 * One arm per candidate over one class's rewards. The upper bound is only computed once the
 * class has enough samples to compare on, so a table can never show an index the router would
 * not have acted on.
 */
export function armsFor(
  candidates: readonly string[],
  entriesForClass: readonly RewardEntry[],
  settings: RouterSettings = defaultRouterSettings,
): readonly Arm[] {
  const arms = candidates.map((model) => summarize(model, entriesForClass));
  if (entriesForClass.length < settings.minSamples) {
    return arms;
  }
  return arms.map((arm) => scoreArm(arm, entriesForClass.length, settings));
}

function summarize(model: string, entries: readonly RewardEntry[]): Arm {
  const mine = entries.filter((entry) => entry.model === model);
  const total = mine.reduce((sum, entry) => sum + entry.reward, 0);
  return {
    model,
    samples: mine.length,
    meanReward: mine.length === 0 ? 0 : total / mine.length,
    bonus: null,
    index: null,
  };
}

/** UCB1: the mean plus a term that shrinks as an arm is played and grows as others are. */
function scoreArm(arm: Arm, total: number, settings: RouterSettings): Arm {
  if (arm.samples === 0) {
    return arm;
  }
  const bonus = settings.exploration * Math.sqrt(Math.log(total) / arm.samples);
  return { ...arm, bonus, index: arm.meanReward + bonus };
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
