import { canonicalJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import {
  idempotencyKeyFor,
  parseTaskContract,
  type TaskContract,
} from "../evidence/task-contract.ts";

export {
  idempotencyKeyFor,
  MalformedTaskContractError,
  parseTaskContract,
  type TaskContract,
} from "../evidence/task-contract.ts";

interface GraphLike {
  readonly nodes: readonly {
    readonly id: string;
    readonly instruction: string;
    readonly dependsOn: readonly string[];
    readonly files: readonly string[];
    readonly acceptance?: readonly string[];
  }[];
}

/** One contract per declared node, so the graph and the envelope cannot describe different runs. */
export function contractsFromGraph(
  graph: GraphLike,
  defaults: {
    readonly maxSteps: number;
    readonly maxTokens?: number;
    readonly network?: TaskContract["network"];
    readonly execution?: "restricted" | "isolated";
    readonly maxWallMs: number;
    readonly immutablePaths: readonly string[];
    readonly allowedTools?: readonly TaskContract["allowedTools"][number][];
    readonly requiredChecks?: readonly string[];
  },
): readonly TaskContract[] {
  return graph.nodes.map((node) =>
    parseTaskContract({
      version: 2,
      taskId: node.id,
      objective: node.instruction,
      dependsOn: [...node.dependsOn],
      allowedPaths: [...node.files],
      immutablePaths: [...defaults.immutablePaths],
      allowedTools: [
        ...(defaults.allowedTools ?? ["read", "write", "edit", "list", "search", "shell"]),
      ],
      network: defaults.network ?? "unrestricted",
      execution: defaults.execution ?? "restricted",
      requiredChecks: [
        ...new Set([...(defaults.requiredChecks ?? []), ...(node.acceptance ?? [])]),
      ],
      budget: {
        maxSteps: defaults.maxSteps,
        maxWallMs: defaults.maxWallMs,
        maxTokens: defaults.maxTokens ?? 200_000,
      },
      // Every node is medium until something measures otherwise. Assuming low is the direction
      // that skips a person, so it is not the direction an unmeasured default goes.
      riskTier: "medium",
      scopeAuthority: "controller",
    }),
  );
}

/**
 * One record per node, on the coordinator's chain beside the graph declaration. The graph says
 * what the nodes are; the contract says what each was allowed to do while doing it, and a
 * reader weighing a node's result needs both.
 */
export async function declareTaskContracts(
  evidence: EvidenceRecorder,
  contracts: readonly TaskContract[],
  baseCommit: string,
): Promise<void> {
  for (const contract of contracts) {
    await evidence.record({
      type: "task-contract",
      actor: "harness",
      // The envelope is the harness's, whoever wrote the graph inside it.
      provenance: ["user"],
      payload: {
        ...JSON.parse(canonicalJson(JSON.parse(JSON.stringify(contract)))),
        idempotencyKey: idempotencyKeyFor(contract, baseCommit),
        baseCommit,
      },
    });
  }
}
