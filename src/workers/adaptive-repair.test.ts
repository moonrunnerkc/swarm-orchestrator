import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { createFixedRandom } from "../core/test-doubles.ts";
import { bundleSourceFromRecorder, exportBundle } from "../evidence/bundle.ts";
import { freezeGoalContract } from "../evidence/goal-contract.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { createEphemeralSigningKey } from "../evidence/signing.ts";
import { verifyBundle } from "../evidence/verifier/verify.mjs";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { controllerEvents } from "./controller-events.ts";
import { runInParallel } from "./parallel-run.ts";
import { readTaskGraph } from "./task-graph.ts";

const command = promisify(execFile);
const clock = createSystemClock();
let scratch = "";
let repository = "";
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-repair-"));
  repository = join(scratch, "repo");
  await mkdir(repository);
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
  );
  await writeFile(join(repository, "a.js"), "export const a = 1;\n");
  await writeFile(join(repository, "b.js"), "export const b = 1;\n");
  await writeFile(
    join(repository, "base.test.js"),
    "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {a} from './a.js'; import {b} from './b.js'; test('interaction', () => assert.notEqual(a+b, 4));\n",
  );
  await command("git", ["init", "-q", repository]);
  await command("git", ["-C", repository, "add", "."]);
  await command("git", [
    "-C",
    repository,
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-qm",
    "base",
  ]);
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function execute(
  edits: Readonly<Record<string, Readonly<Record<string, string>>>>,
  graph?: unknown,
  goal?: unknown,
  repairAttempts = 2,
) {
  const coordinator = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "queue",
    clock,
  });
  const calls: string[] = [];
  const outcome = await runInParallel({
    repositoryRoot: repository,
    baseRef: "HEAD",
    tasks: ["first change", "second change"],
    runId: "repair",
    scratchRoot: join(scratch, "trees"),
    coordinator,
    ...(goal === undefined ? {} : { goalContract: freezeGoalContract(goal).contract }),
    createWorkerSession: (workerId) =>
      openEvidenceSession({ root: join(scratch, "sessions"), sessionId: workerId, clock }),
    createModel: (workerId) => {
      calls.push(workerId);
      const files = edits[workerId] ?? {};
      return createFixtureModelClient({
        modelId: "fixture:repair",
        turns: [
          respondWithToolCalls("scope", [
            { callId: "d", toolName: "declare_file_set", input: { files: Object.keys(files) } },
          ]),
          ...Object.entries(files).map(([path, content], index) =>
            respondWithToolCalls("edit", [
              { callId: `w${index}`, toolName: "write", input: { path, content } },
            ]),
          ),
          respondWithText("done"),
        ],
      });
    },
    ...(graph === undefined ? {} : { graph: readTaskGraph(graph) }),
    clock,
    random: createFixedRandom(),
    emit: () => {},
    maxSteps: 6,
    repairAttempts,
    attempts: 0,
    redundancy: 1,
    concurrency: 2,
    modelConcurrency: 2,
    maxTokens: 1_000_000,
    modelSpec: "fixture:repair",
    abortSignal: new AbortController().signal,
  });
  return { outcome, calls, coordinator, events: controllerEvents(coordinator) };
}

it("repairs a clean merge with behavioral failure against the accepted integration commit", async () => {
  const { outcome, calls, events } = await execute({
    "worker-1": { "a.js": "export const a = 2;\n" },
    "worker-2": { "b.js": "export const b = 2;\n" },
    "task-2-repair-1": { "b.js": "export const b = 3;\n" },
  });
  expect(outcome.workers.slice(0, 2).every((worker) => worker.green)).toBe(true);
  expect(
    outcome.queue?.landings.map((landing) => [landing.workerId, landing.landed, landing.reason]),
  ).toEqual([
    ["worker-1", true, null],
    ["worker-2", false, "gates"],
    ["task-2-repair-1", true, null],
  ]);
  expect(calls.slice(0, 2).sort()).toEqual(["worker-1", "worker-2"]);
  expect(calls.slice(2)).toEqual(["task-2-repair-1"]);
  const repair = events.find((event) => event.kind === "repair-requested");
  expect(repair).toMatchObject({
    previousWorkerId: "worker-2",
    baseCommit: outcome.queue?.landings[0]?.commit,
  });
  const retained = await command("git", ["-C", repository, "rev-parse", "swarm/repair/worker-2"]);
  expect(retained.stdout.trim()).toBe(outcome.workers[1]?.commit);
});

it("recovers a textual conflict with a bounded new attempt and preserves both observations", async () => {
  const { outcome } = await execute({
    "worker-1": { "a.js": "export const a = 2;\n" },
    "worker-2": { "a.js": "export const a = 4;\n" },
    "task-2-repair-1": { "a.js": "export const a = 5;\n" },
  });
  expect(outcome.queue?.landings.map((landing) => landing.reason)).toEqual([
    null,
    "merge-conflict",
    null,
  ]);
  expect(outcome.queue?.landings.at(-1)?.landed).toBe(true);
});

