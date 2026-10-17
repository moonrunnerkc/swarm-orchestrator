import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeCriteria, type PlanChecksDependencies, planChecks } from "./cli-plan-checks.ts";
import { createFixedRandom } from "./core/test-doubles.ts";
import { readSessionEvidence } from "./durable/session-evidence.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
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

describe("the planned-check revision and its share of the planning allowance", () => {
  const declaring = (ids: readonly string[]): FixtureTurn =>
    respondWithToolCalls("pinning", [
      {
        callId: `declare-${ids.join("-")}`,
        toolName: "declare_planned_checks",
        input: {
          requirements: ids.map((id) => ({
            id: `r-${id}`,
            description: `requirement ${id}`,
            quote: "collapses whitespace",
          })),
          checks: ids.map((id) => ({
            id,
            requirement: `r-${id}`,
            purpose: "change",
            program: "import { slugify } from './slug.mjs';\nexport default slugify;\n",
            cases: [{ input: "a  b", expected: "a-b" }],
            why: "the task says runs of whitespace become one dash",
          })),
        },
      },
    ]);

  /** Admission that takes `ms` of the planning clock, admits the checks named, and drops the rest. */
  function admitting(admit: readonly string[], ms: () => number, advance: (by: number) => void) {
    return (_chain: unknown, contract: GoalContract, base: GoalContract | undefined) => {
      advance(ms());
      const supplied = new Set((base?.checks ?? []).map((one) => one.id));
      const planned = contract.checks.filter((one) => !supplied.has(one.id));
      const kept = contract.checks.filter((one) => supplied.has(one.id) || admit.includes(one.id));
      const requirements = contract.requirements.filter((one) =>
        one.checks.some((check) => kept.some((k) => k.id === check)),
      );
      return Promise.resolve({
        contract:
          requirements.length === 0
            ? null
            : freezeGoalContract({ ...contract, requirements, checks: kept }).contract,
        decisions: planned.map((one) => ({
          check: one.id,
          atBase: one.atBase ?? null,
          observed: admit.includes(one.id) ? ("rejected" as const) : ("accepted" as const),
          admitted: admit.includes(one.id),
          reason: admit.includes(one.id) ? "admitted" : "it passes on the base",
          broken: false,
          excerpt: null,
          record: null,
        })),
        droppedRequirements: [],
      });
    };
  }

  function controlled(admissionMs: number) {
    let now = 0;
    return {
      clock: { now: () => now, sleep: () => Promise.resolve() },
      advance: (by: number) => {
        now += by;
      },
      admissionMs: () => admissionMs,
    };
  }

  it("withholds the revision on the record when its re-admission would not fit", async () => {
    const time = controlled(100_000);
    const { planner, notes } = deps([declaring(["a", "b"]), respondWithText("pinned")], {
      clock: time.clock,
      maxWallMs: 200_000,
      admit: admitting(["a"], time.admissionMs, time.advance),
    });
    const outcome = await planChecks(planner);
    expect(outcome.kind).toBe("sealed");
    expect(outcome.admission?.revision).toEqual({
      outcome: "withheld",
      remainingMs: 100_000,
      neededMs: 160_000,
    });
    expect(outcome.admission?.uncheckedRequirements).toEqual([
      { id: "r-b", description: 'requirement b (the task: "collapses whitespace")' },
    ]);
    expect(notes.join("\n")).toContain("no revision of the dropped planned checks: 100s");
    const planning = await readSessionEvidence(join(root, "sessions"), "run-1-plan");
    const revision = planning.records
      .filter((record) => record.type === "verification-command")
      .map((record) => planning.payloads.get(record.payloadDigest) as { rule?: string })
      .find((payload) => payload.rule === "planned-check-revision-v1");
    expect(revision).toMatchObject({ outcome: "withheld", remainingMs: 100_000 });
  });

  it("revises within what is left after reserving its re-admission, keeping what was admitted", async () => {
    const time = controlled(20_000);
    const { planner } = deps(
      [
        declaring(["a", "b"]),
        respondWithText("pinned"),
        declaring(["c"]),
        respondWithText("replaced"),
      ],
      {
        clock: time.clock,
        maxWallMs: 200_000,
        admit: admitting(["a", "c"], time.admissionMs, time.advance),
      },
    );
    const outcome = await planChecks(planner);
    if (outcome.kind !== "sealed") throw new Error(`sealed, not ${outcome.kind}`);
    expect(outcome.contract.checks.map((one) => one.id)).toEqual(["a", "c"]);
    expect(outcome.admission).toEqual({
      admitted: ["a", "c"],
      dropped: [{ check: "b", reason: "it passes on the base" }],
      uncheckedRequirements: [
        { id: "r-b", description: 'requirement b (the task: "collapses whitespace")' },
      ],
      revision: { outcome: "ran", admitted: ["c"] },
    });
  });
});

it("ends planning at its allowance even while a model call is still unanswered", async () => {
  // A stuck server: the call settles only when it is aborted. A planner whose allowance was
  // checked only between calls waited on one like this until the launch was killed.
  const unanswered = {
    modelId: "fixture:stuck",
    generate: (request: { abortSignal: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        request.abortSignal.addEventListener("abort", () => reject(request.abortSignal.reason), {
          once: true,
        });
      }),
  };
  const { planner } = deps([], {
    maxWallMs: 300,
    createModel: () => unanswered as never,
    admit: () => Promise.reject(new Error("nothing was declared, so nothing is admitted")),
  });
  const started = Date.now();
  const outcome = await planChecks(planner);
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(outcome.kind).toBe("unresolved");
  // The run's own signal is not the planner's: implementation still has its allowance.
  expect(planner.signal.aborted).toBe(false);
});
