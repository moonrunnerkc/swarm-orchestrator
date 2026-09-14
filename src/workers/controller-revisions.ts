import { asJsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
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
