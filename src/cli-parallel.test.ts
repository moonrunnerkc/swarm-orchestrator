import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { executeControllerLaunch } from "./cli-parallel.ts";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import { createFixedRandom } from "./core/test-doubles.ts";
import { openRunStore } from "./durable/run-store.ts";
import { freezeGoalContract } from "./evidence/goal-contract.ts";
import { openEvidenceSession } from "./evidence/session.ts";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "./providers/fixture-provider.ts";
import { controllerEvents } from "./workers/controller-events.ts";
import {
  type ControllerLaunch,
  controllerLaunch,
  declareControllerLaunch,
} from "./workers/controller-launch.ts";

const git = promisify(execFile);
const clock = createSystemClock();
let root: string;
let repository: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "controller-cli-"));
  repository = join(root, "repo");
  await mkdir(repository);
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
  );
  await writeFile(join(repository, "a.js"), "export const a = 1;\n");
  await writeFile(
    join(repository, "base.test.js"),
    "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {a} from './a.js'; test('number',()=>assert.equal(typeof a, 'number'));\n",
  );
  await git("git", ["init", "-q", repository]);
  await git("git", ["-C", repository, "add", "."]);
  await git("git", [
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
  await rm(root, { recursive: true, force: true });
});
async function fixture(overrides: Partial<ControllerLaunch> = {}) {
  const sessionRoot = join(root, "sessions");
  const coordinator = await openEvidenceSession({
    root: sessionRoot,
    sessionId: "run-queue",
    clock,
  });
  const baseCommit = (await git("git", ["-C", repository, "rev-parse", "HEAD"])).stdout.trim();
  const launch = await declareControllerLaunch(coordinator, {
    version: 1,
    runId: "run",
    repositoryRoot: repository,
    baseCommit,
    scratchRoot: join(root, "trees"),
    goal: "a becomes two",
    tasks: [],
    graph: null,
    suppliedGoal: freezeGoalContract({
      version: 1,
      goal: "a becomes two",
      requirements: [{ id: "two", description: "a is two", checks: ["two"] }],
      immutablePaths: ["base.test.js"],
      checks: [
        {
          id: "two",
          command: "node acceptance.mjs",
          author: "user",
          exposure: "withheld",
          artifacts: [
            {
              path: "acceptance.mjs",
              content:
                "import assert from 'node:assert/strict'; import {a} from './a.js'; assert.equal(a,2);\n",
            },
          ],
        },
      ],
    }).contract,
    modelSpec: "fixture:cli",
    localBaseUrl: null,
    localThinking: null,
    maxSteps: 5,
    attempts: 0,
    maxWallMs: 60000,
    maxTokens: 1000000,
    repairAttempts: 2,
    redundancy: 1,
    concurrency: 1,
    modelConcurrency: 1,
    testConcurrency: 1,
    isolation: null,
    gateOptions: {},
    bundleDirectory: null,
    ...overrides,
  });
  return {
    launch,
    runtime: {
      coordinator,
      clock,
      random: createFixedRandom(),
      sessionRoot,
      home: root,
      storePath: join(root, "runs.jsonl"),
    },
  };
}
it.each([false, true])(
  "accounts for planning and resumes without another producer call (scope v2=%s)",
  async (scoped) => {
    const { launch, runtime } = await fixture(
      scoped
        ? {
            version: 2,
            controllerScope: { kind: "files", allowedPaths: ["a.js"], immutablePaths: [] },
          }
        : {},
    );
    let calls = 0;
    const createModel = () =>
      createFixtureModelClient({
        modelId: "fixture:cli",
        turns:
          calls++ === 0
            ? [
                respondWithToolCalls("plan", [
                  {
                    callId: "graph",
                    toolName: "declare_task_graph",
                    input: {
                      goal: launch.goal,
                      nodes: [
                        {
                          id: "change",
                          title: "change",
                          instruction: "a becomes two",
                          files: ["a.js"],
                        },
                      ],
                    },
                  },
                ]),
                respondWithText("planned"),
              ]
            : [
                respondWithToolCalls("declare", [
                  { callId: "d", toolName: "declare_file_set", input: { files: ["a.js"] } },
                ]),
                respondWithToolCalls("edit", [
                  {
                    callId: "w",
                    toolName: "write",
                    input: { path: "a.js", content: "export const a = 2;\n" },
                  },
                ]),
                respondWithText("done"),
              ],
      });
    const completed = await executeControllerLaunch(launch, { ...runtime, createModel });
    expect(completed.outcome.goalAccepted).toBe(true);
    expect(calls).toBe(2);
    const store = openRunStore(runtime.storePath);
    expect(store.steps("run").some((step) => step.kind === "planning")).toBe(true);
    expect(store.remainingTokens("run")).toBe(completed.outcome.usage.remaining);
    const restarted = await openEvidenceSession({
      root: runtime.sessionRoot,
      sessionId: "run-queue",
      clock,
    });
    const captured = controllerLaunch(restarted);
    expect(captured).toEqual(launch);
    const resumed = await executeControllerLaunch(launch, {
      ...runtime,
      coordinator: restarted,
      createModel: () => {
        throw new Error("accepted producer must not rerun");
      },
    });
    expect(resumed.headCommit).toBe(completed.headCommit);
    expect(resumed.outcome.goalAccepted).toBe(true);
    expect(
      controllerEvents(restarted).filter((event) => event.kind === "run-started"),
    ).toHaveLength(1);
    store.close();
  },
  60000,
);
it("observes administrative cancellation during planning and retains unknown usage on restart", async () => {
  const { launch, runtime } = await fixture();
  let calls = 0;
  const createModel = () => ({
    modelId: "fixture:cli",
    generate: async () => {
      calls += 1;
      const store = openRunStore(runtime.storePath);
      store.abortRun("run", "test administrative cancellation", clock.now());
      store.close();
      return new Promise<never>(() => {});
    },
  });
  await expect(executeControllerLaunch(launch, { ...runtime, createModel })).rejects.toThrow(
    "planning stopped",
  );
  expect(calls).toBe(1);
  const store = openRunStore(runtime.storePath);
  expect(store.run("run")?.state).toBe("aborted");
  expect(store.remainingTokens("run")).toBeLessThan(launch.maxTokens);
  const restarted = await openEvidenceSession({
    root: runtime.sessionRoot,
    sessionId: "run-queue",
    clock,
  });
  await expect(
    executeControllerLaunch(launch, { ...runtime, coordinator: restarted, createModel }),
  ).rejects.toThrow("unresolved provider usage");
  expect(calls).toBe(1);
  store.close();
}, 30000);

