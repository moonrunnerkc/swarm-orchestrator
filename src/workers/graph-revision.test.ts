import { describe, expect, it } from "vitest";
import { parseTaskContract } from "../evidence/task-contract.ts";
import type { TaskState } from "./controller-schedule.ts";
import {
  type ControllerNode,
  checkGraphDigest,
  initialControllerGraph,
  reviseGraph,
} from "./graph-revision.ts";

function node(id: string, files = [`${id}.ts`], obligations = [id]): ControllerNode {
  return {
    id,
    dependsOn: [],
    obligations,
    contract: parseTaskContract({
      version: 2,
      taskId: id,
      objective: `implement ${id}`,
      dependsOn: [],
      allowedPaths: files,
      immutablePaths: ["acceptance.mjs"],
      allowedTools: ["read", "write"],
      network: "unrestricted",
      execution: "restricted",
      requiredChecks: ["tests"],
      budget: { maxSteps: 8, maxWallMs: 10000, maxTokens: 10000 },
      riskTier: "medium",
      scopeAuthority: "controller",
    }),
  };
}
const pending = new Map<string, TaskState>([
  ["a", "pending"],
  ["b", "pending"],
]);
describe("bounded graph revisions", () => {
  it("adds a missing prerequisite and invalidates affected downstream acceptance", () => {
    const graph = initialControllerGraph(
      [node("a"), { ...node("b"), dependsOn: ["a"] }, node("c")],
      ["full-goal"],
    );
    const revised = reviseGraph(
      graph,
      { kind: "add-prerequisite", taskId: "a", prerequisite: "c" },
      new Map([
        ["a", "accepted"],
        ["b", "accepted"],
        ["c", "pending"],
      ]),
      "observed missing prerequisite",
      "harness",
    );
    expect(revised.parent).toBe(graph.revision);
    expect(revised.affected).toEqual(["a", "b"]);
    expect(revised.requirements).toEqual(["full-goal"]);
    expect(revised.nodes[0]?.contract.dependsOn).toEqual(["c"]);
    expect(checkGraphDigest(revised)).toBe(true);
    expect(graph.nodes[0]?.dependsOn).toEqual([]);
  });
  it("names cycles and invalid references before a revision can be appended", () => {
    const graph = initialControllerGraph([node("a"), { ...node("b"), dependsOn: ["a"] }], []);
    expect(() =>
      reviseGraph(
        graph,
        { kind: "add-prerequisite", taskId: "a", prerequisite: "b" },
        pending,
        "discovery",
        "model",
      ),
    ).toThrow("a -> b -> a");
    expect(() =>
      reviseGraph(
        graph,
        { kind: "add-prerequisite", taskId: "a", prerequisite: "absent" },
        pending,
        "discovery",
        "model",
      ),
    ).toThrow("not declared");
  });
  it("splits pending work while keeping every original obligation and dependent edge", () => {
    const graph = initialControllerGraph(
      [node("a", ["one.ts", "two.ts"]), { ...node("b"), dependsOn: ["a"] }],
      ["goal"],
    );
    const revised = reviseGraph(
      graph,
      {
        kind: "split",
        taskId: "a",
        parts: [node("one", ["one.ts"], ["a"]), node("two", ["two.ts"], ["a"])],
      },
      pending,
      "smaller independent edits",
      "harness",
    );
    expect(revised.nodes.find((node) => node.id === "b")?.dependsOn).toEqual(["one", "two"]);
    expect(revised.obligations).toEqual(["a", "b"]);
    expect(revised.retired).toEqual(["a"]);
    expect(checkGraphDigest(revised)).toBe(true);
  });
  it("collapses coupled tasks into one worker with their combined permissions and obligations", () => {
    const graph = initialControllerGraph([node("a"), node("b")], ["goal"]);
    const revised = reviseGraph(
      graph,
      {
        kind: "combine",
        tasks: ["a", "b"],
        combined: node("coupled", ["a.ts", "b.ts"], ["a", "b"]),
      },
      new Map([
        ["a", "failed"],
        ["b", "failed"],
      ]),
      "repeated interface failures",
      "harness",
    );
    expect(revised.nodes).toHaveLength(1);
    expect(revised.nodes[0]?.obligations).toEqual(["a", "b"]);
    expect(revised.retired).toEqual(["a", "b"]);
  });
  it("refuses erased obligations, widened files, weakened checks and reused identities", () => {
    const graph = initialControllerGraph([node("a"), node("b")], []);
    expect(() =>
      reviseGraph(
        graph,
        { kind: "combine", tasks: ["a", "b"], combined: node("combined", ["a.ts", "b.ts"], ["a"]) },
        pending,
        "bad plan",
        "model",
      ),
    ).toThrow("preserve all original obligations");
    expect(() =>
      reviseGraph(
        graph,
        { kind: "reroute", taskId: "a", replacement: node("new", ["outside.ts"], ["a"]) },
        pending,
        "bad plan",
        "model",
      ),
    ).toThrow("cannot broaden paths");
    const weaker = node("new", ["a.ts"], ["a"]);
    expect(() =>
      reviseGraph(
        graph,
        {
          kind: "reroute",
          taskId: "a",
          replacement: { ...weaker, contract: { ...weaker.contract, requiredChecks: [] } },
        },
        pending,
        "bad plan",
        "model",
      ),
    ).toThrow("required checks");
    expect(() =>
      reviseGraph(
        graph,
        { kind: "reroute", taskId: "a", replacement: node("b", ["a.ts"], ["a"]) },
        pending,
        "bad plan",
        "model",
      ),
    ).toThrow("already used");
  });
  it("bounds revisions and prevents ownership replacement while a worker is active", () => {
    const graph = initialControllerGraph([node("a"), node("b")], [], 0);
    expect(() =>
      reviseGraph(
        graph,
        { kind: "add-prerequisite", taskId: "a", prerequisite: "b" },
        pending,
        "discovery",
        "model",
      ),
    ).toThrow("budget exhausted");
    const active = initialControllerGraph([node("a"), node("b")], []);
    expect(() =>
      reviseGraph(
        active,
        {
          kind: "combine",
          tasks: ["a", "b"],
          combined: node("coupled", ["a.ts", "b.ts"], ["a", "b"]),
        },
        new Map([
          ["a", "running"],
          ["b", "pending"],
        ]),
        "coupled",
        "model",
      ),
    ).toThrow("wait for active attempts");
  });
});
