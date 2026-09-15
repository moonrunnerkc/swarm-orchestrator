import type { ControllerView } from "../workers/controller-view.ts";
import { firstLineToWidth } from "./terminal-text.ts";

export function controllerScreenLines(
  view: ControllerView,
  columns: number,
  now: number,
): readonly string[] {
  const outcome = view.outcome;
  const accepted = view.requirements.filter(
    (requirement) => requirement.status === "accepted",
  ).length;
  return [
    `Goal: ${view.goal}`,
    `Activity: ${view.activity}`,
    `Work: ${view.jobs.filter((job) => job.state === "accepted").length}/${view.jobs.length} jobs accepted`,
    `Goal acceptance: ${outcome === null ? "pending" : outcome.goalAccepted ? "accepted" : "not established"}; ${accepted}/${view.requirements.length} requirements accepted`,
    ...(view.usage === null
      ? []
      : [
          `Tokens: ${view.usage.remaining} remaining, ${view.usage.spent} reported, ${view.usage.reserved} reserved, ${view.usage.unknownCalls} unknown calls`,
        ]),
    ...(view.deadlineAt === null
      ? []
      : [`Time remaining: ${Math.ceil(Math.max(0, view.deadlineAt - now) / 1000)}s`]),
    ...view.blockers.slice(0, 4).map((blocker) => `Blocked: ${blocker}`),
    ...(view.blockers.length > 4
      ? [`${view.blockers.length - 4} more blockers in the evidence`]
      : []),
    ...(view.branch === null
      ? []
      : [`Branch: ${view.branch}${view.commit === null ? "" : ` at ${view.commit.slice(0, 12)}`}`]),
    `Run: ${view.runId}; detailed records remain in its evidence`,
  ].map((line) => firstLineToWidth(line, columns));
}