it("cancels queued alternatives without creating their worktrees or calling a provider", async () => {
  const { launch, runtime } = await fixture({
    goal: null,
    graph: null,
    tasks: ["a becomes two"],
    redundancy: 3,
  });
  let calls = 0;
  const completed = await executeControllerLaunch(launch, {
    ...runtime,
    createModel: () => ({
      modelId: "fixture:cli",
      generate: async () => {
        calls += 1;
        const store = openRunStore(runtime.storePath);
        store.abortRun("run", "stop queued alternatives", clock.now());
        store.close();
        return new Promise<never>(() => {});
      },
    }),
  });
  expect(completed.outcome.status).toBe("cancelled");
  expect(completed.outcome.exitCode).toBe(130);
  expect(calls).toBe(1);
  expect(
    controllerEvents(runtime.coordinator).filter(
      (event) => event.kind === "attempt-not-dispatched",
    ),
  ).toHaveLength(2);
  const dispatched = runtime.coordinator.records().filter((record) => {
    const entry = runtime.coordinator.payloads().get(record.payloadDigest);
    return (
      record.type === "controller-transition" &&
      entry !== null &&
      typeof entry === "object" &&
      "kind" in entry &&
      entry.kind === "dispatch-intent"
    );
  });
  expect(dispatched).toHaveLength(1);
}, 30000);
