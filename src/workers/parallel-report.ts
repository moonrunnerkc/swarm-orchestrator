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

  lines.push(
    "",
    `nothing was merged into the branch you are on. The result is on ${result.integrationBranch},`,
    `at ${short(result.headCommit)}. To take it:`,
    `  git merge ${result.integrationBranch}`,
  );
  return lines;
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
