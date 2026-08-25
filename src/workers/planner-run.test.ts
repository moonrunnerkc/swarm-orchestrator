import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../core/clock.ts";
import type { ModelClient, ModelRequest } from "../core/model-client.ts";
import { createFixedRandom } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { runPlanner } from "./planner-run.ts";

const clock: Clock = { now: () => 1_700_000_000_000, sleep: () => Promise.resolve() };

let scratch = "";
let workspace = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-planner-"));
  workspace = join(scratch, "repo");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "README.md"), "# a project\n", "utf8");

  evidence = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "planner",
    clock,
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const twoNodes = {
  goal: "add a parser and a printer",
  nodes: [
    { id: "parser", title: "parse", instruction: "write src/parser.ts", files: ["src/parser.ts"] },
    {
      id: "printer",
      title: "print",
      instruction: "write src/printer.ts",
      files: ["src/printer.ts"],
      dependsOn: ["parser"],
    },
  ],
};

function declaring(graph: unknown): readonly FixtureTurn[] {
  return [
    respondWithToolCalls("here is the graph", [
      { callId: "g0", toolName: "declare_task_graph", input: graph as Record<string, unknown> },
    ]),
    respondWithText("declared"),
  ];
}

function planner(turns: readonly FixtureTurn[], captured?: ModelRequest[]) {
  const fixture = createFixtureModelClient({ modelId: "fixture:planner", turns });
  const model: ModelClient =
    captured === undefined
      ? fixture
      : {
          modelId: fixture.modelId,
          generate: (request) => {
            captured.push(request);
            return fixture.generate(request);
          },
        };
  return runPlanner({
    goal: "add a parser and a printer",
    workspace,
    homeDir: scratch,
    model,
    evidence,
    clock,
    random: createFixedRandom(),
    emit: () => {},
    maxSteps: 6,
    abortSignal: new AbortController().signal,
  });
}

describe("the planner run", () => {
  it("returns the graph the model declared", async () => {
    const graph = await planner(declaring(twoNodes));

    expect(graph?.nodes.map((node) => node.id)).toEqual(["parser", "printer"]);
  });

  it("can read the workspace but not change it", async () => {
    const captured: ModelRequest[] = [];

    await planner(declaring(twoNodes), captured);

    expect(captured[0]?.tools.map((tool) => tool.name).sort()).toEqual([
      "declare_task_graph",
      "list",
      "read",
      "search",
    ]);
  });

  it("hands a bad graph back to the model rather than ending the run", async () => {
    const graph = await planner([
      respondWithToolCalls("first try", [
        {
          callId: "g0",
          toolName: "declare_task_graph",
          input: {
            goal: "g",
            nodes: [{ id: "Bad Id", title: "t", instruction: "i", files: ["a"] }],
          },
        },
      ]),
      ...declaring(twoNodes),
    ]);

    expect(graph?.nodes.map((node) => node.id)).toEqual(["parser", "printer"]);
  });

  it("returns nothing when the model never declared a graph", async () => {
    expect(await planner([respondWithText("I would rather not")])).toBeNull();
  });

  it("keeps the last graph the model declared, so a correction stands", async () => {
    const graph = await planner([
      respondWithToolCalls("here is the graph", [
        { callId: "g0", toolName: "declare_task_graph", input: twoNodes },
      ]),
      respondWithToolCalls("on reflection, just the parser", [
        {
          callId: "g1",
          toolName: "declare_task_graph",
          input: { ...twoNodes, nodes: [twoNodes.nodes[0]] },
        },
      ]),
      respondWithText("declared"),
    ]);

    expect(graph?.nodes.map((node) => node.id)).toEqual(["parser"]);
  });
});
