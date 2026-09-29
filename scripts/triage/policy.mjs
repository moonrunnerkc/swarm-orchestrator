/**
 * The response promise in SUPPORT.md, as a decision over one issue at one moment.
 *
 * An issue opened by anyone but a maintainer that has no maintainer comment after the first
 * response window is labelled `overdue`, and the maintainer is mentioned in a reminder comment,
 * again every reminder interval until someone answers. After the escalation window it is also
 * labelled `escalated` and assigned to the maintainer, which notifies them a second way. The
 * first maintainer comment is the acknowledgement: both labels come off and no reminder follows.
 * The workflow applies what this returns and does nothing else; it never answers and never closes.
 *
 * Hours are the unit. A controlled exercise issue (labelled `controlled-exercise`, opened by the
 * workflow's own identity) may be run with shorter windows, and says so in every comment it gets.
 */
export const reminderMarker = "<!-- swarm-triage-reminder";

export const defaultPolicy = {
  maintainers: ["moonrunnerkc"],
  owner: "moonrunnerkc",
  firstResponseHours: 24,
  reminderEveryHours: 24,
  escalateAfterHours: 72,
};

/** Shorter windows for a labelled controlled exercise, so the loop can be watched end to end. */
export const exercisePolicy = {
  ...defaultPolicy,
  firstResponseHours: 0.25,
  reminderEveryHours: 0.25,
  escalateAfterHours: 0.75,
};

const hour = 3_600_000;

/**
 * @param {{ number: number, user: string, createdAt: string, labels: string[], assignees: string[], pullRequest: boolean }} issue
 * @param {{ user: string, createdAt: string, body: string }[]} comments
 * @param {number} now milliseconds since the epoch
 * @param {typeof defaultPolicy} policy
 */
export function decide(issue, comments, now, policy = defaultPolicy) {
  const actions = [];
  if (issue.pullRequest || policy.maintainers.includes(issue.user)) return actions;
  const answered = comments.some(
    (comment) =>
      policy.maintainers.includes(comment.user) && !comment.body.includes(reminderMarker),
  );
  if (answered) {
    for (const label of ["overdue", "escalated"])
      if (issue.labels.includes(label)) actions.push({ kind: "remove-label", label });
    return actions;
  }
  const ageHours = (now - Date.parse(issue.createdAt)) / hour;
  if (ageHours < policy.firstResponseHours) return actions;
  if (!issue.labels.includes("overdue")) actions.push({ kind: "add-label", label: "overdue" });
  const escalate = ageHours >= policy.escalateAfterHours;
  if (escalate && !issue.labels.includes("escalated"))
    actions.push({ kind: "add-label", label: "escalated" });
  if (escalate && !issue.assignees.includes(policy.owner))
    actions.push({ kind: "assign", user: policy.owner });
  const reminders = comments
    .filter((comment) => comment.body.includes(reminderMarker))
    .map((comment) => Date.parse(comment.createdAt))
    .sort((a, b) => a - b);
  const last = reminders.at(-1);
  if (last === undefined || (now - last) / hour >= policy.reminderEveryHours) {
    const exercise = issue.labels.includes("controlled-exercise");
    actions.push({
      kind: "comment",
      body: [
        `${reminderMarker} ${new Date(now).toISOString()} -->`,
        `@${policy.owner} #${issue.number} has had no maintainer response for ${Math.floor(ageHours * 10) / 10} hours; SUPPORT.md promises a first response within ${policy.firstResponseHours} hours.`,
        escalate
          ? "This is past the escalation window, so it is labelled `escalated` and assigned to you."
          : `This reminder repeats every ${policy.reminderEveryHours} hours until you comment.`,
        exercise
          ? `_Controlled exercise of the support loop${issue.labels.includes("short-windows") ? ", with shortened windows" : " on its real windows"}; not an outside report._`
          : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    });
  }
  return actions;
}

/** The windows an issue is held to: shortened only for a labelled controlled exercise. */
export function policyFor(labels) {
  return labels.includes("controlled-exercise") && labels.includes("short-windows")
    ? exercisePolicy
    : defaultPolicy;
}
