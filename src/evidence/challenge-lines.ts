/**
 * What challenging a contract's checks established, as lines every surface prints the same way:
 * the terminal, the Markdown summary and the pull-request comment. A requirement's outcome, and
 * where the report carries them, its base control, the alternatives its checks caught and the
 * counterexamples they let through, by name.
 */
export interface ChallengeLineInput {
  readonly policy?: string;
  readonly satisfied: boolean;
  readonly requirements: readonly {
    readonly id: string;
    readonly outcome: string;
    readonly baseControl?: string;
    readonly caught?: readonly string[];
    readonly gaps?: readonly string[];
    readonly unwitnessed?: readonly string[];
    readonly invalid?: readonly string[];
  }[];
}

export function challengeLines(report: ChallengeLineInput): readonly string[] {
  const named = (ids: readonly string[] | undefined) =>
    ids === undefined || ids.length === 0
      ? "none"
      : `${ids.slice(0, 5).join(", ")}${ids.length > 5 ? `, and ${ids.length - 5} more` : ""}`;
  return [
    `challenges${report.policy === undefined ? "" : ` (${report.policy})`}: ${report.satisfied ? "every requirement's checks demonstrated detection" : "not every requirement's checks demonstrated detection"}`,
    ...report.requirements.map((requirement) =>
      [
        `${requirement.id}: ${requirement.outcome}`,
        ...(requirement.baseControl === undefined ? [] : [`base ${requirement.baseControl}`]),
        ...(requirement.caught === undefined ? [] : [`caught ${named(requirement.caught)}`]),
        ...(requirement.gaps === undefined ? [] : [`let through ${named(requirement.gaps)}`]),
        ...(requirement.unwitnessed === undefined || requirement.unwitnessed.length === 0
          ? []
          : [`unwitnessed ${named(requirement.unwitnessed)}`]),
        ...(requirement.invalid === undefined || requirement.invalid.length === 0
          ? []
          : [`invalid ${named(requirement.invalid)}`]),
      ].join("; "),
    ),
  ];
}
