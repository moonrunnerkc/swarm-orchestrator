/**
 * Risk-based checkpoints, not approval spam.
 *
 * A person asked to approve everything approves everything, which is worse than not asking:
 * it converts a safety mechanism into a keystroke and leaves everyone believing a person
 * looked. So the question is never "did something happen" but "would a mistake here be
 * expensive and hard to undo", and the answer is read off what the action is rather than off
 * how the model described it.
 */
export type ApprovalSubject =
  | "network"
  | "dependencies"
  | "secrets"
  | "scope"
  | "landing"
  | "destructive"
  | "policy-exception";

export interface ProposedAction {
  readonly network?: "denied" | "mediated" | "unrestricted";
  /** Installing a dependency runs code the repository chose from a registry. */
  readonly installsDependencies?: boolean;
  readonly usesSecrets?: boolean;
  /** Widening the declared file set past what the plan said. */
  readonly widensScope?: boolean;
  /** Landing on a branch anybody else reads. */
  readonly lands?: boolean;
  readonly destructive?: boolean;
  readonly policyException?: boolean;
}

export function approvalsRequiredFor(action: ProposedAction): readonly ApprovalSubject[] {
  const required: ApprovalSubject[] = [];
  if (action.network !== undefined && action.network !== "denied") {
    required.push("network");
  }
  if (action.installsDependencies === true) {
    required.push("dependencies");
  }
  if (action.usesSecrets === true) {
    required.push("secrets");
  }
  if (action.widensScope === true) {
    required.push("scope");
  }
  if (action.lands === true) {
    required.push("landing");
  }
  if (action.destructive === true) {
    required.push("destructive");
  }
  if (action.policyException === true) {
    required.push("policy-exception");
  }
  return required;
}

/** What a mistake here would cost, which is what decides whether anybody is asked at all. */
export function riskOf(action: ProposedAction): "low" | "medium" | "high" {
  if (action.lands === true || action.destructive === true || action.usesSecrets === true) {
    return "high";
  }
  if (
    action.widensScope === true ||
    action.policyException === true ||
    action.installsDependencies === true ||
    (action.network !== undefined && action.network !== "denied")
  ) {
    return "medium";
  }
  return "low";
}

const consequences: Readonly<Record<ApprovalSubject, string>> = {
  network: "the run may reach hosts outside this machine. Refused, it stays offline",
  dependencies:
    "the run may install packages, which runs install scripts the registry serves. Refused, " +
    "it works with what is already here",
  secrets: "the run may read a credential. Refused, the credential stays unread",
  scope:
    "the run may change files outside the set it declared. Refused, the edit is refused and " +
    "the model is told why",
  landing:
    "the change may be landed where other people read it. Refused, it stays on its own branch",
  destructive:
    "the run may delete or overwrite something it cannot put back. Refused, nothing is removed",
  "policy-exception":
    "a check the run is held to would be waived. Refused, the check stands and the run is not " +
    "acceptable",
};

export function describeApprovalRequest(
  subject: ApprovalSubject,
  context: { readonly reason: string },
): string {
  const consequence = consequences[subject];
  if (consequence === undefined) {
    throw new Error(
      `there is no approval rule for "${subject}", so nothing here knows what approving it ` +
        "would mean. Add a rule rather than asking a person to approve an unnamed thing.",
    );
  }
  return `approve ${subject}? ${context.reason}. If you approve, ${consequence}.`;
}
