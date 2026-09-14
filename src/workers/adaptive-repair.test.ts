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
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { createEphemeralSigningKey } from "../evidence/signing.ts";
import { parseTaskContract } from "../evidence/task-contract.ts";
import { verifyBundle } from "../evidence/verifier/verify.mjs";
import type { GateSetOptions } from "../gates/default-gates.ts";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { controllerEvents } from "./controller-events.ts";
import type { RevisionRequest } from "./controller-revisions.ts";
import type { ControllerScope } from "./controller-scope.ts";
import { replayController } from "./controller-state.ts";
import type { CoordinationEvent } from "./coordination.ts";
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
  controls: {
    controllerScope?: ControllerScope;
    holdUntilDependent?: boolean;
    holdSecondUntilFirst?: boolean;
    gateOptions?: GateSetOptions;
    coordination?: Readonly<Record<string, CoordinationEvent["proposal"]>>;
    revisions?: readonly RevisionRequest[];
  } = {},
) {
  const holdUntilDependent = controls.holdUntilDependent === true;
  let longWaiting = false;
  let dependentStartedWhileWaiting = false;
  let releaseSecond = () => {};
  const secondReady = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const rawCoordinator = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "queue",
    clock,
  });
  const coordinator: EvidenceRecorder = {
    ...rawCoordinator,
    record: async (entry) => {
      const written = await rawCoordinator.record(entry);
      if (
        holdUntilDependent &&
        entry.type === "worker-started" &&
        typeof entry.payload === "object" &&
        entry.payload !== null &&
        "workerId" in entry.payload &&
        entry.payload.workerId === "worker-3"
      ) {
        dependentStartedWhileWaiting = longWaiting;
        releaseSecond();
      }
      if (
        !holdUntilDependent &&
        entry.type === "merge-attempt" &&
        typeof entry.payload === "object" &&
        entry.payload !== null &&
        "landed" in entry.payload &&
        entry.payload.landed === true
      )
        releaseSecond();
      return written;
    },
  };
  const calls: string[] = [];
  const outcome = await runInParallel({
    revisions: controls.revisions ?? [],
    ...(controls.controllerScope === undefined
      ? {}
      : { controllerScope: controls.controllerScope }),
    ...(controls.gateOptions === undefined ? {} : { gateOptions: controls.gateOptions }),
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
      const fixture = createFixtureModelClient({
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
          ...(controls.coordination?.[workerId] === undefined
            ? []
            : [
                respondWithToolCalls("dependency discovery", [
                  {
                    callId: "coord",
                    toolName: "coordinate",
                    input: controls.coordination[workerId],
                  },
                ]),
              ]),
          respondWithText("done"),
        ],
      });
      return {
        modelId: fixture.modelId,
        generate: async (request) => {
          if (
            (graph === undefined || holdUntilDependent || controls.holdSecondUntilFirst) &&
            workerId === "worker-2"
          ) {
            longWaiting = true;
            await secondReady;
            longWaiting = false;
          }
          return fixture.generate(request);
        },
      };
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
  return {
    outcome,
    calls,
    coordinator,
    dependentStartedWhileWaiting,
    events: controllerEvents(coordinator),
  };
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
    0,
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
  expect(calls).toHaveLength(3);
  expect(events.find((event) => event.kind === "repair-requested")).toMatchObject({
    failureDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
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

it("starts a dependent on its accepted prerequisite while an unrelated worker is still running", async () => {
  const { outcome, coordinator, dependentStartedWhileWaiting } = await execute(
    {
      "worker-1": { "a.js": "export const a = 2;\n" },
      "worker-2": { "b.js": "export const b = 4;\n" },
      "worker-3": {
        "dependent.test.js":
          "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {a} from './a.js'; test('prerequisite', () => assert.equal(a, 2));\n",
      },
    },
    {
      goal: "dependent readiness",
      nodes: [
        { id: "a-parent", title: "parent", instruction: "change a", files: ["a.js"] },
        { id: "z-long", title: "long", instruction: "change b", files: ["b.js"] },
        {
          id: "child",
          title: "child",
          instruction: "test parent",
          files: ["dependent.test.js"],
          dependsOn: ["a-parent"],
        },
      ],
    },
    undefined,
    2,
    { holdUntilDependent: true },
  );
  expect(dependentStartedWhileWaiting).toBe(true);
  const parent = outcome.queue?.landings.find((landing) => landing.workerId === "worker-1");
  const child = coordinator
    .records()
    .find(
      (entry) =>
        entry.type === "worker-started" &&
        (coordinator.payloads().get(entry.payloadDigest) as { workerId?: string })?.workerId ===
          "worker-3",
    );
  expect(coordinator.payloads().get(child?.payloadDigest ?? "")).toMatchObject({
    baseCommit: parent?.commit,
  });
  expect(outcome.outcome.tasks.every((task) => task.state === "accepted")).toBe(true);
});

it("turns a typed missing dependency discovery into a revision and refuses the stale candidate", async () => {
  const { outcome, coordinator, calls } = await execute(
    {
      "worker-1": { "a.js": "export const a = 2;\n" },
      "worker-2": { "b.js": "export const b = 5;\n" },
      "task-1-repair-1": { "a.js": "export const a = 2;\n" },
    },
    {
      goal: "change the interaction",
      nodes: [
        { id: "a-consumer", title: "consumer", instruction: "change a", files: ["a.js"] },
        { id: "b-provider", title: "provider", instruction: "change b", files: ["b.js"] },
      ],
    },
    {
      ...goal,
      requirements: [
        { id: "first-side", description: "a is two", checks: ["interaction"] },
        { id: "second-side", description: "b is five", checks: ["interaction"] },
      ],
      checks: goal.checks.map((check) => ({
        ...check,
        artifacts: check.artifacts.map((artifact) => ({
          ...artifact,
          content: artifact.content.replace("assert.equal(b, 3)", "assert.equal(b, 5)"),
        })),
      })),
    },
    2,
    {
      coordination: {
        "worker-1": {
          kind: "dependency-request",
          prerequisite: "b-provider",
          reason: "consumer requires the changed provider interface",
        },
      },
    },
  );
  const board = replayController(coordinator);
  expect(board.graph?.ordinal).toBe(1);
  expect(board.graph?.nodes.find((node) => node.id === "task-1")?.dependsOn).toEqual(["task-2"]);
  expect(board.stale.has("worker-1")).toBe(true);
  expect(outcome.queue?.landings.some((landing) => landing.workerId === "worker-1")).toBe(false);
  expect(outcome.outcome.goalAccepted).toBe(true);
  expect(calls.filter((worker) => worker === "worker-2")).toHaveLength(1);
  expect(calls).toContain("task-1-repair-1");
});

function replacement(id: string, files: string[], obligations: string[]) {
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
      immutablePaths: ["base.test.js", "acceptance.mjs"],
      allowedTools: ["read", "write"],
      network: "unrestricted",
      execution: "restricted",
      requiredChecks: [],
      budget: { maxSteps: 6, maxWallMs: 10000, maxTokens: 100000 },
      riskTier: "medium",
      scopeAuthority: "controller",
    }),
  };
}
it("executes a coupled-task collapse with one worker while preserving both original outcomes", async () => {
  const { outcome, calls, coordinator } = await execute(
    { "coupled-attempt-1": { "a.js": "export const a = 2;\n", "b.js": "export const b = 3;\n" } },
    {
      goal: "change the interaction",
      nodes: [
        { id: "a", title: "a", instruction: "change a", files: ["a.js"] },
        { id: "b", title: "b", instruction: "change b", files: ["b.js"] },
      ],
    },
    goal,
    2,
    {
      revisions: [
        {
          operation: {
            kind: "combine",
            tasks: ["task-1", "task-2"],
            combined: replacement("coupled", ["a.js", "b.js"], ["task-1", "task-2"]),
          },
          reason: "one worker owns the coupled interface",
        },
      ],
    },
  );
  expect(calls).toEqual(["coupled-attempt-1"]);
  expect(outcome.outcome.tasks.map((task) => [task.id, task.state, task.members])).toEqual([
    ["task-1", "accepted", ["coupled"]],
    ["task-2", "accepted", ["coupled"]],
  ]);
  expect(outcome.outcome.goalAccepted).toBe(true);
  const destination = join(scratch, "collapsed-bundle");
  await exportBundle({
    source: bundleSourceFromRecorder(coordinator),
    destination,
    signingKey: createEphemeralSigningKey(),
    clock,
  });
  const lines: string[] = [];
  expect(
    verifyBundle(destination, (line: string) => lines.push(line)),
    lines.join("\n"),
  ).toBe(0);
});
it("cannot accept a split obligation when only one replacement implements its part", async () => {
  const { outcome } = await execute(
    { "first-attempt-1": { "a.js": "export const a = 2;\n" } },
    {
      goal: "change both components",
      nodes: [
        { id: "both", title: "both", instruction: "change a and b", files: ["a.js", "b.js"] },
      ],
    },
    goal,
    0,
    {
      revisions: [
        {
          operation: {
            kind: "split",
            taskId: "task-1",
            parts: [
              replacement("first", ["a.js"], ["task-1"]),
              replacement("second", ["b.js"], ["task-1"]),
            ],
          },
          reason: "independent components",
        },
      ],
    },
  );
  expect(outcome.outcome.tasks).toHaveLength(1);
  expect(outcome.outcome.tasks[0]?.members).toEqual(["first", "second"]);
  expect(outcome.outcome.goalAccepted).toBe(false);
  expect(
    outcome.outcome.requirements.every((requirement) => requirement.status === "rejected"),
  ).toBe(true);
});

