import {
  bootstrapInterval,
  type Interval,
  intentionToTreat,
  type LaunchedRun,
} from "./statistics.ts";

/**
 * The arms a campaign compares, each named by the one thing it varies.
 *
 * The comparison that matters is not "is this system good" but "does each layer earn its
 * complexity". So the arms are nested: a strong single agent with nothing around it, then the
 * same agent with evidence capture, then with the gates and the ratchet, then the orchestration
 * shapes. An arm that costs more and accepts no more has not earned its place, and the design
 * has to be able to show that.
 */
export interface CampaignArm {
  readonly id: string;
  readonly what: string;
  /** How many attempts this arm makes per task. More than one divides the budget, never adds. */
  readonly attempts: number;
  readonly architecture: "single-agent" | "fixed-graph" | "planned-graph" | "redundant";
  readonly evidence: boolean;
  readonly gates: boolean;
}

export const campaignArms: readonly CampaignArm[] = [
  {
    id: "single-minimal",
    what: "a strong single agent with the smallest harness that can run it",
    attempts: 1,
    architecture: "single-agent",
    evidence: false,
    gates: false,
  },
  {
    id: "single-evidence",
    what: "the same agent, with every call and every tool use recorded",
    attempts: 1,
    architecture: "single-agent",
    evidence: true,
    gates: false,
  },
  {
    id: "single-gates",
    what: "evidence plus the gates, the ratchet and the bonds",
    attempts: 1,
    architecture: "single-agent",
    evidence: true,
    gates: true,
  },
  {
    id: "graph-fixed",
    what: "a decomposition a person wrote, run as a graph",
    attempts: 1,
    architecture: "fixed-graph",
    evidence: true,
    gates: true,
  },
  {
    id: "graph-planned",
    what: "a decomposition the model wrote, with replanning capped",
    attempts: 1,
    architecture: "planned-graph",
    evidence: true,
    gates: true,
  },
  {
    id: "redundancy-3",
    what: "three attempts at each task, the best landed by the comparator",
    attempts: 3,
    architecture: "redundant",
    evidence: true,
    gates: true,
  },
];

export interface MatchedArm extends CampaignArm {
  readonly budget: { readonly tokens: number; readonly wallMs: number };
  /** What one attempt gets. A redundant arm divides; it never multiplies. */
  readonly perAttempt: { readonly tokens: number; readonly wallMs: number };
}

/**
 * The same aggregate budget for every arm. Without it the comparison measures the budget: three
 * attempts at the full budget is three times the compute, and an arm that wins on three times
 * the compute has not been shown to be better at anything except spending.
 */
export function budgetMatched(
  arms: readonly CampaignArm[],
  budget: { readonly tokens: number; readonly wallMs: number },
): readonly MatchedArm[] {
  return arms.map((arm) => ({
    ...arm,
    budget,
    perAttempt: {
      tokens: Math.floor(budget.tokens / arm.attempts),
      wallMs: Math.floor(budget.wallMs / arm.attempts),
    },
  }));
}

export interface ArmRun extends LaunchedRun {
  readonly costUsd: number;
  readonly latencyMs: number;
}

export interface ArmScore {
  readonly armId: string;
  readonly launched: number;
  readonly crashed: number;
  readonly accepted: Interval;
  /** Null where nothing was accepted: a cost per accepted patch of infinity is not a number. */
  readonly costPerAccepted: number | null;
  readonly latency: Interval;
}

export function scoreArms(
  arms: readonly { readonly armId: string; readonly runs: readonly ArmRun[] }[],
): readonly ArmScore[] {
  return arms.map((arm) => {
    const counted = intentionToTreat(arm.runs);
    const totalCost = arm.runs.reduce((total, run) => total + run.costUsd, 0);
    return {
      armId: arm.armId,
      launched: counted.launched,
      crashed: counted.crashed,
      accepted: counted.rate,
      costPerAccepted: counted.accepted === 0 ? null : totalCost / counted.accepted,
      latency: bootstrapInterval(
        arm.runs.map((run) => run.latencyMs),
        { resamples: 1_000, seed: 20_260_905 },
      ),
    };
  });
}

export function describeArmReport(scores: readonly ArmScore[]): string {
  return scores
    .map((score) => {
      const rate = `${(score.accepted.point * 100).toFixed(1)}% [${(score.accepted.lower * 100).toFixed(1)}, ${(score.accepted.upper * 100).toFixed(1)}]`;
      const cost =
        score.costPerAccepted === null
          ? "no accepted patch, so no cost per accepted patch"
          : `$${score.costPerAccepted.toFixed(3)} per accepted patch`;
      return (
        `${score.armId}: ${score.launched} launched, ${score.crashed} crashed, ` +
        `accepted ${rate}, ${cost}, p50 latency ${Math.round(score.latency.point)}ms`
      );
    })
    .join("\n");
}
