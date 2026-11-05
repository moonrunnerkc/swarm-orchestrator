import { describePythonEnvironment } from "./python-environment.ts";
import type { RunReportFile } from "./report.ts";
import {
  requirementRow,
  requirementTableHeader,
  summaryRequirementLines,
} from "./requirement-lines.ts";

const pad = (text: string, width: number) => text.padEnd(width);

/** The terminal's closing summary: the state, each requirement, and where the rest is. */
export function summaryLines(
  report: RunReportFile,
  paths: { readonly markdown: string },
): string[] {
  const lines = [
    `${pad("state", 12)} ${report.state}`,
    `${pad("stop", 12)} ${report.stop}${report.reason === null ? "" : `: ${report.reason}`}`,
    ...(report.blocked === null ? [] : [`${pad("blocked", 12)} ${report.blocked}`]),
    ...(report.unchecked === null ? [] : [`${pad("not checked", 12)} ${report.unchecked}`]),
  ];
  const python = report.startingState.python;
  if (python?.state === "not-prepared")
    lines.push(`${pad("python env", 12)} not prepared: ${python.limitation}`);
  for (const one of report.requirements) lines.push(...summaryRequirementLines(one));
  for (const one of report.authoring)
    lines.push(`${pad("checks", 12)} ${one.requirement}: ${authoringLine(one)}`);
  if (report.changed.length > 0) {
    const deleted = report.changed.filter((one) => one.status === "deleted").map((one) => one.path);
    const also = deleted.length === 0 ? "" : `, deleting ${deleted.join(", ")}`;
    lines.push(`${pad("changed", 12)} ${report.changed.length} file(s)${also}`);
  }
  if (report.regression !== null) lines.push(`${pad("regression", 12)} ${report.regression}`);
  if (report.execution !== null) lines.push(`${pad("execution", 12)} ${report.execution}`);
  lines.push(
    `${pad("patch", 12)} ${report.snapshot.patch} (sha256 ${report.snapshot.patchSha256})`,
  );
  const applied = report.delivery.applied ? "yes" : `no: ${report.delivery.reason}`;
  lines.push(`${pad("applied", 12)} ${applied}`);
  lines.push(`${pad("report", 12)} ${paths.markdown}`);
  return lines;
}

/** Inference time as measured: never a zero for turns whose runtime reported none. */
function inferenceOf(resources: RunReportFile["resources"]): string {
  if (resources.inferenceTurns === 0) return "inference time not reported by the runtime";
  const split =
    resources.prefillMs === null || resources.generationMs === null
      ? ""
      : ` (${Math.round(resources.prefillMs / 1000)} s reading prompts, ${Math.round(resources.generationMs / 1000)} s writing replies)`;
  const seconds = `${Math.round(resources.inferenceMs / 1000)} s of inference${split}`;
  return resources.inferenceTurns < resources.steps
    ? `${seconds} over the ${resources.inferenceTurns} of ${resources.steps} turn(s) that reported it`
    : seconds;
}

/** What the review did, said as what was executed: a finding stands only on its own check. */
function reviewLine(review: NonNullable<RunReportFile["review"]>): string {
  const ran =
    review.command === null
      ? ""
      : ` (\`${review.command.split("\n")[0]}\` exited ${review.exitCode ?? "without running"}${review.restored ? "; it changed the tree, which was put back" : ""})`;
  switch (review.outcome) {
    case "confirmed":
      return `a finding its own check confirmed, which reopened the work: ${review.finding}${ran}`;
    case "refuted":
      return `a finding its own check refuted: ${review.finding}${ran}`;
    case "no-finding":
      return "no finding";
    case "unusable":
      return `no usable finding${ran}`;
    case "model-error":
      return `not done: ${review.finding}`;
  }
}

/** The patch's files, deletions last so they are not lost in the middle of the list. */
function changedLine(changed: RunReportFile["changed"]): string {
  const ordered = [
    ...changed.filter((one) => one.status !== "deleted"),
    ...changed.filter((one) => one.status === "deleted"),
  ];
  return ordered.map((one) => `${one.path} (${one.status})`).join("; ");
}

/** What was written apart from the change for one requirement, or why nothing was. */
export function authoringLine(one: RunReportFile["authoring"][number]): string {
  const what = [
    ...(one.test === null ? [] : [`a test, run from ${one.test}`]),
    ...(one.claims === 0 ? [] : [`${one.claims} structure claim(s)`]),
  ];
  const kind = one.kind === null ? "" : ` (read as ${one.kind})`;
  if (one.failure !== null) return `none${kind}: ${one.failure}`;
  return what.length === 0
    ? `the task's own version constraints${kind}`
    : `${what.join(" and ")}${kind}, failing at the base, written without seeing the change`;
}

export function renderMarkdown(report: RunReportFile): string {
  return [
    `# swarm run: ${report.state}`,
    "",
    `Task: ${report.task}`,
    "",
    `Model: ${report.model.name} (${report.model.reason}). Stopped: ${report.stop}${report.reason === null ? "" : `, ${report.reason}`}.`,
    "",
    ...requirementTableHeader,
    ...report.requirements.map(requirementRow),
    "",
    ...report.authoring.map(
      (one) => `- Independent checks for ${one.requirement}: ${authoringLine(one)}.`,
    ),
    `- Delivered patch: \`${report.snapshot.patch}\`, sha256 ${report.snapshot.patchSha256}, against base ${report.snapshot.base}.`,
    `- Verification of that patch: ${report.verification}.`,
    ...(report.changed.length === 0 ? [] : [`- Changed: ${changedLine(report.changed)}.`]),
    ...(report.blocked === null ? [] : [`- Blocked: ${report.blocked}.`]),
    ...(report.unchecked === null ? [] : [`- Not checked: ${report.unchecked}.`]),
    `- Starting state: HEAD ${report.startingState.head}${report.startingState.edits.length > 0 ? ` with your uncommitted edits to ${report.startingState.edits.join(", ")}` : ", no uncommitted edits"}.`,
    ...(report.startingState.python === null
      ? []
      : [`- Python environment: ${describePythonEnvironment(report.startingState.python)}.`]),
    `- Applied to the workspace: ${report.delivery.applied ? "yes" : `no, ${report.delivery.reason}`}.`,
    `- Regression: ${report.regression ?? "not measured"}.`,
    `- Execution: ${report.execution ?? "not measured"}.`,
    `- Attestation: ${report.attestation ?? "none"}.`,
    `- Instructions loaded: ${report.instructions.map((one) => `${one.path} (sha256 ${one.sha256})`).join(", ") || "none"}.`,
    `- Resources: ${report.resources.steps} model turn(s); ${report.resources.inputTokens} input and ${report.resources.outputTokens} output token(s)${report.resources.estimatedTurns > 0 ? ` (${report.resources.estimatedTurns} turn(s) estimated from text)` : " (reported by the runtime)"}; ${inferenceOf(report.resources)} and ${Math.round(report.resources.wallMs / 1000)} s of wall time; ${report.resources.retries} retried request(s); ${report.resources.escalations} escalation(s); ${report.resources.verifications} verification(s) in the loop; cost: ${report.resources.cost}.`,
    ...(report.review === null ? [] : [`- Review: ${reviewLine(report.review)}.`]),
    ...report.notes.map((note) => `- Note: ${note}`),
    "",
  ].join("\n");
}