it("repairs a regression of a declared advisory requirement on the integrated tree", async () => {
  await writeFile(
    join(repository, "base.test.js"),
    "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('regression',()=>assert.ok(true));\n",
  );
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
    "ordinary regression harness",
  ]);
  const { outcome, calls } = await execute(
    {
      "worker-1": { "a.js": "export const a = 2;\n" },
      "worker-2": { "b.js": "export const b = 2;\n" },
      "task-2-repair-1": { "b.js": "export const b = 3;\n" },
    },
    {
      goal: "compatible components",
      nodes: [
        {
          id: "first",
          title: "first",
          instruction: "change a",
          files: ["a.js"],
          acceptance: ["interaction"],
        },
        { id: "second", title: "second", instruction: "change b", files: ["b.js"] },
      ],
    },
    goal,
    2,
    {
      holdSecondUntilFirst: true,
      gateOptions: {
        commandOverrides: {
          interaction: {
            command: `node --input-type=module -e "import {a} from './a.js'; import {b} from './b.js'; process.exit(a+b === 4 ? 1 : 0)"`,
            severity: "advisory",
          },
        },
      },
    },
  );
  expect(outcome.workers.find((worker) => worker.workerId === "worker-2")?.green).toBe(true);
  expect(
    outcome.queue?.landings.some(
      (landing) =>
        !landing.landed && landing.reason === "ratchet" && landing.feedback.includes("interaction"),
    ),
  ).toBe(true);
  expect(calls.slice(0, 2).sort()).toEqual(["worker-1", "worker-2"]);
  expect(calls.slice(2)).toEqual(["task-2-repair-1"]);
  expect(outcome.outcome.goalAccepted).toBe(true);
});

