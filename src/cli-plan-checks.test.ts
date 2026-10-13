import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeCriteria, type PlanChecksDependencies, planChecks } from "./cli-plan-checks.ts";
import { createFixedRandom } from "./core/test-doubles.ts";
import { readSessionEvidence } from "./durable/session-evidence.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithText,
  respondWithToolCalls,
} from "./providers/fixture-provider.ts";

const execute = promisify(execFile);
const clock = { now: () => Date.now(), sleep: () => Promise.resolve() };

let root = "";
let workspace = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-plan-checks-"));
  workspace = join(root, "repo");
  await execute("mkdir", ["-p", workspace]);
  await writeFile(
    join(workspace, "package.json"),
    '{"name":"slug","private":true,"type":"module","scripts":{"test":"node --test"}}\n',
  );
  await writeFile(join(workspace, "slug.mjs"), "export const slugify = (s) => s;\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const task = "slugify collapses whitespace to one dash";

const contractCall = (goal: string): FixtureTurn =>
  respondWithToolCalls("pinning", [
    {
      callId: "pin",
      toolName: "declare_goal_contract",
      input: {
        version: 1,
        goal,
        requirements: [
          {
            id: "collapse",
            description: "runs of whitespace become one dash",
            checks: ["collapse"],
          },
        ],
        checks: [
          {
            id: "collapse",
            command: "node --test acceptance/collapse.test.mjs",
            author: "user",
            exposure: "withheld",
            artifacts: [
              { path: "acceptance/collapse.test.mjs", content: "import test from 'node:test';\n" },
            ],
          },
        ],
        immutablePaths: [],
      },
    },
  ]);

function deps(turns: readonly FixtureTurn[], extra: Partial<PlanChecksDependencies> = {}) {
  const notes: string[] = [];
  // One scripted model across rounds, as a provider client is: a second planning round
  // continues the script rather than replaying it.
  const model = createFixtureModelClient({ modelId: "fixture:plan", turns });
  const planner: PlanChecksDependencies = {
    task,
    workspace,
    home: root,
    sessionRoot: join(root, "sessions"),
    runId: "run-1",
    createModel: (planning) => createRecordingModelClient(model, planning),
    clock,
    random: createFixedRandom(),
    maxSteps: 6,
    maxTokens: 50_000,
    maxWallMs: 60_000,
    signal: new AbortController().signal,
    note: (line) => notes.push(line),
    ...extra,
  };
  return { planner, notes };
}

describe("planning the completion criteria", () => {
  it("seals model-authored criteria noninteractively, labelled, on a planning chain of their own", async () => {
    const { planner, notes } = deps([
      respondWithToolCalls("reading", [
        { callId: "r", toolName: "read", input: { path: "slug.mjs" } },
      ]),
      contractCall(task),
      respondWithText("planned"),
    ]);
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("sealed");
    if (outcome.kind !== "sealed") throw new Error("unreachable");
    expect(outcome.confirmedBy).toBe("noninteractive");
    // Whatever the model wrote, the harness labels the checks as its and shared.
    expect(outcome.contract.checks[0]).toMatchObject({ author: "model", exposure: "shared" });
    expect(outcome.steps).toBe(3);
    expect(outcome.planningSessionId).toBe("run-1-plan");
    const planning = await readSessionEvidence(join(root, "sessions"), "run-1-plan");
    expect(planning.records.filter((record) => record.type === "model-call")).toHaveLength(3);
    expect(notes.join("\n")).toContain(
      "completion criteria (model-authored, sealed before implementation)",
    );
    expect(notes.join("\n")).toContain(
      "check collapse: node --test acceptance/collapse.test.mjs [model-authored]",
    );
  });

  it("asks a person on a terminal and treats anything but y as a decline", async () => {
    const asked: string[] = [];
    const { planner } = deps([contractCall(task), respondWithText("planned")], {
      ask: async (question) => {
        asked.push(question);
        return "n";
      },
    });
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("declined");
    expect(asked[0]).toContain("Seal these criteria");
  });

  it("reports an unresolved task when the planner pins nothing, and never guesses noninteractively", async () => {
    const { planner } = deps([respondWithText("Which of the two slugify functions do you mean?")]);
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("unresolved");
    if (outcome.kind !== "unresolved") throw new Error("unreachable");
    expect(outcome.stopReason).toBe("completed");
    expect(outcome.account).toBe("Which of the two slugify functions do you mean?");
  });

  it("gives a person one clarification round and plans again with the task kept verbatim", async () => {
    const answers = ["the one in slug.mjs", "y"];
    const clarified = `${task}\n\nClarification from the user: the one in slug.mjs`;
    const { planner } = deps(
      [
        respondWithText("Which of the two slugify functions do you mean?"),
        contractCall(clarified),
        respondWithText("planned"),
      ],
      { ask: async () => answers.shift() ?? "" },
    );
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("sealed");
    if (outcome.kind !== "sealed") throw new Error("unreachable");
    expect(outcome.contract.goal).toBe(clarified);
    expect(outcome.confirmedBy).toBe("person");
  });

  it("stops after the one round when the person has no answer", async () => {
    const { planner } = deps([respondWithText("Which one?")], { ask: async () => "" });
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("unresolved");
  });
});

it("describes criteria with their author and the ones that stay unjudged", () => {
  const lines = describeCriteria({
    version: 1,
    goal: "g\nmore",
    requirements: [
      { id: "a", description: "does a", checks: ["ca"] },
      { id: "b", description: "does b", checks: [] },
    ],
    checks: [
      { id: "ca", command: "npm test\n", author: "model", exposure: "shared", artifacts: [] },
    ],
    immutablePaths: ["tests"],
    selection: "stable",
  });
  expect(lines).toContain("  goal: g");
  expect(lines).toContain("       check ca: npm test [model-authored]");
  expect(lines).toContain("       no executable check: stays unjudged");
  expect(lines).toContain("  immutable: tests");
});
