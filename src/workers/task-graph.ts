import { z } from "zod";
import { normalizePath } from "../gates/file-set.ts";

/** Slug-shaped, because an id names a branch and reaches a report and a ledger record. */
const nodeId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "a node id must be lower-case letters, digits and hyphens");

const taskNodeSchema = z.object({
  id: nodeId,
  title: z.string().min(1),
  /** The prose a worker is handed. What it does with it is measured, not this. */
  instruction: z.string().min(1),
  /** What this node intends to touch, so two nodes that would collide can be told apart. */
  files: z.array(z.string().min(1)).min(1),
  dependsOn: z.array(nodeId).default([]),
  /** Gate ids that must be green. Empty means every blocking gate, which is the default. */
  acceptance: z.array(z.string().min(1)).default([]),
});

const taskGraphSchema = z.object({
  goal: z.string().min(1),
  nodes: z.array(taskNodeSchema).min(1),
});

export type TaskNode = z.infer<typeof taskNodeSchema>;
export type TaskGraph = z.infer<typeof taskGraphSchema>;

export class InvalidTaskGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskGraphError";
  }
}

/**
 * A decomposition is model output, so what can be checked about it is checked here and what
 * cannot is named rather than implied. Checkable: the ids are unique and safe to put in a
 * branch name, every dependency resolves, the graph is acyclic, and every node says what it
 * intends to touch. Not checkable, here or anywhere in this tree: that these nodes add up to
 * the goal. That needs to know what the goal means, which is a judge.
 */
export function readTaskGraph(value: unknown): TaskGraph {
  const parsed = taskGraphSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const at = first === undefined ? "" : ` at ${first.path.join(".") || "the graph"}`;
    // The offending value, not just where it sat: a person editing a graph of twenty nodes
    // needs to know which id was refused, and a path is not a name.
    const found = first === undefined ? undefined : valueAt(value, first.path);
    const quoted = typeof found === "string" ? ` (found "${found}")` : "";
    throw new InvalidTaskGraphError(
      `that is not a task graph${at}: ${first?.message ?? "it does not match the shape"}${quoted}`,
    );
  }

  const graph = {
    goal: parsed.data.goal,
    nodes: parsed.data.nodes.map((node) => ({
      ...node,
      files: [...new Set(node.files.map(normalizePath))].sort(),
    })),
  };

  refuseDuplicateIds(graph);
  refuseUnknownDependencies(graph);
  refuseCycles(graph);
  return graph;
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  return path.reduce<unknown>(
    (found, step) =>
      typeof found === "object" && found !== null
        ? (found as Record<PropertyKey, unknown>)[step]
        : undefined,
    value,
  );
}

function refuseDuplicateIds(graph: TaskGraph): void {
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      throw new InvalidTaskGraphError(
        `two nodes both call themselves "${node.id}": a dependency on it could name either`,
      );
    }
    seen.add(node.id);
  }
}

function refuseUnknownDependencies(graph: TaskGraph): void {
  const known = new Set(graph.nodes.map((node) => node.id));
  for (const node of graph.nodes) {
    for (const dependency of node.dependsOn) {
      if (dependency === node.id) {
        throw new InvalidTaskGraphError(`"${node.id}" depends on itself, so it can never start`);
      }
      if (!known.has(dependency)) {
        throw new InvalidTaskGraphError(
          `"${node.id}" depends on "${dependency}", which the graph never declares`,
        );
      }
    }
  }
}

/** Names the cycle rather than reporting that one exists, so it can be edited. */
function refuseCycles(graph: TaskGraph): void {
  const dependencies = new Map(graph.nodes.map((node) => [node.id, node.dependsOn]));
  const settled = new Set<string>();
  const path: string[] = [];

  function walk(id: string): void {
    if (settled.has(id)) {
      return;
    }
    const at = path.indexOf(id);
    if (at !== -1) {
      throw new InvalidTaskGraphError(
        `these nodes depend on each other in a circle: ${[...path.slice(at), id].join(" -> ")}`,
      );
    }
    path.push(id);
    for (const dependency of dependencies.get(id) ?? []) {
      walk(dependency);
    }
    path.pop();
    settled.add(id);
  }

  for (const node of graph.nodes) {
    walk(node.id);
  }
}

export interface Overlap {
  readonly nodes: readonly [string, string];
  readonly files: readonly string[];
}

/**
 * Pairs of nodes the graph puts in no order that intend to touch the same file. Not an
 * error: the scheduler serializes such a pair in a fixed order and the overlap is recorded.
 * Refusing would be brittle where recording and ordering is correct, and a decomposition
 * that names one shared file is usually right about everything else.
 */
export function overlapsIn(graph: TaskGraph): readonly Overlap[] {
  const reaches = reachability(graph);
  const ordered = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const overlaps: Overlap[] = [];

  for (const [index, left] of ordered.entries()) {
    for (const right of ordered.slice(index + 1)) {
      if (reaches.get(left.id)?.has(right.id) || reaches.get(right.id)?.has(left.id)) {
        continue;
      }
      const shared = left.files.filter((path) => right.files.includes(path));
      if (shared.length > 0) {
        overlaps.push({ nodes: [left.id, right.id], files: shared });
      }
    }
  }

  return overlaps;
}

/** Every node each node depends on, directly or through others. */
function reachability(graph: TaskGraph): ReadonlyMap<string, ReadonlySet<string>> {
  const dependencies = new Map(graph.nodes.map((node) => [node.id, node.dependsOn]));
  const reaches = new Map<string, Set<string>>();

  function walk(id: string): Set<string> {
    const known = reaches.get(id);
    if (known !== undefined) {
      return known;
    }
    const found = new Set<string>();
    reaches.set(id, found);
    for (const dependency of dependencies.get(id) ?? []) {
      found.add(dependency);
      for (const further of walk(dependency)) {
        found.add(further);
      }
    }
    return found;
  }

  for (const node of graph.nodes) {
    walk(node.id);
  }
  return reaches;
}