it.each([true, false])(
  "handles a discovered prerequisite within explicit controller scope (authorized=%s)",
  async (authorized) => {
    const consumer = "import {value} from './helper.js'; export const a = value;\n";
    const { outcome, coordinator, calls } = await execute(
      {
        "worker-1": { "a.js": consumer },
        "worker-2": { "b.js": "export const b = 5;\n" },
        "helper-attempt-1": { "helper.js": "export const value = 2;\n" },
        "task-1-repair-1": { "a.js": consumer },
      },
      {
        goal: "use a missing helper",
        nodes: [
          {
            id: "consumer",
            title: "consumer",
            instruction: "use helper value in a",
            files: ["a.js"],
          },
          { id: "unrelated", title: "unrelated", instruction: "b becomes five", files: ["b.js"] },
        ],
      },
      {
        ...goal,
        goal: "consumer a is two and unrelated b is five",
        requirements: [
          { id: "first-side", description: "a is two", checks: ["interaction"] },
          { id: "second-side", description: "b is five", checks: ["interaction"] },
        ],
        checks: goal.checks.map((check) => ({
          ...check,
          artifacts: check.artifacts.map((artifact) => ({
            ...artifact,
            content: artifact.content.replace("assert.equal(b, 3)", "assert.equal(b, 5)"),
          })),
        })),
      },
      2,
      {
        controllerScope: {
          kind: "files",
          allowedPaths: ["a.js", "b.js", ...(authorized ? ["helper.js"] : [])],
          immutablePaths: [],
        },
        coordination: {
          "worker-1": {
            kind: "dependency-request",
            prerequisite: "helper",
            reason: "the consumer imports a missing helper module",
            missing: { instruction: "create helper.js exporting value two", files: ["helper.js"] },
          },
        },
      },
    );
    const board = replayController(coordinator);
    expect(board.graph?.version).toBe(2);
    expect(calls.filter((id) => id === "worker-2")).toHaveLength(1);
    if (authorized) {
      expect(board.graph?.ordinal).toBe(2);
      expect(board.graph?.nodes.find((node) => node.id === "helper")?.obligations).toEqual([
        "task-1",
      ]);
      expect(board.stale.has("worker-1")).toBe(true);
      expect(outcome.outcome.goalAccepted, JSON.stringify(outcome.outcome)).toBe(true);
      expect(calls).toContain("helper-attempt-1");
      expect(calls).toContain("task-1-repair-1");
      expect(outcome.outcome.tasks.find((task) => task.id === "task-1")?.members).toEqual([
        "task-1",
        "helper",
      ]);
    } else {
      expect(board.graph?.ordinal).toBe(0);
      expect(calls).not.toContain("helper-attempt-1");
      expect(outcome.outcome.goalAccepted).toBe(false);
      expect(
        [...coordinator.payloads().values()].some(
          (payload) =>
            typeof payload === "object" &&
            payload !== null &&
            "disposition" in payload &&
            payload.disposition === "refused" &&
            "reason" in payload &&
            String(payload.reason).includes("pinned user authority"),
        ),
      ).toBe(true);
    }
    const destination = join(scratch, "discovered-bundle");
    await exportBundle({
      source: bundleSourceFromRecorder(coordinator),
      destination,
      signingKey: createEphemeralSigningKey(),
      clock,
    });
    const lines: string[] = [];
    expect(
      verifyBundle(destination, (line: string) => lines.push(line)),
      lines.join("\n"),
    ).toBe(0);
  },
  60000,
);

