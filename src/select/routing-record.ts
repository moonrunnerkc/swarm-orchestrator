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
    /**
     * The competency table's answer for this class, counts included, so the pick or the
     * abstention can be recomputed from the record. Null where no table was consulted.
     */
    competency: {
      taskClass: string;
      floor: number;
      pick: string | null;
      abstained: boolean;
      reason: string;
      considered: {
        model: string;
        executed: number;
        gatePassed: number;
        gateShare: number | null;
        sweeps: number;
      }[];
    } | null;
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
      competency:
        decision.competency === null
          ? null
          : {
              taskClass: decision.competency.taskClass,
              floor: decision.competency.floor,
              pick: decision.competency.pick,
              abstained: decision.competency.abstained,
              reason: decision.competency.reason,
              considered: decision.competency.considered.map((entry) => ({
                model: entry.model,
                executed: entry.executed,
                gatePassed: entry.gatePassed,
                gateShare: entry.gateShare,
                sweeps: entry.sweeps,
              })),
            },
    },
  };
}
