import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { buildEvidenceDag } from "../evidence/dag.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { claimGraphOutcome, declareTaskGraph } from "./graph-record.ts";
import { readTaskGraph } from "./task-graph.ts";

let root = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-graph-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "coordinator",
    clock: createTestClock(1_700_000_000_000),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const graph = readTaskGraph({
  goal: "make the thing",
  nodes: [
    { id: "parser", title: "parse", instruction: "write the parser", files: ["src/parser.ts"] },
    {
      id: "printer",
      title: "print",
      instruction: "write the printer",
      files: ["src/printer.ts"],
      dependsOn: ["parser"],
    },
  ],
});

describe("declaring a task graph", () => {
  it("writes the graph, the goal, and where it came from", async () => {
    const declared = await declareTaskGraph(evidence, graph, "goal");

    expect(evidence.records().at(-1)?.type).toBe("task-graph");
    expect(evidence.payloads().get(declared.digest)).toMatchObject({
      goal: "make the thing",
      nodeCount: 2,
      source: "goal",
    });
  });

  it("records the overlaps it will serialize rather than leaving them implicit", async () => {
    const shared = readTaskGraph({
      goal: "make the thing",
      nodes: [
        { id: "a", title: "a", instruction: "a", files: ["src/shared.ts"] },
        { id: "b", title: "b", instruction: "b", files: ["src/shared.ts"] },
      ],
    });

    const declared = await declareTaskGraph(evidence, shared, "file");

    expect(evidence.payloads().get(declared.digest)).toMatchObject({
      parallelSafe: false,
      overlaps: [{ nodes: ["a", "b"], files: ["src/shared.ts"] }],
    });
  });

  it("says a graph whose nodes cannot collide is parallel safe", async () => {
    const declared = await declareTaskGraph(evidence, graph, "file");

    expect(evidence.payloads().get(declared.digest)).toMatchObject({
      parallelSafe: true,
      overlaps: [],
    });
  });

  it("refuses to declare twice, because a second declaration is not an edit", async () => {
    await declareTaskGraph(evidence, graph, "goal");

    await expect(declareTaskGraph(evidence, graph, "goal")).rejects.toThrow(/already/);
  });
});

describe("claiming what became of a declared graph", () => {
  it("renders verified when every declared node landed", async () => {
    await declareTaskGraph(evidence, graph, "goal");

    await claimGraphOutcome(evidence, graph, [
      { id: "parser", workerId: "worker-1", landed: true, commit: "a", blocked: false },
      { id: "printer", workerId: "worker-2", landed: true, commit: "b", blocked: false },
    ]);

    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    expect(dag.claims.map((claim) => claim.evaluation.verdict)).toEqual(["verified"]);
  });

  it("renders unverified when a node did not land, and names how many did", async () => {
    await declareTaskGraph(evidence, graph, "goal");

    await claimGraphOutcome(evidence, graph, [
      { id: "parser", workerId: "worker-1", landed: false, commit: null, blocked: false },
      { id: "printer", workerId: null, landed: false, commit: null, blocked: true },
    ]);

    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    const claim = dag.claims[0];
    expect(claim?.evaluation.verdict).toBe("unverified");
    expect(claim?.evaluation.reason).toBe("predicate-false");
    expect(claim?.predicate).toContain("landed == 2");
  });

  it("takes the count it asserts from the declaration, never from the outcome", async () => {
    await declareTaskGraph(evidence, graph, "goal");

    await claimGraphOutcome(evidence, graph, [
      { id: "parser", workerId: "worker-1", landed: true, commit: "a", blocked: false },
    ]);

    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    expect(dag.claims[0]?.predicate).toBe("nodes == 2 && landed == 2");
    expect(dag.claims[0]?.evaluation.verdict).toBe("unverified");
  });

  it("says which nodes were blocked, so a subtree nobody ran is not silent", async () => {
    await declareTaskGraph(evidence, graph, "goal");

    const outcome = await claimGraphOutcome(evidence, graph, [
      { id: "parser", workerId: "worker-1", landed: false, commit: null, blocked: false },
      { id: "printer", workerId: null, landed: false, commit: null, blocked: true },
    ]);

    expect(evidence.payloads().get(outcome.digest)).toMatchObject({
      nodes: 2,
      landed: 0,
      blocked: ["printer"],
    });
  });
});
