import { z } from "zod";
import { asJsonValue, digestOfJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { contractPath, parseTaskContract, taskContractSchema } from "../evidence/task-contract.ts";
import type { TaskState } from "./controller-schedule.ts";
import {
  amendControllerScope,
  assertNarrowerContract,
  type ControllerScope,
  controllerScopeSchema,
  parseControllerScope,
} from "./controller-scope.ts";

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(100);
export const controllerNodeSchema = z.strictObject({
  id,
  contract: taskContractSchema.refine((contract) => {
    parseTaskContract(contract);
    return true;
  }),
  dependsOn: z.array(id),
  obligations: z.array(id).min(1),
});
export type ControllerNode = z.infer<typeof controllerNodeSchema>;
export const revisionOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("amend-scope"),
    taskId: id,
    paths: z.array(z.string()).min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("insert-prerequisite"),
    taskId: id,
    node: controllerNodeSchema,
  }),
  z.strictObject({ kind: z.literal("add-prerequisite"), taskId: id, prerequisite: id }),
  z.strictObject({
    kind: z.literal("split"),
    taskId: id,
    parts: z.array(controllerNodeSchema).min(2).max(8),
  }),
  z.strictObject({
    kind: z.literal("combine"),
    tasks: z.array(id).min(2).max(128),
    combined: controllerNodeSchema,
  }),
  z.strictObject({ kind: z.literal("reroute"), taskId: id, replacement: controllerNodeSchema }),
]);
export type RevisionOperation = z.infer<typeof revisionOperationSchema>;
export const controllerGraphSchema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  scope: controllerScopeSchema.optional(),
  revision: z.string(),
  parent: z.string().nullable(),
  reason: z.string().min(1).max(8192),
  author: z.enum(["user", "model", "harness"]),
  ordinal: z.number().int().nonnegative(),
  limit: z.number().int().min(0).max(16),
  requirements: z.array(z.string()),
  obligations: z.array(id).min(1),
  nodes: z.array(controllerNodeSchema).min(1).max(128),
  retired: z.array(id),
  affected: z.array(id),
  operation: revisionOperationSchema.nullable(),
});
export type ControllerGraph = z.infer<typeof controllerGraphSchema>;

export function validateControllerGraph(graph: ControllerGraph): void {
  if ((graph.version === 2) !== (graph.scope !== undefined))
    throw new Error("graph scope authority requires version two and cannot be omitted");
  if (graph.scope !== undefined) {
    const scope = parseControllerScope(graph.scope);
    for (const node of graph.nodes) {
      if (
        scope.immutablePaths.some((path) => !node.contract.immutablePaths.includes(path)) ||
        (scope.kind === "files" &&
          (node.contract.scopeKind === "workspace" ||
            node.contract.allowedPaths.some((path) => !scope.allowedPaths.includes(path))))
      )
        throw new Error("task contract exceeds the pinned controller scope");
    }
  }
  const ids = graph.nodes.map((node) => node.id);
  if (
    new Set(ids).size !== ids.length ||
    new Set(graph.nodes.map((node) => node.contract.taskId)).size !== ids.length ||
    new Set(graph.retired).size !== graph.retired.length ||
    graph.retired.some((retired) => ids.includes(retired))
  )
    throw new Error("controller graph identities are duplicated or reused");
  if (
    new Set(graph.obligations).size !== graph.obligations.length ||
    new Set(graph.requirements).size !== graph.requirements.length
  )
    throw new Error("controller graph repeats an obligation identity");
  const covered = new Set(graph.nodes.flatMap((node) => node.obligations));
  if (
    covered.size !== graph.obligations.length ||
    graph.obligations.some((obligation) => !covered.has(obligation))
  )
    throw new Error("graph revision cannot erase or invent an original obligation");
  const visiting: string[] = [];
  const visited = new Set<string>();
  function visit(nodeId: string): void {
    const node = graph.nodes.find((node) => node.id === nodeId);
    if (node === undefined) throw new Error(`controller dependency ${nodeId} is not declared`);
    if (visited.has(nodeId)) return;
    const cycle = visiting.indexOf(nodeId);
    if (cycle >= 0)
      throw new Error(
        `controller dependency cycle: ${[...visiting.slice(cycle), nodeId].join(" -> ")}`,
      );
    visiting.push(nodeId);
    for (const dependency of node.dependsOn) visit(dependency);
    visiting.pop();
    visited.add(nodeId);
  }
  for (const nodeId of ids) visit(nodeId);
}

