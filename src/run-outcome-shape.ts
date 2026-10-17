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
}

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
  readonly lifecycle: string;
  readonly requirements: readonly RequirementOutcome[] | null;
  readonly changedFiles: readonly string[];
  readonly finalVerification: FinalVerificationOutcome | null;
  readonly interventions: InterventionCounts;
  readonly setup: SetupUsage | null;
  readonly resumable: boolean;
  /**
   * Planned requirements no admitted check covers. They were never sealed, so nothing judged
   * them and the run cannot call them met; they are named so they cannot vanish either.
   */
  readonly uncheckedRequirements?: readonly { readonly id: string; readonly description: string }[];
}