it("reuses a failed test attempt after a missing prerequisite lands without restarting it", async () => {
  const test =
    "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {beta} from './beta.js'; test('beta', () => assert.equal(beta, 7));\n";
  const { outcome, calls } = await execute(
    {
      "worker-1": { "beta.test.js": test },
      "worker-2": { "beta.js": "export const beta = 7;\n" },
      "task-1-repair-1": { "beta.test.js": test },
    },
    {
      goal: "add beta and exercise it",
      nodes: [
        { id: "a-test-beta", title: "test", instruction: "test beta", files: ["beta.test.js"] },
        {
          id: "z-create-beta",
          title: "implementation",
          instruction: "create beta",
          files: ["beta.js"],
        },
      ],
    },
  );
  expect(outcome.workers[0]?.green).toBe(false);
  expect(outcome.workers[0]?.commit).not.toBeNull();
  expect(outcome.queue?.landings.map((landing) => landing.workerId)).toEqual([
    "worker-2",
    "task-1-repair-1",
  ]);
  expect(outcome.queue?.landings.every((landing) => landing.landed)).toBe(true);
  expect(calls.slice(0, 2).sort()).toEqual(["worker-1", "worker-2"]);
  expect(calls.slice(2)).toEqual(["task-1-repair-1"]);
});

const goal = {
  version: 1,
  goal: "implement both sides of the interaction",
  immutablePaths: ["base.test.js"],
  requirements: [
    { id: "first-side", description: "a is two", checks: ["interaction"] },
    { id: "second-side", description: "b is three", checks: ["interaction"] },
  ],
  checks: [
    {
      id: "interaction",
      command: "node acceptance.mjs",
      author: "user",
      exposure: "withheld",
      artifacts: [
        {
          path: "acceptance.mjs",
          content:
            "import assert from 'node:assert/strict'; import {a} from './a.js'; import {b} from './b.js'; assert.equal(a, 2); assert.equal(b, 3);\n",
        },
      ],
    },
  ],
};
it("refuses goal omission even when every worker and integrated regression check passes", async () => {
  const { outcome } = await execute(
    {
      "worker-1": { "a.js": "export const a = 2;\n" },
      "worker-2": { "b.js": "export const b = 1; // implementation omitted\n" },
    },
    undefined,
    goal,
  );
  expect(outcome.workers.every((worker) => worker.green)).toBe(true);
  expect(outcome.outcome.regression).toBe("pass");
  expect(outcome.outcome.goalAccepted).toBe(false);
  expect(outcome.outcome.exitCode).toBe(1);
  expect(
    outcome.outcome.requirements.every((requirement) => requirement.status === "rejected"),
  ).toBe(true);
});
it("accepts the repaired exact tree and exports re-derivable goal and controller outcomes", async () => {
  const { outcome, coordinator } = await execute(
    {
      "worker-1": { "a.js": "export const a = 2;\n" },
      "worker-2": { "b.js": "export const b = 2;\n" },
      "task-2-repair-1": { "b.js": "export const b = 3;\n" },
    },
    undefined,
    goal,
  );
  expect(outcome.outcome.goalAccepted, JSON.stringify(outcome.verification)).toBe(true);
  expect(outcome.outcome.tasks).toHaveLength(2);
  expect(outcome.outcome.tasks.every((task) => task.state === "accepted")).toBe(true);
  expect(outcome.outcome.exitCode).toBe(0);
  const destination = join(scratch, "goal-bundle");
  await exportBundle({
    source: bundleSourceFromRecorder(coordinator),
    destination,
    signingKey: createEphemeralSigningKey(),
    clock,
  });
  const observations: string[] = [];
  expect(
    verifyBundle(destination, (line: string) => observations.push(line)),
    observations.join("\n"),
  ).toBe(0);
});

it("refuses exported acceptance with an erased obligation, even when signed again", async () => {
  const { coordinator } = await execute(
    {
      "worker-1": { "a.js": "export const a = 2;\n" },
      "worker-2": { "b.js": "export const b = 3;\n" },
    },
    undefined,
    goal,
  );
  const forged = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "forged",
    clock,
  });
  for (const entry of coordinator.records()) {
    const payload = JSON.parse(JSON.stringify(coordinator.payloads().get(entry.payloadDigest)));
    if (entry.type === "goal-verification") payload.obligations.pop();
    await forged.record({
      type: entry.type,
      actor: entry.actor,
      provenance: entry.provenance,
      payload,
    });
  }
  const destination = join(scratch, "forged-goal-bundle");
  await exportBundle({
    source: bundleSourceFromRecorder(forged),
    destination,
    signingKey: createEphemeralSigningKey(),
    clock,
  });
  const observations: string[] = [];
  expect(verifyBundle(destination, (line: string) => observations.push(line))).toBe(1);
  expect(observations.join("\n")).toContain("goal obligations");
});

it("stops repeated ineffective repairs before the attempt ceiling and retains the exact blocker", async () => {
  const { outcome, calls, events } = await execute(
    {
      "worker-1": { "a.js": "export const a = 2;\n" },
      "worker-2": { "b.js": "export const b = 2;\n" },
      "task-2-repair-1": { "b.js": "export const b = 2;\n" },
      "task-2-repair-2": { "b.js": "export const b = 2;\n" },
    },
    undefined,
    undefined,
    4,
  );
  expect(calls).toHaveLength(4);
  expect(
    events.some(
      (event) =>
        event.kind === "repair-exhausted" && event.reason.includes("repeated ineffective repair"),
    ),
  ).toBe(true);
  expect(outcome.outcome.tasks.find((task) => task.id === "task-2")?.blocker).toContain("tests");
  expect(outcome.outcome.tasks.find((task) => task.id === "task-1")?.state).toBe("accepted");
  expect(outcome.outcome.exitCode).toBe(1);
});
