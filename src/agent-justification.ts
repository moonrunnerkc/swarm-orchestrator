import { type AgentLoopOutcome, runAgentLoop } from "./core/loop.ts";
import type { GateCycle } from "./gates/gate-runner.ts";
import type { ChangedFile } from "./gates/workspace-changes.ts";

type GateRun = GateCycle["runs"][number];

/**
 * The brief for the one turn a run gets to answer an advisory demand for justification. The
 * work is finished and every blocking gate has passed; the only tool offered is `claim`, so the
 * turn cannot change the tree the gates judged, and an answer cannot widen the files the run
 * may touch or stand in for a blocking check. Declining is a legitimate answer: the run is then
 * refused for the demand, by name.
 */
export function describeJustificationRequest(input: {
  readonly task: string;
  readonly demands: readonly GateRun[];
  readonly changes: readonly ChangedFile[];
}): string {
  const files = input.changes
    .map((file) => `  ${file.path}: ${file.addedLines.length} added line(s)`)
    .join("\n");
  return [
    `The task was: ${input.task}`,
    "",
    "The change is finished and every blocking gate passed. Before it can be accepted, an",
    "advisory gate asks for a justification:",
    ...input.demands.map(
      (run) =>
        `- ${run.gateId}: ${run.detail}\n  evidence record ${run.record}, kind gate-run:${run.gateId}`,
    ),
    "",
    "The change, by file:",
    files.length === 0 ? "  (no changed files could be read)" : files,
    "",
    "If the task needs a change this size, call the claim tool once per gate above, with that",
    `record, its kind, the predicate status == "failed", and a narrative telling a reviewer why`,
    "the task needs it (which file holds the size and what produced it). If it does not, reply",
    "without a claim and say what should be smaller; the run is then refused for this gate.",
    "You cannot edit files now, and a justification does not override a blocking gate or widen",
    "the files this run may touch. Reply with a one-line summary and no tool calls when done.",
  ].join("\n");
}

/** One bounded loop over a claim-only toolset; the caller accounts its spend and records its stop. */
export function runJustificationTurn(
  brief: string,
  demands: number,
  dependencies: Parameters<typeof runAgentLoop>[1],
): Promise<AgentLoopOutcome> {
  // A claim per demand and a closing summary, with one step of slack for a malformed call.
  const steps = Math.min(dependencies.budget.maxSteps, demands + 2);
  return runAgentLoop(brief, {
    ...dependencies,
    budget: { ...dependencies.budget, maxSteps: steps },
  });
}
