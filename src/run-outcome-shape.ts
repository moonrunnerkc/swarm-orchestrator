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
  /**
   * Added in 14.6.0 (check-requirement-v1): which kind of acceptance the verdict is. Every
   * required check passed, or no new failure was established and the base's own failures in the
   * named checks remain. Both are acceptances; `refused` otherwise.
   */
  readonly checks?: {
    readonly result: "all-required-pass" | "no-new-failures" | "refused";
    readonly inherited: readonly {
      readonly gateId: string;
      readonly failures: readonly string[];
    }[];
  };
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
   * Added in 14.6.0: what the run had to preserve, each obligation with its source and the status
   * what ran gave it (preservation-obligations-v1). An obligation nothing measured is unmeasured.
   */
  readonly preservation?: readonly {
    readonly id: string;
    readonly source: "task" | "contract" | "base" | "review";
    /**
     * preservation-obligations-v2: requested behaviour (new, never counted as preserved), an
     * explicit preservation requirement, behaviour observed through the base's checks, or a
     * reviewer's proposal.
     */
    readonly category: "requested" | "explicit-preserve" | "observed" | "proposed";
    readonly authority: "authoritative" | "observed" | "proposed";
    readonly statement: string;
    readonly basis: string;
    /**
     * `held` only where a check measured the obligation as stated; `exercised` where examples of
     * it ran and kept the base's answer, which does not establish the statement; `met` and
     * `unmet` for requested behaviour.
     */
    readonly status: "held" | "exercised" | "regressed" | "met" | "unmet" | "unmeasured";
    readonly by: string;
    readonly evidence: readonly {
      readonly check: string;
      readonly input?: unknown;
      readonly base: string | null;
      readonly candidate: string | null;
      readonly reading: string;
    }[];
  }[];
  /** The task's sentences no obligation was read from, kept so none disappears for a count. */
  readonly unclassifiedTask?: readonly string[];
  /** The digest of the delivered patch the preservation statuses were read on. */
  readonly deliveredPatch?: string;
  /** Added in 14.6.0, experimental: the review of the candidate, where `--review` asked for one. */
  readonly review?: {
    readonly mode: "executable" | "prose";
    /** The examination's record, or null where the review never examined. */
    readonly examination: string | null;
    /** The attempt its findings were owed, or null where none was. */
    readonly attempt: unknown;
    readonly probes: readonly string[];
    readonly readings: readonly unknown[];
  };
  /**
   * Added in 14.5.0: requested outcomes the planner identified from the task (a requirement, the
   * words a check quoted, and whether its cases change or keep behaviour) that no check retained
   * for the run states. Present only where there are some. A status of `accepted` beside these is
   * the supplied contract's, never a reading that the whole task was done.
   */
  readonly unresolvedOutcomes?: readonly UnresolvedOutcomeReport[];
  /**
   * Added in 14.5.0: the one follow-up a run owes on those outcomes once its gates are green, and
   * what became of it. Present only where there were unresolved outcomes. Given or withheld, the
   * outcomes stay unresolved: no sealed check states them.
   */
  readonly outcomeFollowUp?: OutcomeFollowUpReport;
  /**
   * Added in 14.5.0: the one continuation a run owes its task when the loop that worked it
   * stopped at its step limit before it reported the task done, and what became of it. Present
   * only where the loop was so stopped. Given and kept, the continuation's own stop is the
   * lifecycle; withheld or rolled back, the lifecycle stays the interrupted loop's, and a status
   * of `accepted` beside it is the sealed checks' reading, never that the whole task was done.
   */
  readonly continuation?: TaskContinuationReport;
  /**
   * Added in 14.5.0: the test deliverable as the harness measured it on the delivered tree.
   * Names what changed in test files against the base, whether the tests gate passed, and, where
   * measured, whether a file's added tests fail over the base's source. Decides nothing.
   */
  readonly regressionTests?: RegressionTestsReport;
}

/** The task's continuation, as the resolve loop recorded it: the same shape as a follow-up's. */
export type TaskContinuationReport = OutcomeFollowUpReport;

export interface RegressionTestsReport {
  readonly files: readonly {
    readonly path: string;
    readonly testsAdded: readonly string[];
    readonly testsRemoved: readonly string[];
    readonly assertionsAdded: number;
    readonly onBaseSource: {
      readonly outcome: "passed" | "failed" | "indeterminate";
      readonly detail: string;
      readonly failedTests: readonly string[] | null;
    } | null;
  }[];
  readonly testsGate: "passed" | "failed" | "not-applicable" | "absent";
  readonly record: string;
}

/** The follow-up on unresolved outcomes, as the resolve loop recorded it. */
export interface OutcomeFollowUpReport {
  readonly state: "given" | "withheld";
  readonly attempt: number | null;
  /** The ratchet's decision on what the attempt left; null where nothing was judged. */
  readonly accepted: boolean | null;
  readonly reason: string;
  readonly record: string;
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
