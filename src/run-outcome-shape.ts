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
 * exit status share. Supplied requirements (a goal contract) decide; requirements the planner read
 * from the task are hypotheses and decide nothing (the table is on `outcomeStatus`).
 * - `accepted` (exit 0): every supplied requirement was met by a check that decides it, nothing
 *   refused, and no generated check disagrees.
 * - `unjudged` (exit 0): nothing refused the change and no requirement was supplied, so nothing
 *   says the task was done; planned hypotheses whose checks agree leave it here.
 * - `partially-checked` (exit 1): nothing refused the change, but a supplied requirement was
 *   decided by no check that ran.
 * - `unresolved` (exit 1): a generated check disagrees with the final tree and nothing that decides
 *   refused it. The check may be wrong or the change may be; nothing here can tell which.
 * - `unverified` (exit 4): the model or the verification environment was unavailable, so the
 *   change was established neither way.
 * - `not-accepted` (exit 1): a supplied check, a blocking gate, policy or the final verification
 *   refused it, nothing executed it, or the run did not finish.
 */
export type OutcomeStatus =
  | "accepted"
  | "unjudged"
  | "partially-checked"
  | "unresolved"
  | "unverified"
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
  /** Added in 14.5.0; exit status 0 exactly when this is `accepted` or `unjudged`, 4 for `unverified`. */
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
  /**
   * Added in 14.5.0: accepted repair attempts that began when only a generated check disagreed.
   * A repair can satisfy a wrong expectation; nothing independent says these were right.
   */
  readonly repairsForGeneratedChecksOnly?: readonly number[];
  /**
   * Added in 14.5.0: requested outcomes the planner identified from the task (a requirement, the
   * words a check quoted, and whether its cases change or keep behaviour) that no check retained
   * for the run states. Present only where there are some. A status of `accepted` beside these is
   * the supplied contract's, never a reading that the whole task was done.
   */
  readonly unresolvedOutcomes?: readonly UnresolvedOutcomeReport[];
}

/** A requested outcome no retained check states, with why and the next useful action. */
export interface UnresolvedOutcomeReport {
  readonly id: string;
  readonly requirement: string;
  readonly quote: string | null;
  readonly role: "change" | "keep";
  readonly reason: string;
  readonly nextAction: string;
}
