import { asJsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { parseTaskContract } from "../evidence/task-contract.ts";
import { appendControllerRecord, replayController } from "./controller-state.ts";
import { coordinationEvents } from "./coordination.ts";
import {
  type ControllerGraph,
  type ControllerNode,
  type RevisionOperation,
  reviseGraph,
} from "./graph-revision.ts";
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
      const explicit = proposal.kind === "repair-request" ? proposal.revision : undefined;
      if (
        explicit?.kind === "combine" &&
        explicit.tasks.some((id) =>
          ["running", "candidate"].includes(board.states.get(id) ?? "pending"),
        )
      )
        continue;
      let disposition: "applied" | "refused" | "observed" = "observed";
      let reason = "untrusted peer proposal retained; no acceptance or permission granted";
      if (proposal.kind === "dependency-request" || explicit !== undefined) {
        if (!options.adaptation) {
          disposition = "refused";
          reason = "adaptive revisions disabled by the declared comparison policy";
        } else {
          const revisions: ControllerGraph[] = [];
          try {
            const operations: RevisionOperation[] = [];
            if (proposal.kind === "dependency-request") {
              if (proposal.missing === undefined)
                operations.push({
                  kind: "add-prerequisite",
                  taskId: peer.taskId,
                  prerequisite: findId(proposal.prerequisite),
                });
              else {
                const owner = graph.nodes.find((node) => node.id === peer.taskId);
                if (owner === undefined)
                  throw new Error("missing prerequisite requester is no longer a current task");
                const prerequisite = parseTaskContract({
                  ...owner.contract,
                  taskId: proposal.prerequisite,
                  objective: proposal.missing.instruction,
                  scopeKind: "files",
                  dependsOn: [],
                  allowedPaths: proposal.missing.files,
                });
                const additions = prerequisite.allowedPaths.filter(
                  (path) => !owner.contract.allowedPaths.includes(path),
                );
                if (owner.contract.scopeKind !== "workspace" && additions.length > 0)
                  operations.push({ kind: "amend-scope", taskId: owner.id, paths: additions });
                operations.push({
                  kind: "insert-prerequisite",
                  taskId: owner.id,
                  node: {
                    id: proposal.prerequisite,
                    contract: prerequisite,
                    dependsOn: [],
                    obligations: [...owner.obligations],
                  },
                });
              }
            } else if (explicit !== undefined) operations.push(explicit);
            let parent = graph;
            for (const operation of operations) {
              parent = reviseGraph(
                parent,
                operation,
                board.states,
                proposal.kind === "dependency-request"
                  ? proposal.reason
                  : proposal.kind === "repair-request"
                    ? proposal.summary
                    : "coordination proposal",
                "model",
              );
              revisions.push(parent);
            }
          } catch (cause) {
            revisions.length = 0;
            disposition = "refused";
            reason = cause instanceof Error ? cause.message : String(cause);
          }
          // Preflight the complete proposal. A failed evidence append aborts rather than becoming a refusal.
          for (const revised of revisions)
            await appendControllerRecord(
              options.evidence,
              "controller-graph",
              asJsonValue(revised),
            );
          if (revisions.length > 0) {
            disposition = "applied";
            reason = `bounded scheduling revision ${revisions.at(-1)?.revision}; proposal remains untrusted`;
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
  let identity = "complete-goal";
  let suffix = 0;
  while (
    board.graph.nodes.some((node) => node.id === identity) ||
    board.graph.retired.includes(identity)
  )
    identity = `complete-goal-${++suffix}`;
  const combined = combinedControllerNode(board.graph, identity, objective);
  await applyControllerRevision(
    evidence,
    {
      operation: {
        kind: "combine",
        tasks: board.graph.nodes.map((node) => node.id),
        combined,
      },
      reason:
        "complete-goal alternatives share every original obligation and compete only after independent goal acceptance",
    },
    "harness",
  );
}

export function combinedControllerNode(
  graph: ControllerGraph,
  identity: string,
  objective: string,
): ControllerNode {
  const originals = graph.nodes;
  const first = originals[0];
  if (first === undefined) throw new Error("whole-goal alternatives have no original task");
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
  return { id: identity, contract, dependsOn: [], obligations: [...graph.obligations] };
}
