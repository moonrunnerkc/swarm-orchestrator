import { expect, it } from "vitest";
import { asJsonValue, digestOfJson } from "../evidence/canonical-json.ts";
import type { LedgerRecord } from "../evidence/ledger-record.ts";
import { parseTaskContract } from "../evidence/task-contract.ts";
import { readControllerHistory } from "../evidence/verifier/controller.mjs";
import { amendControllerScope, parseControllerScope } from "./controller-scope.ts";
import { type ControllerGraph, initialControllerGraph, reviseGraph } from "./graph-revision.ts";

const contract = parseTaskContract({
  version: 2,
  taskId: "consumer",
  objective: "use helper",
  dependsOn: [],
  allowedPaths: ["a.js"],
  immutablePaths: ["checks/**"],
  allowedTools: ["read", "write"],
  network: "denied",
  execution: "isolated",
  requiredChecks: ["tests"],
  budget: { maxSteps: 5, maxWallMs: 10000, maxTokens: 10000 },
  riskTier: "medium",
  scopeAuthority: "controller",
});
const scope = parseControllerScope({
  kind: "files",
  allowedPaths: ["a.js", "src/../helper.js"],
  immutablePaths: ["checks/**"],
});
function graph() {
  return initialControllerGraph(
    [{ id: "consumer", contract, dependsOn: [], obligations: ["consumer"] }],
    ["goal"],
    4,
    scope,
  );
}
function reading(graphs: readonly ControllerGraph[]) {
  const payloads = new Map(
    graphs.map((graph) => [digestOfJson(asJsonValue(graph)), asJsonValue(graph)]),
  );
  const records: Pick<LedgerRecord, "type" | "actor" | "sequence" | "payloadDigest">[] = graphs.map(
    (graph, sequence) => ({
      type: "controller-graph",
      actor: "harness",
      sequence,
      payloadDigest: digestOfJson(asJsonValue(graph)),
    }),
  );
  return readControllerHistory(records, payloads);
}

it("normalizes authorized paths and refuses outside, immutable, absent or human-only amendment authority", () => {
  expect(amendControllerScope(contract, ["src/../helper.js"], scope).allowedPaths).toEqual([
    "a.js",
    "helper.js",
  ]);
  for (const path of ["outside.js", "checks/hidden.js", "../host.js", "/host.js"])
    expect(() => amendControllerScope(contract, [path], scope)).toThrow();
  expect(() => amendControllerScope(contract, ["helper.js"], undefined)).toThrow("no declared");
  expect(() =>
    amendControllerScope({ ...contract, scopeAuthority: "human" }, ["helper.js"], scope),
  ).toThrow("human");
});

it("records scope allocation separately from insertion and preserves the original obligation", () => {
  const initial = graph();
  const amended = reviseGraph(
    initial,
    { kind: "amend-scope", taskId: "consumer", paths: ["helper.js"] },
    new Map(),
    "missing module within authorized goal",
    "model",
  );
  const inserted = reviseGraph(
    amended,
    {
      kind: "insert-prerequisite",
      taskId: "consumer",
      node: {
        id: "helper",
        contract: {
          ...contract,
          taskId: "helper",
          objective: "create helper",
          allowedPaths: ["helper.js"],
        },
        dependsOn: [],
        obligations: ["consumer"],
      },
    },
    new Map(),
    "consumer imports helper",
    "model",
  );
  expect(inserted.nodes[0]?.dependsOn).toEqual(["helper"]);
  expect(inserted.obligations).toEqual(["consumer"]);
  expect(inserted.affected).toEqual(["consumer", "helper"]);
  expect(reading([initial, amended, inserted]).problems).toEqual([]);
  expect(initial.nodes[0]?.contract.allowedPaths).toEqual(["a.js"]);
});

it("refuses a new prerequisite that widens policy, erases obligations or closes a cycle", () => {
  const initial = graph();
  const node = {
    id: "helper",
    contract: { ...contract, taskId: "helper" },
    dependsOn: [],
    obligations: ["consumer"],
  };
  for (const replacement of [
    { ...node, obligations: ["invented"] },
    { ...node, dependsOn: ["consumer"] },
    { ...node, contract: { ...node.contract, network: "unrestricted" as const } },
    { ...node, contract: { ...node.contract, requiredChecks: [] } },
    { ...node, contract: { ...node.contract, allowedPaths: ["helper.js"] } },
  ])
    expect(() =>
      reviseGraph(
        initial,
        { kind: "insert-prerequisite", taskId: "consumer", node: replacement },
        new Map(),
        "discovery",
        "model",
      ),
    ).toThrow();
});

it("independently rejects a rehashed scope expansion outside the original user ceiling", () => {
  const initial = graph();
  const amended = reviseGraph(
    initial,
    { kind: "amend-scope", taskId: "consumer", paths: ["helper.js"] },
    new Map(),
    "authorized file",
    "harness",
  );
  const { revision: _revision, ...fields } = amended;
  const forged = { ...fields, scope: { ...scope, kind: "workspace" as const, allowedPaths: [] } };
  const rehashed = { ...forged, revision: digestOfJson(asJsonValue(forged)) };
  expect(reading([initial, rehashed]).problems.join(" ")).toContain("ceiling");
});
