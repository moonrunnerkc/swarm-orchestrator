/**
 * The outcome a run reports, as data with no dependencies: shared by the outcome block the
 * terminal prints and the `outcome` field of the JSON result, which the standalone verifier's
 * closure also carries, so nothing here may reach the screen or the agent.
 */
export interface RequirementOutcome {
  readonly id: string;
  readonly description: string;
  readonly status: "accepted" | "rejected" | "unjudged";
  /** Model-authored criteria stay labelled, however many times a person has read them. */
  readonly authoredBy: "user" | "model";
  readonly detail: string | null;
  /**
   * Added in 14.5.0. Supplied by the user, or read from the task by the planner. A planned
   * requirement is decided by no check, so it is unjudged however its generated checks came out.
   */
  readonly source?: "supplied" | "planned";
  /** The task's own words a planned requirement quotes; null where it quotes none. */
  readonly quote?: string | null;
  /** A planned requirement's generated checks on the final tree, which inform and never decide. */
  readonly generatedChecks?: readonly {
    readonly id: string;
    readonly status: "accepted" | "rejected" | "unjudged" | "not-run";
    readonly detail: string;
  }[];
}

/**
 * Added in 14.5.0: the one reading of a finished run that the terminal, the JSON result and the
 * exit status share.
 * - `accepted`: every sealed requirement was met by a check that decides it, and nothing refused.
 * - `unjudged`: nothing refused the change, and no requirement was sealed, so nothing says the
 *   task was done.
 * - `partially-checked`: nothing trusted refused the change, but at least one sealed requirement
 *   was not established by a check that decides it.
 * - `unresolved`: as partially checked, and a generated check disagrees with the final tree. The
 *   check may be wrong or the change may be; nothing here can tell which.
 * - `not-accepted`: a check that decides a requirement, a blocking gate, policy or the final
 *   verification refused it, or the run did not finish.
 */
export type OutcomeStatus =
  | "accepted"
  | "unjudged"
  | "partially-checked"
  | "unresolved"
  | "not-accepted";

export interface FinalVerificationOutcome {
  readonly refusal: string | null;
  readonly regression: string;
  readonly unmeasured: boolean;
  readonly advice: string;
}

export interface InterventionCounts {
  readonly repairAttempts: number;
  readonly stallNotices: number;
  readonly stallStops: number;
  readonly escalations: number;
  readonly promptsAnsweredByPerson: number;
  readonly promptsPreApproved: number;
  readonly promptsDeclined: number;
}

/** Planning and acceptance authoring, where the run did that before implementation. */
export interface SetupUsage {
  readonly tokensUsed: number;
  readonly durationMs: number;
}

export interface RunOutcomeReport {
  /** Added in 14.5.0; exit status 0 exactly when this is `accepted` or `unjudged`. */
  readonly status: OutcomeStatus;
  readonly lifecycle: string;
  readonly requirements: readonly RequirementOutcome[] | null;
  readonly changedFiles: readonly string[];
  readonly finalVerification: FinalVerificationOutcome | null;
  readonly interventions: InterventionCounts;
  readonly setup: SetupUsage | null;
  readonly resumable: boolean;
  /**
   * Planned requirements the planner invented (they quote no task sentence) and no admitted check
   * covers. They were never sealed, so nothing judged them and the run cannot call them met; they
   * are named so they cannot vanish either. A planned requirement that quotes the task is sealed
   * even with no admitted check, and reported among `requirements` as unjudged.
   */
  readonly uncheckedRequirements?: readonly { readonly id: string; readonly description: string }[];
}
