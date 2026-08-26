import type { AttemptSelection } from "./attempt-selector.ts";
import type { QueueLanding } from "./merge-queue.ts";
import type { ParallelRunResult, WorkerResult } from "./parallel-run.ts";

interface ParallelReportContext {
  readonly repositoryRoot: string;
  readonly baseRef: string;
}

const labelWidth = 18;
const shortCommit = 8;

/**
 * What a parallel run did, in the order it happened. The landing column is the only place a
 * result appears: a worker being green means its own gates passed in its own worktree, which
 * is a different statement from its work having landed.
 */
export function renderParallelReport(
  result: ParallelRunResult,
  context: ParallelReportContext,
): readonly string[] {
  const lines = [
    "parallel run",
    field("repository", context.repositoryRoot),
    field("base", `${short(result.baseCommit)} (${context.baseRef})`),
    field("workers", String(result.workers.length)),
    field("integration", result.integrationBranch),
    "",
    "workers",
    ...result.workers.map(describeWorker),
  ];

  if (result.selections.length > 0) {
    lines.push("", "chosen", ...result.selections.map(describeSelection));
  }

  if (result.queue === null) {
    lines.push(
      "",
      "no worker produced anything for the queue: every one of them finished red, so there",
      "was nothing to arbitrate and the integration branch stands at the base.",
    );
    return lines;
  }

  lines.push("", "merge queue", ...result.queue.landings.map(describeLanding));

  for (const rejected of result.queue.landings.filter((one) => !one.landed)) {
    lines.push("", `returned to ${rejected.workerId}`, ...indent(rejected.feedback));
  }

  if (result.sweptBranches.length > 0) {
    lines.push(
      "",
      `removed ${result.sweptBranches.length} worker branch(es) the queue was finished with. ` +
        `${result.integrationBranch} is not one of them.`,
    );
  }

  lines.push(
    "",
    `nothing was merged into the branch you are on. The result is on ${result.integrationBranch},`,
    `at ${short(result.headCommit)}. To take it:`,
    `  git merge ${result.integrationBranch}`,
  );
  return lines;
}

/**
 * Why each task proposed what it did. The abstentions are on the line for the same reason
 * the ratchet names its own: a dimension nothing measured has to say so, or a ranking made
 * without it reads as a ranking that considered it.
 */
function describeSelection(selection: AttemptSelection): string {
  const head = `  ${selection.taskId.padEnd(10)}`;
  if (selection.winner === null) {
    return `${head}chose nothing: no attempt was eligible`;
  }
  const on =
    selection.decidedBy === null
      ? "on nothing that separated them, so the earliest"
      : `on ${selection.decidedBy}`;
  const line = `${head}${selection.winner} of ${selection.attempts.length}, ${on}`;
  if (selection.abstentions.length === 0) {
    return line;
  }
  const named = selection.abstentions.map((one) => one.dimension).join(", ");
  return `${line}\n${" ".repeat(12)}not measured by any attempt: ${named}`;
}

function describeWorker(worker: WorkerResult): string {
  const declared =
    worker.declaredFiles.length === 0 ? "nothing declared" : worker.declaredFiles.join(", ");
  return (
    `  ${worker.workerId.padEnd(10)}${(worker.green ? "green" : "red").padEnd(8)}` +
    `${worker.task}\n${" ".repeat(20)}${worker.detail}\n${" ".repeat(20)}${declared}`
  );
}

function describeLanding(landing: QueueLanding, index: number): string {
  const outcome = landing.landed ? "landed" : "rejected";
  const detail = landing.landed ? `at ${short(landing.commit ?? "")}` : (landing.reason ?? "");
  return `  ${String(index + 1).padEnd(4)}${outcome.padEnd(10)}${landing.workerId.padEnd(12)}${detail}`;
}

function indent(text: string): readonly string[] {
  return text.split("\n").map((line) => `  ${line}`);
}

function short(commit: string): string {
  return commit.slice(0, shortCommit);
}

function field(label: string, value: string): string {
  return `  ${label.padEnd(labelWidth)}${value}`;
}
