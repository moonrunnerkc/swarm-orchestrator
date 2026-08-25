import { describe, expect, it } from "vitest";
import { blockedBy, scheduleLayers } from "./schedule.ts";
import { readTaskGraph } from "./task-graph.ts";

function node(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `do ${id}`,
    instruction: `do the ${id} part`,
    files: [`src/${id}.ts`],
    dependsOn: [],
    acceptance: [],
    ...overrides,
  };
}

function graph(nodes: readonly Record<string, unknown>[]) {
  return readTaskGraph({ goal: "make the thing", nodes });
}

describe("scheduling a task graph into layers", () => {
  it("runs independent nodes that touch different files together", () => {
    expect(scheduleLayers(graph([node("parser"), node("printer")]))).toEqual([
      ["parser", "printer"],
    ]);
  });

  it("puts a node after what it depends on", () => {
    const ordered = graph([node("parser"), node("printer", { dependsOn: ["parser"] })]);

    expect(scheduleLayers(ordered)).toEqual([["parser"], ["printer"]]);
  });

  it("separates two independent nodes that would touch the same file", () => {
    const colliding = graph([
      node("printer", { files: ["src/shared.ts"] }),
      node("parser", { files: ["src/shared.ts"] }),
    ]);

    expect(scheduleLayers(colliding)).toEqual([["parser"], ["printer"]]);
  });

  it("keeps a node that collides with one of a pair beside the other", () => {
    const mixed = graph([
      node("a", { files: ["src/shared.ts"] }),
      node("b", { files: ["src/shared.ts"] }),
      node("c", { files: ["src/c.ts"] }),
    ]);

    expect(scheduleLayers(mixed)).toEqual([["a", "c"], ["b"]]);
  });

  it("walks a chain one node at a time", () => {
    const chain = graph([
      node("a"),
      node("b", { dependsOn: ["a"] }),
      node("c", { dependsOn: ["b"] }),
    ]);

    expect(scheduleLayers(chain)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("brings a diamond back together in one layer", () => {
    const diamond = graph([
      node("a"),
      node("b", { dependsOn: ["a"] }),
      node("c", { dependsOn: ["a"] }),
      node("d", { dependsOn: ["b", "c"] }),
    ]);

    expect(scheduleLayers(diamond)).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("schedules the same however the nodes are written down", () => {
    const nodes = [node("a"), node("b", { dependsOn: ["a"] }), node("c", { files: ["src/a.ts"] })];
    const forwards = scheduleLayers(graph(nodes));
    const backwards = scheduleLayers(graph([...nodes].reverse()));

    expect(backwards).toEqual(forwards);
  });

  it("schedules every node exactly once", () => {
    const many = graph([
      node("a", { files: ["src/shared.ts"] }),
      node("b", { files: ["src/shared.ts"] }),
      node("c", { files: ["src/shared.ts"], dependsOn: ["a"] }),
      node("d"),
    ]);

    expect(scheduleLayers(many).flat().sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("what a node that did not land takes with it", () => {
  it("blocks the nodes that depend on it", () => {
    const chain = graph([
      node("a"),
      node("b", { dependsOn: ["a"] }),
      node("c", { dependsOn: ["b"] }),
      node("d"),
    ]);

    expect(blockedBy(chain, new Set(["a"]))).toEqual(["b", "c"]);
  });

  it("blocks nothing when everything landed", () => {
    const chain = graph([node("a"), node("b", { dependsOn: ["a"] })]);

    expect(blockedBy(chain, new Set())).toEqual([]);
  });

  it("blocks a node once, however many failed parents it has", () => {
    const both = graph([node("a"), node("b"), node("c", { dependsOn: ["a", "b"] })]);

    expect(blockedBy(both, new Set(["a", "b"]))).toEqual(["c"]);
  });
});
