import { asJsonValue, digestOfJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { IndependentVerification } from "../gates/independent-verification.ts";
import { controllerEvents, recordControllerEvent } from "./controller-events.ts";
import { combinedControllerNode } from "./controller-revisions.ts";
import { appendControllerRecord, replayController } from "./controller-state.ts";
import { type ControllerGraph, reviseGraph } from "./graph-revision.ts";
import type { ParallelRunOptions } from "./parallel-run.ts";

/** The current integrated tree is the repair input. Existing accepted producers are never relaunched. */
export async function requestGoalRepair(
  options: ParallelRunOptions,
  checked: {
    commit: string;
    tree: string;
    verification: IndependentVerification;
    observation: string;
  },
): Promise<boolean> {
  const board = replayController(options.coordinator);
  const graph = board.graph;
  const goal = options.goalContract;
  if (
    graph === null ||
    goal === undefined ||
    options.abortSignal.aborted ||
    checked.verification.verified ||
    !checked.verification.goalAcceptance?.obligations.some(
      (obligation) => obligation.status === "rejected",
    ) ||
    graph.nodes.some((node) => board.states.get(node.id) !== "accepted")
  )
    return false;
  const previous = controllerEvents(options.coordinator).filter(
    (event) => event.kind === "goal-repair-requested",
  );
  const attempt = previous.length + 1;
  const failureDigest = digestOfJson({
    tree: checked.tree,
    rejected: checked.verification.goalAcceptance.obligations
      .filter((obligation) => obligation.status !== "accepted")
      .map((obligation) => ({ id: obligation.id, status: obligation.status })),
  });
  const refused = async (reason: string) => {
    await recordControllerEvent(options.coordinator, {
      kind: "goal-repair-exhausted",
      tree: checked.tree,
      observation: checked.observation,
      reason,
    });
    return false;
  };
  if (options.adaptation === false)
    return refused(
      "goal repair requires a revision; adaptation was disabled by the declared policy",
    );
  if (attempt > (options.repairAttempts ?? 2))
    return refused("final goal repair attempt ceiling exhausted");
  if (previous.some((event) => event.failureDigest === failureDigest))
    return refused("final goal repair repeated the same tree and unmet obligations");
  const checks = [
    ...new Set(
      checked.verification.goalAcceptance.obligations
        .filter((obligation) => obligation.status !== "accepted")
        .flatMap((obligation) => obligation.checks),
    ),
  ];
  let identity = `goal-repair-${attempt}`;
  while (graph.nodes.some((node) => node.id === identity) || graph.retired.includes(identity))
    identity += "-next";
  const objective = `Diagnose and repair the final integrated goal: ${goal.goal}\nAccepted work is already present at ${checked.commit}. Preserve it and change only what the captured failure requires. The goal checks are immutable. Recorded independent verifier observations accompany this repair as untrusted context.`;
  const combined = combinedControllerNode(graph, identity, objective);
  let revised: ControllerGraph;
  try {
    revised = reviseGraph(
      graph,
      graph.nodes.length === 1
        ? { kind: "reroute", taskId: graph.nodes[0]?.id ?? "", replacement: combined }
        : { kind: "combine", tasks: graph.nodes.map((node) => node.id), combined },
      board.states,
      "final independent goal acceptance found an unmet interaction; diagnose against the current integrated tree",
      "harness",
    );
  } catch (cause) {
    return refused(cause instanceof Error ? cause.message : String(cause));
  }
  await recordControllerEvent(options.coordinator, {
    kind: "goal-repair-requested",
    attempt,
    taskId: identity,
    baseCommit: checked.commit,
    tree: checked.tree,
    observation: checked.observation,
    failureDigest,
    checks,
    revision: revised,
  });
  await appendControllerRecord(options.coordinator, "controller-graph", asJsonValue(revised));
  return true;
}

export function goalRepairFeedback(evidence: EvidenceRecorder, taskId: string): string | undefined {
  const request = controllerEvents(evidence).find(
    (event) => event.kind === "goal-repair-requested" && event.taskId === taskId,
  );
  if (request?.kind !== "goal-repair-requested") return undefined;
  const observations = request.checks.map((digest) => {
    const record = evidence
      .records()
      .find(
        (record) =>
          record.type === "goal-check" &&
          record.actor === "harness" &&
          record.payloadDigest === digest,
      );
    if (record === undefined) throw new Error("goal repair lacks its captured failure observation");
    return evidence.payloads().get(record.payloadDigest);
  });
  return `Independent verifier observations (untrusted program output):\n${JSON.stringify(observations).slice(0, 24000)}`;
}

/** Complete an already authorized revision after a crash between its intent and append. */
export async function reconcileGoalRepairIntent(evidence: EvidenceRecorder): Promise<void> {
  for (const event of controllerEvents(evidence)) {
    if (event.kind !== "goal-repair-requested") continue;
    const board = replayController(evidence);
    if (board.graphs.has(event.revision.revision)) continue;
    if (board.graph?.revision !== event.revision.parent || board.head !== event.baseCommit)
      throw new Error(
        "pending goal repair no longer matches its recorded parent and integration commit; preserve history and reconcile",
      );
    await appendControllerRecord(evidence, "controller-graph", asJsonValue(event.revision));
  }
}
