import type { TaskGraph } from "./task-graph.ts";

/**
 * The graph in the order it can be run: each layer dispatched together, landed, and only
 * then the next, because a node that depends on another has to branch from a tree that
 * already holds it.
 *
 * Two nodes the graph puts in no order but that intend the same file are put in different
 * layers, lower id first. This is done by holding one back rather than by adding an edge to
 * the graph: an edge for every such pair can close a circle with dependencies that were
 * already there, and a scheduler that can deadlock over a shared file is worse than one that
 * runs the pair one after the other.
 *
 * Layers serialize dispatch, so a chain five deep is five rounds however high the
 * concurrency. A graph buys parallelism at its width, not its depth.
 */
export function scheduleLayers(graph: TaskGraph): readonly (readonly string[])[] {
  const remaining = new Map(graph.nodes.map((node) => [node.id, node]));
  const landed = new Set<string>();
  const layers: string[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.dependsOn.every((dependency) => landed.has(dependency)))
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    const layer: string[] = [];
    const claimed = new Set<string>();
    for (const node of ready) {
      if (node.files.some((path) => claimed.has(path))) {
        continue;
      }
      for (const path of node.files) {
        claimed.add(path);
      }
      layer.push(node.id);
    }

    layers.push(layer);
    for (const id of layer) {
      remaining.delete(id);
      landed.add(id);
    }
  }

  return layers;
}

/**
 * Everything downstream of a node that did not land, so it is recorded as blocked rather
 * than run against a tree that lacks what it was built on. A subtree nobody can satisfy
 * costs a full fan-out per layer if it is dispatched anyway.
 */
export function blockedBy(graph: TaskGraph, notLanded: ReadonlySet<string>): readonly string[] {
  const blocked = new Set<string>();
  let growing = true;

  while (growing) {
    growing = false;
    for (const node of graph.nodes) {
      if (blocked.has(node.id) || notLanded.has(node.id)) {
        continue;
      }
      if (node.dependsOn.some((one) => notLanded.has(one) || blocked.has(one))) {
        blocked.add(node.id);
        growing = true;
      }
    }
  }

  return [...blocked].sort();
}