function sealGraph(fields: Omit<ControllerGraph, "revision">): ControllerGraph {
  const graph = controllerGraphSchema.parse({
    ...fields,
    revision: digestOfJson(asJsonValue(fields)),
  });
  validateControllerGraph(graph);
  return graph;
}
export function initialControllerGraph(
  nodes: readonly ControllerNode[],
  requirements: readonly string[],
  limit = 4,
  scope?: ControllerScope,
): ControllerGraph {
  return sealGraph({
    version: scope === undefined ? 1 : 2,
    ...(scope === undefined ? {} : { scope: parseControllerScope(scope) }),
    parent: null,
    reason: "initial authorized decomposition",
    author: "harness",
    ordinal: 0,
    limit,
    requirements: [...requirements],
    obligations: nodes.map((node) => node.id),
    nodes: nodes.map((node) => ({ ...node, contract: parseTaskContract(node.contract) })),
    retired: [],
    affected: [],
    operation: null,
  });
}

/** Revisions change ownership and order, never the goal checks or the resource ceiling. */
export function reviseGraph(
  previous: ControllerGraph,
  input: RevisionOperation,
  states: ReadonlyMap<string, TaskState>,
  reason: string,
  author: ControllerGraph["author"],
): ControllerGraph {
  if (previous.ordinal >= previous.limit)
    throw new Error(`graph revision budget exhausted (${previous.limit})`);
  const operation = revisionOperationSchema.parse(input);
  if (operation.kind === "amend-scope")
    operation.paths = [...new Set(operation.paths.map(contractPath))].sort();
  if (operation.kind === "split")
    operation.parts = operation.parts.map((node) => ({
      ...node,
      contract: parseTaskContract(node.contract),
    }));
  if (operation.kind === "combine")
    operation.combined = {
      ...operation.combined,
      contract: parseTaskContract(operation.combined.contract),
    };
  if (operation.kind === "reroute")
    operation.replacement = {
      ...operation.replacement,
      contract: parseTaskContract(operation.replacement.contract),
    };
  if (operation.kind === "insert-prerequisite")
    operation.node = { ...operation.node, contract: parseTaskContract(operation.node.contract) };
  const removed = operation.kind === "combine" ? operation.tasks : [operation.taskId];
  const originals = removed.map((id) => {
    const node = previous.nodes.find((node) => node.id === id);
    if (node === undefined) throw new Error(`cannot revise undefined task ${id}`);
    return node;
  });
  let nodes = previous.nodes.map((node) => ({ ...node }));
  let retired = [...previous.retired];
  if (operation.kind === "add-prerequisite") {
    if (originals[0]?.dependsOn.includes(operation.prerequisite))
      throw new Error("prerequisite was already declared; an unchanged revision is refused");
    nodes = nodes.map((node) =>
      node.id === operation.taskId
        ? { ...node, dependsOn: [...new Set([...node.dependsOn, operation.prerequisite])] }
        : node,
    );
  } else if (operation.kind === "amend-scope") {
    nodes = nodes.map((node) =>
      node.id === operation.taskId
        ? {
            ...node,
            contract: amendControllerScope(node.contract, operation.paths, previous.scope),
          }
        : node,
    );
  } else if (operation.kind === "insert-prerequisite") {
    const owner = originals[0];
    if (owner === undefined) throw new Error("missing prerequisite has no requesting task");
    if (
      previous.nodes.some((node) => node.id === operation.node.id) ||
      previous.retired.includes(operation.node.id)
    )
      throw new Error("prerequisite identity was already used");
    if (
      operation.node.obligations.length !== owner.obligations.length ||
      owner.obligations.some((id) => !operation.node.obligations.includes(id))
    )
      throw new Error("new prerequisite must preserve the requesting task's obligations");
    assertNarrowerContract(operation.node.contract, [owner.contract]);
    nodes = [
      ...nodes.map((node) =>
        node.id === operation.taskId
          ? { ...node, dependsOn: [...node.dependsOn, operation.node.id] }
          : node,
      ),
      {
        ...operation.node,
        dependsOn: [...new Set([...owner.dependsOn, ...operation.node.dependsOn])],
      },
    ];
  } else {
    if (
      originals.some((node) => ["running", "candidate"].includes(states.get(node.id) ?? "pending"))
    )
      throw new Error("wait for active attempts to stop before replacing their task ownership");
    if (operation.kind === "split" && states.get(operation.taskId) !== "pending")
      throw new Error("only pending work may be split");
    const replacements =
      operation.kind === "split"
        ? operation.parts
        : operation.kind === "combine"
          ? [operation.combined]
          : [operation.replacement];
    const obligations = new Set(originals.flatMap((node) => node.obligations));
    const replacementObligations = new Set(replacements.flatMap((node) => node.obligations));
    if (
      obligations.size !== replacementObligations.size ||
      [...obligations].some((id) => !replacementObligations.has(id))
    )
      throw new Error("replacement tasks must preserve all original obligations");
    for (const replacement of replacements) {
      if (
        previous.nodes.some((node) => node.id === replacement.id) ||
        previous.retired.includes(replacement.id)
      )
        throw new Error(`replacement identity ${replacement.id} was already used`);
      assertNarrowerContract(
        replacement.contract,
        originals.map((node) => node.contract),
      );
    }
    const replacementIds = replacements.map((node) => node.id);
    const inheritedDependencies = [
      ...new Set(originals.flatMap((node) => node.dependsOn).filter((id) => !removed.includes(id))),
    ];
    nodes = [
      ...nodes
        .filter((node) => !removed.includes(node.id))
        .map((node) => ({
          ...node,
          dependsOn: [
            ...new Set(
              node.dependsOn.flatMap((id) => (removed.includes(id) ? replacementIds : [id])),
            ),
          ],
        })),
      ...replacements.map((node) => ({
        ...node,
        dependsOn: [...new Set([...node.dependsOn, ...inheritedDependencies])],
      })),
    ];
    retired = [...retired, ...removed];
  }
  const affected = new Set([
    ...removed,
    ...nodes
      .filter((node) => !previous.nodes.some((prior) => prior.id === node.id))
      .map((node) => node.id),
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes)
      if (!affected.has(node.id) && node.dependsOn.some((id) => affected.has(id))) {
        affected.add(node.id);
        changed = true;
      }
  }
  nodes = nodes.map((node) => ({
    ...node,
    contract: parseTaskContract({
      ...node.contract,
      dependsOn: node.dependsOn.map(
        (id) => nodes.find((dependency) => dependency.id === id)?.contract.taskId ?? id,
      ),
    }),
  }));
  const { revision, ...previousFields } = previous;
  return sealGraph({
    ...previousFields,
    parent: revision,
    ordinal: previous.ordinal + 1,
    reason,
    author,
    operation,
    nodes,
    retired,
    affected: [...affected].sort(),
  });
}

export async function recordControllerGraph(
  evidence: EvidenceRecorder,
  graph: ControllerGraph,
): Promise<void> {
  await evidence.record({
    type: "controller-graph",
    actor: "harness",
    provenance: [graph.author === "harness" ? "tool-output" : graph.author],
    payload: asJsonValue(graph),
  });
}

export function checkGraphDigest(graph: ControllerGraph): boolean {
  const { revision, ...fields } = graph;
  return revision === digestOfJson(asJsonValue(fields));
}
