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
  const task = "make classify(n) call 10 small: every n up to and including 10 is small";
  const base = freezeGoalContract({
    version: 1,
    goal: task,
    requirements: [{ id: "suite", description: "the suite passes", checks: ["suite"] }],
    checks: [
      { id: "suite", command: "node --test", author: "user", exposure: "shared", artifacts: [] },
    ],
    immutablePaths: ["value.test.mjs"],
  }).contract;
  const program = "import { classify } from './value.mjs';\nexport default (n) => classify(n);\n";
  const check = {
    id: "boundary",
    purpose: "change",
    requirementId: "boundary",
    requirement: "10 is small",
    // Wrapped in its own quotation marks and elided, as live planners quoted.
    quote: '"every n up to ... including 10"',
    program,
    cases: [{ input: 10, expected: "small", changed: true }],
    why: "the task says 10 is small",
  };
  const declaring = (callId: string, input: Record<string, unknown>) => ({
    callId,
    toolName: "declare_planned_check",
    input: { ...check, ...input },
  });
  const plan = (
    turns: Parameters<typeof createFixtureModelClient>[0]["turns"],
    initial?: NonNullable<Parameters<typeof runPlanner>[0]["plannedChecks"]>["initial"],
  ) =>
    runPlanner({
      goal: `Revision brief with recorded output: "every n up to and including 99"\n${task}`,
      workspace,
      homeDir: scratch,
      evidence,
      clock: createTestClock(1000),
      random: createFixedRandom(),
      emit: () => {},
      maxSteps: 8,
      requireGoalChecks: true,
      plannedChecks: {
        base,
        task,
        preparation: "The checkout is installed first.",
        ...(initial === undefined ? {} : { initial }),
      },
      abortSignal: new AbortController().signal,
      model: createFixtureModelClient({ modelId: "fixture:planner", turns }),
    });
  const toolErrors = () =>
    evidence
      .records()
      .filter((record) => record.type === "tool-call")
      .map((record) => JSON.stringify(evidence.payloads().get(record.payloadDigest)))
      .filter((text) => text.includes("declare_planned_check"))
      .join("\n");

  it("builds the contract's own checks from one call per check, adding to the supplied contract", async () => {
    const outcome = await plan([
      respondWithToolCalls("as asked", [
        declaring("valid", {}),
        declaring("kept", {
          id: "above",
          purpose: "preserve",
          requirementId: "above",
          requirement: "11 stays big",
          quote: undefined,
          cases: [{ input: 11, expected: "big" }],
        }),
      ]),
      respondWithText("declared"),
    ]);
    const contract = outcome.goalContract;
    // The supplied requirement is decided by its own check; the planned ones by none, their
    // generated checks carried as diagnostics.
    expect(
      contract?.requirements.map((one) => [one.id, one.checks, one.planned?.diagnostics ?? null]),
    ).toEqual([
      ["suite", ["suite"], null],
      ["boundary", [], ["boundary"]],
      ["above", [], ["above"]],
    ]);
    const built = contract?.checks.find((one) => one.id === "boundary");
    expect([built?.author, built?.exposure, built?.atBase]).toEqual(["model", "shared", "fails"]);
    expect(contract?.checks.find((one) => one.id === "above")?.atBase).toBe("passes");
    expect(built?.artifacts).toEqual([]);
    if (built?.behavior?.kind !== "cli") throw new Error("a command-line behavior check");
    expect(built.behavior.argv.slice(0, 3)).toEqual(["node", "--input-type=module", "-e"]);
    expect(JSON.parse(built.behavior.stdin)).toEqual({ program, inputs: [10], changed: [true] });
    expect(built.behavior.stdout).toEqual([
      { kind: "equals", value: '{"input":10,"result":"small"}\n' },
    ]);
    expect(contract?.immutablePaths).toEqual(["value.test.mjs"]);
    // An elided quote is accepted part by part, and the requirement records it.
    expect(contract?.requirements.find((one) => one.id === "boundary")?.planned?.quote).toContain(
      "every n up to ... including 10",
    );
  });

  it("refuses what admission would trust and what the task does not say, naming each problem", async () => {
    const { quote: _quote, ...unquoted } = check;
    const outcome = await plan([
      respondWithToolCalls("references of my own", [
        declaring("references", {
          challenges: { version: 1, mutations: "none", fixtures: [], references: [] },
        }),
      ]),
      respondWithToolCalls("the old contract fields", [
        declaring("fields", { command: "node x", behavior: { kind: "cli" } }),
      ]),
      respondWithToolCalls("a reused id", [
        declaring("reused", { id: "suite", requirementId: "suite" }),
      ]),
      respondWithToolCalls("an unquoted change", [
        { callId: "unquoted", toolName: "declare_planned_check", input: unquoted },
      ]),
      respondWithToolCalls("a quote from the revision brief, not the task", [
        declaring("quote", { quote: "every n up to and including 99" }),
      ]),
      respondWithToolCalls("no default export", [
        declaring("export", { program: "console.log(1)" }),
      ]),
      respondWithText("gave up"),
    ]);
    expect(outcome.goalContract).toBeNull();
    const errors = toolErrors();
    expect(errors).toMatch(/challenges/);
    expect(errors).toMatch(/check suite already exists in the contract/);
    expect(errors).toMatch(/requirement suite already exists in the contract/);
    expect(errors).toMatch(/covered by a change check, so quote the task/);
    expect(errors).toMatch(/its quote is not in the task text/);
    expect(errors).toMatch(/must export a default function/);
  });

  it("shows the planner its inputs as read, and warns where a line feed was escaped twice", async () => {
    await plan([
      respondWithToolCalls("escaped twice", [
        declaring("twice", {
          // What arrives when a model writes \\n in the tool's JSON: a backslash and an n.
          cases: [
            { input: "LINE\\nFEED.png", expected: "image/png", changed: true },
            { input: "LS\u2028.png", expected: "image/png", changed: true },
          ],
        }),
      ]),
      respondWithText("declared"),
    ]);
    const answer = toolErrors();
    expect(answer).toContain("boundary inputs as read:");
    expect(answer).toContain("LS\\\\u2028.png");
    expect(answer).toMatch(/warning: boundary case 1 holds a backslash followed by n/);
    expect(answer).not.toMatch(/case 2 holds a backslash/);
  });

  it("lets a planner replace a check it pinned before anything has run", async () => {
    const outcome = await plan([
      respondWithToolCalls("first", [declaring("first", {})]),
      respondWithToolCalls("a better one", [
        declaring("second", {
          cases: [
            { input: 10, expected: "small", changed: true },
            { input: 9, expected: "small", changed: false },
          ],
        }),
      ]),
      respondWithText("declared"),
    ]);
    const built = outcome.goalContract?.checks.filter((one) => one.id === "boundary") ?? [];
    expect(built).toHaveLength(1);
    expect(
      built[0]?.behavior?.kind === "cli" && JSON.parse(built[0].behavior.stdin).inputs,
    ).toEqual([10, 9]);
    expect(toolErrors()).toMatch(/replacing the earlier one/);
  });

  const words = {
    id: "spelling",
    purpose: "preserve",
    requirementId: "spelling",
    requirement: "a word's length decides its size",
    program: "import { classify } from './value.mjs';\nexport default (s) => classify(s.length);\n",
    cases: [{ input: "ab", expected: "small" }],
    why: "the base already does this",
  };
  const reviewing = (callId: string, input: Record<string, unknown>) => ({
    callId,
    toolName: "declare_coverage_review",
    input: {
      id: "boundary-review",
      requirementId: "boundary",
      change: "10 becomes small",
      keeps: "11 and above stay big",
      wrongImplementation: "n <= 11",
      distinguishedBy: ["boundary"],
      noRelation: "a numeric boundary",
      untested: "negative numbers",
      ...input,
    },
  });
  const answers = () =>
    evidence
      .records()
      .filter((record) => record.type === "tool-call")
      .map((record) => JSON.stringify(evidence.payloads().get(record.payloadDigest)))
      .filter((text) => text.includes("declare_coverage_review"))
      .join("\n");

  it("records a coverage review per requirement, and seals the relation one gives over a declared check's program", async () => {
    const outcome = await plan([
      respondWithToolCalls("checks", [
        declaring("valid", {}),
        { callId: "words", toolName: "declare_planned_check", input: words },
      ]),
      respondWithToolCalls("reviews", [
        reviewing("numeric", {}),
        reviewing("strings", {
          id: "letters-alike",
          requirementId: "spelling",
          distinguishedBy: ["letters-alike"],
          noRelation: undefined,
          relation: {
            purpose: "preserve",
            programFrom: "spelling",
            seeds: ["abc"],
            reference: "x",
            variants: ["y"],
          },
        }),
      ]),
      respondWithText("reviewed"),
    ]);
    expect(outcome.plannedDeclaration?.reviews?.map((one) => one.id)).toEqual([
      "boundary-review",
      "letters-alike",
    ]);
    const relation = outcome.goalContract?.checks.find((one) => one.id === "letters-alike");
    expect(relation?.atBase).toBe("passes");
    expect(relation?.behavior?.kind === "cli" && JSON.parse(relation.behavior.stdin)).toEqual({
      program: words.program,
      relation: { seeds: ["abc"], reference: "x", variants: ["y"] },
    });
    // Before the second review the answer named the requirement still unreviewed.
    expect(answers()).toContain("no review yet for requirement(s) spelling");
    expect(answers()).toContain("Relation letters-alike sealed over the program of spelling");
    expect(answers()).toContain("is your reading, recorded as yours");
  });

  it("continues the declaration an earlier round ended with, so a review needs nothing restated", async () => {
    const first = await plan([
      respondWithToolCalls("checks", [declaring("valid", {})]),
      respondWithText("declared"),
    ]);
    const declaration = first.plannedDeclaration;
    if (declaration === null || declaration === undefined) throw new Error("a declaration");
    const second = await plan(
      [respondWithToolCalls("review", [reviewing("numeric", {})]), respondWithText("reviewed")],
      declaration,
    );
    expect(second.goalContract?.checks.map((one) => one.id)).toEqual(["suite", "boundary"]);
    expect(second.plannedDeclaration?.reviews?.map((one) => one.requirementId)).toEqual([
      "boundary",
    ]);
  });
});
