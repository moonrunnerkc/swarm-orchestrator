import type { RoutingDecision } from "./ucb.ts";

/**
 * The routing decision as the ledger holds it (section 3.8's evidence type).
 *
 * Which model ran a task is the one input to a run that the run itself cannot show. The
 * reward record written at the end says what the chosen model earned; only this says what
 * it was chosen over and why, so an "epsilon" exploration that lost and a "ucb" pick that
 * lost read the same way in the log without it.
 *
 * Every arm rides along, not just the winner, and the numbers are what a reader recomputes
 * the choice from. The reason is carried as the router composed it: prose here renders the
 * decision and is never the source of it.
 *
 * A type alias rather than an interface, so it stays assignable to the ledger's JSON type,
 * which is the convention the local-endpoint record already sets.
 */
type RoutingDecisionEntry = {
  type: "routing-decision";
  actor: "harness";
  /**
   * The router reads the cross-session reward log, which is harness measurement of earlier
   * runs. Nothing a model or this workspace authored reaches the decision.
   */
  provenance: ["tool-output"];
  payload: {
    taskClass: string;
    model: string;
    assignment: string;
    samples: number;
    threshold: number;
    reason: string;
    arms: {
      model: string;
      samples: number;
      meanReward: number;
      bonus: number | null;
      index: number | null;
    }[];
  };
};

export function routingDecisionRecord(decision: RoutingDecision): RoutingDecisionEntry {
  return {
    type: "routing-decision",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      taskClass: decision.taskClass,
      model: decision.model,
      assignment: decision.assignment,
      samples: decision.samples,
      threshold: decision.threshold,
      reason: decision.reason,
      arms: decision.arms.map((arm) => ({
        model: arm.model,
        samples: arm.samples,
        meanReward: arm.meanReward,
        bonus: arm.bonus,
        index: arm.index,
      })),
    },
  };
}
