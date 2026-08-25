import { describe, expect, it } from "vitest";
import { InvalidTaskGraphError, overlapsIn, readTaskGraph } from "./task-graph.ts";

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
  return { goal: "make the thing", nodes };
}

describe("reading a task graph", () => {
  it("takes a goal and the nodes that are meant to satisfy it", () => {
    const read = readTaskGraph(graph([node("parser"), node("printer")]));

    expect(read.goal).toBe("make the thing");
    expect(read.nodes.map((one) => one.id)).toEqual(["parser", "printer"]);
  });

  it("normalises the files a node names the way the file-set gate reads them", () => {
    const read = readTaskGraph(
      graph([node("parser", { files: ["./src/parser.ts", "/src/b.ts"] })]),
    );

    expect(read.nodes[0]?.files).toEqual(["src/b.ts", "src/parser.ts"]);
  });

  it("refuses a node that names no file, because there is nothing to declare", () => {
    expect(() => readTaskGraph(graph([node("parser", { files: [] })]))).toThrow(
      InvalidTaskGraphError,
    );
  });

  it("refuses two nodes with one id, because a dependency could not name either", () => {
    expect(() => readTaskGraph(graph([node("parser"), node("parser")]))).toThrow(/parser/);
  });

  it("refuses an id that is not a slug, so an id is safe to put in a branch name", () => {
    expect(() => readTaskGraph(graph([node("Parser Step")]))).toThrow(/Parser Step/);
  });

  it("refuses a dependency on a node that was never declared", () => {
    expect(() => readTaskGraph(graph([node("printer", { dependsOn: ["parser"] })]))).toThrow(
      /parser/,
    );
  });

  it("refuses a node that depends on itself", () => {
    expect(() => readTaskGraph(graph([node("parser", { dependsOn: ["parser"] })]))).toThrow(
      /parser/,
    );
  });

  it("refuses a cycle, and names the nodes in it", () => {
    const cyclic = graph([
      node("a", { dependsOn: ["c"] }),
      node("b", { dependsOn: ["a"] }),
      node("c", { dependsOn: ["b"] }),
    ]);

    expect(() => readTaskGraph(cyclic)).toThrow(/a.*b.*c|c.*b.*a/);
  });

  it("refuses something that is not a task graph at all", () => {
    expect(() => readTaskGraph({ nodes: "two of them" })).toThrow(InvalidTaskGraphError);
    expect(() => readTaskGraph(null)).toThrow(InvalidTaskGraphError);
  });
});

describe("which nodes could run at once and must not", () => {
  it("finds nothing where independent nodes touch different files", () => {
    expect(overlapsIn(readTaskGraph(graph([node("parser"), node("printer")])))).toEqual([]);
  });

  it("names the pair and the file where two independent nodes would collide", () => {
    const shared = graph([
      node("parser", { files: ["src/shared.ts", "src/parser.ts"] }),
      node("printer", { files: ["src/shared.ts"] }),
    ]);

    expect(overlapsIn(readTaskGraph(shared))).toEqual([
      { nodes: ["parser", "printer"], files: ["src/shared.ts"] },
    ]);
  });

  it("finds nothing where the two nodes already run one after the other", () => {
    const ordered = graph([
      node("parser", { files: ["src/shared.ts"] }),
      node("printer", { files: ["src/shared.ts"], dependsOn: ["parser"] }),
    ]);

    expect(overlapsIn(readTaskGraph(ordered))).toEqual([]);
  });

  it("finds nothing where one node reaches the other through a third", () => {
    const chained = graph([
      node("a", { files: ["src/shared.ts"] }),
      node("b", { dependsOn: ["a"] }),
      node("c", { files: ["src/shared.ts"], dependsOn: ["b"] }),
    ]);

    expect(overlapsIn(readTaskGraph(chained))).toEqual([]);
  });

  it("names each colliding pair once, in a fixed order", () => {
    const three = graph([
      node("c", { files: ["src/shared.ts"] }),
      node("a", { files: ["src/shared.ts"] }),
      node("b", { files: ["src/shared.ts"] }),
    ]);

    expect(overlapsIn(readTaskGraph(three)).map((one) => one.nodes)).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
  });
});