it("repairs a final goal omission from the accepted tree and retains the failed acceptance", async () => {
  const { outcome, coordinator, calls, events } = await execute(
    {
      "worker-1": { "a.js": "export const a = 2;\n" },
      "worker-2": { "b.js": "export const b = 1; // incomplete goal\n" },
      "goal-repair-1-attempt-1": { "b.js": "export const b = 3;\n" },
    },
    undefined,
    goal,
    1,
  );
  expect(calls.slice(0, 2).sort()).toEqual(["worker-1", "worker-2"]);
  expect(calls.slice(2)).toEqual(["goal-repair-1-attempt-1"]);
  expect(outcome.workers.every((worker) => worker.green)).toBe(true);
  expect(outcome.outcome.goalAccepted, JSON.stringify(outcome.outcome)).toBe(true);
  expect(
    outcome.workers.find((worker) => worker.workerId === "goal-repair-1-attempt-1")?.task,
  ).toContain("Recorded independent verifier observations");
  expect(events.find((event) => event.kind === "goal-repair-requested")).toMatchObject({
    baseCommit: outcome.queue?.landings[1]?.commit,
  });
  const verifications = coordinator
    .records()
    .filter((record) => record.type === "goal-verification")
    .map((record) => coordinator.payloads().get(record.payloadDigest));
  expect(verifications).toMatchObject([{ accepted: false }, { accepted: true }]);
  expect(outcome.outcome.tasks.map((task) => task.members)).toEqual([
    ["goal-repair-1"],
    ["goal-repair-1"],
  ]);
  const destination = join(scratch, "final-repair-bundle");
  await exportBundle({
    source: bundleSourceFromRecorder(coordinator),
    destination,
    signingKey: createEphemeralSigningKey(),
    clock,
  });
  const lines: string[] = [];
  expect(
    verifyBundle(destination, (line: string) => lines.push(line)),
    lines.join("\n"),
  ).toBe(0);
}, 60000);
