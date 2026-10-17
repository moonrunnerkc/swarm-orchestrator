import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../core/clock.ts";
import type { ModelClient, ModelRequest } from "../core/model-client.ts";
import { createFixedRandom, createTestClock } from "../core/test-doubles.ts";
import { freezeGoalContract } from "../evidence/goal-contract.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { runPlanner } from "./planner-run.ts";
import { createRunContext } from "./run-context.ts";

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
    const { graph } = await planner(declaring(twoNodes));

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
    const { graph } = await planner([
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
    expect((await planner([respondWithText("I would rather not")])).graph).toBeNull();
  });

  it("says how the loop stopped, which is what tells one kind of nothing from another", async () => {
    const gaveUp = await planner([respondWithText("I would rather not")]);

    expect(gaveUp.stopReason).toBe("completed");
    expect(gaveUp.steps).toBeGreaterThan(0);
  });

  it("reports an empty response as itself, not as a refusal", async () => {
    // Every sample the retry policy takes comes back empty, so the silence is the answer.
    const empty = await planner([respondWithText(""), respondWithText(""), respondWithText("")]);

    expect(empty.stopReason).toBe("empty-response");
    expect(empty.graph).toBeNull();
  });

  it("keeps the last graph the model declared, so a correction stands", async () => {
    const { graph } = await planner([
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

it("pins candidate goal checks through the planner chokepoint with truthful model authorship", async () => {
  const contextClock = createTestClock(1000);
  const context = await createRunContext({
    evidence,
    clock: contextClock,
    runId: "planning",
    maxTokens: 100000,
    maxWallMs: 10000,
    modelConcurrency: 1,
    testConcurrency: 1,
    signal: new AbortController().signal,
  });
  const goal = "implement parsing";
  const outcome = await runPlanner({
    goal,
    workspace,
    homeDir: scratch,
    evidence,
    clock: contextClock,
    random: createFixedRandom(),
    emit: () => {},
    maxSteps: 4,
    requireGoalChecks: true,
    abortSignal: context.signal,
    model: context.model(
      "planning",
      createFixtureModelClient({
        modelId: "fixture:planner",
        turns: [
          respondWithToolCalls("declare", [
            { callId: "graph", toolName: "declare_task_graph", input: { ...twoNodes, goal } },
            {
              callId: "acceptance",
              toolName: "declare_goal_contract",
              input: {
                version: 1,
                goal,
                requirements: [
                  { id: "parsing", description: "parse the required syntax", checks: ["syntax"] },
                ],
                checks: [
                  {
                    id: "syntax",
                    command: "node syntax.mjs",
                    author: "user",
                    exposure: "withheld",
                    artifacts: [
                      {
                        path: "syntax.mjs",
                        content:
                          "import assert from 'node:assert/strict'; import {parse} from './parse.js'; assert.equal(parse('x'), 'x');",
                      },
                    ],
                  },
                ],
                immutablePaths: [],
              },
            },
          ]),
          respondWithText("declared"),
        ],
      }),
    ),
  });
  expect(outcome.goalContract?.checks[0]?.author).toBe("model");
  expect(outcome.goalContract?.checks[0]?.exposure).toBe("shared");
  expect(context.accounting().spent).toBeGreaterThan(0);
  context.dispose();
});
it("cancels planning under the shared run context and records unresolved provider usage", async () => {
  const contextClock = createTestClock(1000);
  const interruption = new AbortController();
  const context = await createRunContext({
    evidence,
    clock: contextClock,
    runId: "planning",
    maxTokens: 100000,
    maxWallMs: 10000,
    modelConcurrency: 1,
    testConcurrency: 1,
    signal: interruption.signal,
  });
  const outcome = await runPlanner({
    goal: "large goal",
    workspace,
    homeDir: scratch,
    evidence,
    clock: contextClock,
    random: createFixedRandom(),
    emit: () => {},
    maxSteps: 4,
    abortSignal: context.signal,
    model: context.model("planning", {
      modelId: "fixture:cancel",
      generate: async () => {
        interruption.abort();
        throw new Error("cancelled planning");
      },
    }),
  });
  expect(outcome.stopReason).toBe("interrupted");
  expect(context.accounting().unknownCalls).toBe(1);
  expect(outcome.graph).toBeNull();
  context.dispose();
});

describe("planned checks", () => {
  const base = freezeGoalContract({
    version: 1,
    goal: "move the boundary",
    requirements: [{ id: "suite", description: "the suite passes", checks: ["suite"] }],
    checks: [
      { id: "suite", command: "node --test", author: "user", exposure: "shared", artifacts: [] },
    ],
    immutablePaths: ["value.test.mjs"],
  }).contract;
  const inline = (id: string) => ({
    id,
    command: "node --input-type=module -e console.log(1)",
    author: "user",
    exposure: "withheld",
    atBase: "fails",
    artifacts: [],
    behavior: {
      kind: "cli",
      cwd: ".",
      timeoutMs: 1000,
      maxOutputBytes: 4096,
      toolchain: "Node",
      network: "inherit",
      argv: ["node", "--input-type=module", "-e", "console.log(1)"],
      exitCode: 0,
      stdout: [{ kind: "equals", value: "2\n" }],
      stderr: [],
    },
  });
  const declaring = (callId: string, extra: Record<string, unknown>) => ({
    callId,
    toolName: "declare_planned_checks",
    input: {
      requirements: [{ id: "boundary", description: "10 is small", checks: ["boundary"] }],
      checks: [inline("boundary")],
      ...extra,
    },
  });

  it("refuses what admission would trust, then adds to the supplied contract without changing it", async () => {
    const outcome = await runPlanner({
      goal: "move the boundary",
      workspace,
      homeDir: scratch,
      evidence,
      clock: createTestClock(1000),
      random: createFixedRandom(),
      emit: () => {},
      maxSteps: 6,
      requireGoalChecks: true,
      plannedChecks: { base },
      abortSignal: new AbortController().signal,
      model: createFixtureModelClient({
        modelId: "fixture:planner",
        turns: [
          respondWithToolCalls("references of my own", [
            declaring("references", {
              challenges: { version: 1, mutations: "none", fixtures: [], references: [] },
            }),
          ]),
          respondWithToolCalls("a file artifact", [
            declaring("artifact", {
              checks: [{ ...inline("boundary"), artifacts: [{ path: "check.mjs", content: "1" }] }],
            }),
          ]),
          respondWithToolCalls("a reused id", [
            declaring("reused", {
              requirements: [{ id: "suite", description: "again", checks: ["boundary"] }],
            }),
          ]),
          respondWithToolCalls("as asked", [declaring("valid", {})]),
          respondWithText("declared"),
        ],
      }),
    });

    const contract = outcome.goalContract;
    expect(contract?.requirements.map((one) => one.id)).toEqual(["suite", "boundary"]);
    expect(contract?.checks.map((one) => [one.id, one.author, one.exposure, one.atBase])).toEqual([
      ["suite", "user", "shared", undefined],
      ["boundary", "model", "shared", "fails"],
    ]);
    expect(contract?.immutablePaths).toEqual(["value.test.mjs"]);
    expect(contract?.challenges).toBeUndefined();
    const refusals = evidence
      .records()
      .filter((record) => record.type === "tool-call")
      .map((record) => JSON.stringify(evidence.payloads().get(record.payloadDigest)))
      .filter((text) => text.includes("declare_planned_checks"));
    expect(refusals.join("\n")).toMatch(/challenges/);
    expect(refusals.join("\n")).toMatch(/no artifacts/);
    expect(refusals.join("\n")).toMatch(/already exist in the supplied contract/);
  });
});
