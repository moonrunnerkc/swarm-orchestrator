import { asJsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { parseTaskContract } from "../evidence/task-contract.ts";
import { appendControllerRecord, replayController } from "./controller-state.ts";
import { coordinationEvents } from "./coordination.ts";
import { type ControllerGraph, type RevisionOperation, reviseGraph } from "./graph-revision.ts";
import type { TrailPeer } from "./trail.ts";

export interface RevisionRequest {
  readonly operation: RevisionOperation;
  readonly reason: string;
}

export async function applyControllerRevision(
  evidence: EvidenceRecorder,
  request: RevisionRequest,
  author: ControllerGraph["author"],
): Promise<ControllerGraph> {
  const board = replayController(evidence);
  if (board.graph === null) throw new Error("declare a controller graph before revising work");
  const revised = reviseGraph(board.graph, request.operation, board.states, request.reason, author);
  await appendControllerRecord(evidence, "controller-graph", asJsonValue(revised));
  return revised;
}

/** Proposals can change bounded scheduling decisions, never the truth of a worker's observations. */
export async function consumeCoordination(options: {
  evidence: EvidenceRecorder;
  peers: readonly TrailPeer[];
  adaptation: boolean;
}): Promise<void> {
  const consumed = new Set(
    options.evidence
      .records()
      .filter((record) => record.type === "controller-transition")
      .map((record) => options.evidence.payloads().get(record.payloadDigest))
      .filter(
        (payload) =>
          payload !== null &&
          typeof payload === "object" &&
          "kind" in payload &&
          payload.kind === "coordination-consumed",
      )
      .map((payload) =>
        payload !== null && typeof payload === "object" && "source" in payload
          ? payload.source
          : null,
      ),
  );
  for (const peer of options.peers) {
    for (const observed of coordinationEvents(peer)) {
      const source = `${peer.chain.sessionId}:${observed.sequence}:${observed.digest}`;
      if (consumed.has(source)) continue;
      const proposal = observed.event.proposal;
      const board = replayController(options.evidence);
      const graph = board.graph;
      if (graph === null) throw new Error("coordination precedes the graph");
      const findId = (id: string) =>
        graph.nodes.find((node) => node.id === id || node.contract.taskId === id)?.id ?? id;
      const operation =
        proposal.kind === "dependency-request"
          ? {
              kind: "add-prerequisite" as const,
              taskId: peer.taskId,
              prerequisite: findId(proposal.prerequisite),
            }
          : proposal.kind === "repair-request"
            ? proposal.revision
            : undefined;
      if (
        operation?.kind === "combine" &&
        operation.tasks.some((id) =>
          ["running", "candidate"].includes(board.states.get(id) ?? "pending"),
        )
      )
        continue;
      let disposition: "applied" | "refused" | "observed" = "observed";
      let reason = "untrusted peer proposal retained; no acceptance or permission granted";
      if (operation !== undefined) {
        if (!options.adaptation) {
          disposition = "refused";
          reason = "adaptive revisions disabled by the declared comparison policy";
        } else {
          // Compute separately from append: an evidence failure must abort, not become a refused proposal.
          let revised: ControllerGraph | undefined;
          try {
            revised = reviseGraph(
              graph,
              operation,
              board.states,
              proposal.kind === "dependency-request"
                ? proposal.reason
                : proposal.kind === "repair-request"
                  ? proposal.summary
                  : "coordination proposal",
              "model",
            );
          } catch (cause) {
            disposition = "refused";
            reason = cause instanceof Error ? cause.message : String(cause);
          }
          if (revised !== undefined) {
            await appendControllerRecord(
              options.evidence,
              "controller-graph",
              asJsonValue(revised),
            );
            disposition = "applied";
            reason = `bounded scheduling revision ${revised.revision}; proposal remains untrusted`;
          }
        }
      }
      await appendControllerRecord(options.evidence, "controller-transition", {
        kind: "coordination-consumed",
        source,
        sourceSession: peer.chain.sessionId,
        sourceSequence: observed.sequence,
        sourceDigest: observed.digest,
        event: asJsonValue(observed.event),
        disposition,
        reason,
      });
      consumed.add(source);
    }
  }
}

/** Whole-goal alternatives must satisfy one complete contract before their objective can rank them. */
export async function coalesceGoalAlternatives(
  evidence: EvidenceRecorder,
  objective: string,
): Promise<void> {
  const board = replayController(evidence);
  if (board.graph === null || board.graph.nodes.length < 2) return;
  if (board.dispatches.size > 0)
    throw new Error("whole-goal alternatives must be declared before dispatch");
  const originals = board.graph.nodes;
  const first = originals[0];
  if (first === undefined) throw new Error("whole-goal alternatives have no original task");
  let identity = "complete-goal";
  let suffix = 0;
  while (originals.some((node) => node.id === identity) || board.graph.retired.includes(identity))
    identity = `complete-goal-${++suffix}`;
  const workspaceScope = originals.some((node) => node.contract.scopeKind === "workspace");
  const contract = parseTaskContract({
    ...first.contract,
    taskId: identity,
    objective: `${objective}\n\nRequired implementation work:\n${originals.map((node) => `${node.contract.taskId}: ${node.contract.objective}`).join("\n")}`,
    dependsOn: [],
    scopeKind: workspaceScope ? "workspace" : "files",
    scopeAuthority: workspaceScope ? "human" : first.contract.scopeAuthority,
    allowedPaths: workspaceScope
      ? ["**"]
      : [...new Set(originals.flatMap((node) => node.contract.allowedPaths))],
    immutablePaths: [...new Set(originals.flatMap((node) => node.contract.immutablePaths))],
    requiredChecks: [...new Set(originals.flatMap((node) => node.contract.requiredChecks))],
    allowedTools: first.contract.allowedTools.filter((tool) =>
      originals.every((node) => node.contract.allowedTools.includes(tool)),
    ),
  });
  await applyControllerRevision(
    evidence,
    {
      operation: {
        kind: "combine",
        tasks: originals.map((node) => node.id),
        combined: {
          id: identity,
          contract,
          dependsOn: [],
          obligations: [...board.graph.obligations],
        },
      },
      reason:
        "complete-goal alternatives share every original obligation and compete only after independent goal acceptance",
    },
    "harness",
  );
}
