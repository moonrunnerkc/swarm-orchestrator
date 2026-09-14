import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { createFixedRandom } from "../core/test-doubles.ts";
import { freezeGoalContract } from "../evidence/goal-contract.ts";
import { LedgerWriteFailedError } from "../evidence/ledger.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { controllerEvents } from "./controller-events.ts";
import { replayController } from "./controller-state.ts";
import { type ParallelRunOptions, runInParallel } from "./parallel-run.ts";
import { readTaskGraph } from "./task-graph.ts";

const git = promisify(execFile);
const clock = createSystemClock();
let root = "";
let repository = "";
let calls: string[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "controller-recovery-"));
  repository = join(root, "repo");
  calls = [];
  await mkdir(repository);
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
  );
  await writeFile(join(repository, "a.js"), "export const a = 1;\n");
  await writeFile(join(repository, "b.js"), "export const b = 1;\n");
  await writeFile(
    join(repository, "base.test.js"),
    "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {a} from './a.js'; import {b} from './b.js'; test('regression',()=>{assert.equal(typeof a, 'number'); assert.equal(typeof b, 'number');});\n",
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
async function open() {
  return openEvidenceSession({ root: join(root, "sessions"), sessionId: "queue", clock });
}
function options(coordinator: EvidenceRecorder): ParallelRunOptions {
  return {
    coordinator,
    repositoryRoot: repository,
    baseRef: "HEAD",
    scratchRoot: join(root, "trees"),
    runId: "recovery",
    tasks: ["first", "second"],
    graph: readTaskGraph({
      goal: "change both",
      nodes: [
        { id: "first", title: "first", instruction: "first", files: ["a.js"] },
        {
          id: "second",
          title: "second",
          instruction: "second",
          files: ["b.js"],
          dependsOn: ["first"],
        },
      ],
    }),
    goalContract: freezeGoalContract({
      version: 1,
      goal: "change both",
      requirements: [{ id: "both", description: "a is two and b is three", checks: ["both"] }],
      immutablePaths: ["base.test.js"],
      checks: [
        {
          id: "both",
          command: "node acceptance.mjs",
          author: "user",
          exposure: "withheld",
          artifacts: [
            {
              path: "acceptance.mjs",
              content:
                "import assert from 'node:assert/strict'; import {a} from './a.js'; import {b} from './b.js'; assert.equal(a,2); assert.equal(b,3);\n",
            },
          ],
        },
      ],
    }).contract,
    createWorkerSession: (workerId) =>
      openEvidenceSession({ root: join(root, "sessions"), sessionId: workerId, clock }),
    createModel(workerId) {
      calls.push(workerId);
      const first = workerId === "worker-1" || workerId.startsWith("task-1");
      const path = first ? "a.js" : "b.js";
      return createFixtureModelClient({
        modelId: "fixture:recovery",
        turns: [
          respondWithToolCalls("declare", [
            { callId: "d", toolName: "declare_file_set", input: { files: [path] } },
          ]),
          respondWithToolCalls("edit", [
            {
              callId: "w",
              toolName: "write",
              input: { path, content: first ? "export const a = 2;\n" : "export const b = 3;\n" },
            },
          ]),
          respondWithText("done"),
        ],
      });
    },
    clock,
    random: createFixedRandom(),
    emit: () => {},
    maxSteps: 5,
    attempts: 0,
    repairAttempts: 2,
    redundancy: 1,
    concurrency: 1,
    modelSpec: "fixture:recovery",
    maxTokens: 1000000,
    abortSignal: new AbortController().signal,
  };
}
function interrupted(evidence: EvidenceRecorder, kind: string, before: boolean): EvidenceRecorder {
  let armed = true;
  return {
    ...evidence,
    record: async (entry) => {
      const payload = entry.payload;
      const matches =
        armed &&
        (entry.type === kind ||
          (entry.type === "controller-transition" &&
            payload !== null &&
            typeof payload === "object" &&
            "kind" in payload &&
            payload.kind === kind));
      if (matches) armed = false;
      if (matches && before)
        throw new LedgerWriteFailedError(
          evidence.ledgerPath,
          new Error(`injected crash before ${kind}`),
        );
      const written = await evidence.record(entry);
      if (matches)
        throw new LedgerWriteFailedError(
          evidence.ledgerPath,
          new Error(`injected crash after ${kind}`),
        );
      return written;
    },
  };
}

it.each([
  ["integration-resource", false],
  ["dispatch-intent", false],
  ["controller-candidate", true],
  ["controller-candidate", false],
  ["merge-attempt", false],
  ["integration-completed", false],
  ["cleanup-completed", true],
] as const)(
  "resumes a crash at %s (before=%s) without duplicating an accepted landing",
  async (kind, before) => {
    const original = await open();
    await expect(runInParallel(options(interrupted(original, kind, before)))).rejects.toThrow(
      "injected crash",
    );
    const captured = replayController(original);
    const previouslyAccepted = new Map(captured.accepted);
    const restarted = await open();
    const completed = await runInParallel({ ...options(restarted), resume: true });
    expect(completed.outcome.goalAccepted, JSON.stringify(completed.outcome)).toBe(true);
    const board = replayController(restarted);
    expect(board.accepted.size).toBe(2);
    for (const [taskId, accepted] of previouslyAccepted)
      expect(board.accepted.get(taskId)).toEqual(accepted);
    const starts = controllerEvents(restarted).filter((event) => event.kind === "run-started");
    expect(starts).toHaveLength(1);
    const acceptedWorkers = [...board.accepted.values()].map((accepted) => accepted.workerId);
    for (const workerId of acceptedWorkers)
      expect(
        completed.queue?.landings.filter(
          (landing) => landing.workerId === workerId && landing.landed,
        ),
      ).toHaveLength(1);
    expect(
      (await git("git", ["-C", repository, "worktree", "list", "--porcelain"])).stdout.match(
        /^worktree /gm,
      ),
    ).toHaveLength(1);
  },
  60000,
);

it("preserves a torn journal and refuses restart before any new worker call", async () => {
  const original = await open();
  await expect(
    runInParallel(options(interrupted(original, "dispatch-intent", false))),
  ).rejects.toThrow();
  await appendFile(original.ledgerPath, '{"sequence":');
  const bytes = await readFile(original.ledgerPath, "utf8");
  const count = calls.length;
  await expect(open()).rejects.toThrow("preserve the damaged chain");
  expect(await readFile(original.ledgerPath, "utf8")).toBe(bytes);
  expect(calls).toHaveLength(count);
});
it("does not grant a fresh token ceiling when resuming", async () => {
  const original = await open();
  await expect(
    runInParallel(options(interrupted(original, "controller-candidate", false))),
  ).rejects.toThrow();
  const restarted = await open();
  const count = calls.length;
  await expect(
    runInParallel({ ...options(restarted), resume: true, maxTokens: 2000000 }),
  ).rejects.toThrow("original controller budget");
  expect(calls).toHaveLength(count);
});

it("preserves unattributable edits in an interrupted integration worktree", async () => {
  const original = await open();
  await expect(
    runInParallel(options(interrupted(original, "integration-intent", false))),
  ).rejects.toThrow("injected crash");
  const keep = join(root, "trees", "integration", "user-notes.txt");
  await writeFile(keep, "preserve this unrelated work\n");
  const count = calls.length;
  await expect(runInParallel({ ...options(await open()), resume: true })).rejects.toThrow(
    "uncommitted files",
  );
  expect(await readFile(keep, "utf8")).toBe("preserve this unrelated work\n");
  expect(calls).toHaveLength(count);
});
it("refuses a captured candidate whose original session directory was lost", async () => {
  const original = await open();
  await expect(
    runInParallel(options(interrupted(original, "controller-candidate", false))),
  ).rejects.toThrow();
  const intent = [...replayController(original).dispatches.values()][0];
  if (intent?.sessionDirectory === undefined)
    throw new Error("fixture dispatch did not record its session directory");
  await rm(intent.sessionDirectory, { recursive: true });
  const count = calls.length;
  await expect(runInParallel({ ...options(await open()), resume: true })).rejects.toThrow(
    "session directory is missing",
  );
  expect(calls).toHaveLength(count);
});
it("recovers after a real process death immediately after the accepted landing is journaled", async () => {
  const original = await open();
  const initial = options(original);
  const serialized = {
    repositoryRoot: initial.repositoryRoot,
    baseRef: initial.baseRef,
    scratchRoot: initial.scratchRoot,
    runId: initial.runId,
    tasks: initial.tasks,
    graph: initial.graph,
    goalContract: initial.goalContract,
    maxSteps: initial.maxSteps,
    attempts: initial.attempts,
    repairAttempts: initial.repairAttempts,
    redundancy: initial.redundancy,
    concurrency: initial.concurrency,
    modelSpec: initial.modelSpec,
    maxTokens: initial.maxTokens,
  };
  const child = join(root, "crash.mjs");
  await writeFile(
    child,
    `
import {runInParallel} from ${JSON.stringify(new URL("./parallel-run.ts", import.meta.url).href)};
import {openEvidenceSession} from ${JSON.stringify(new URL("../evidence/session.ts", import.meta.url).href)};
import {createSystemClock} from ${JSON.stringify(new URL("../cli-runtime-inputs.ts", import.meta.url).href)};
import {createFixedRandom} from ${JSON.stringify(new URL("../core/test-doubles.ts", import.meta.url).href)};
import {createFixtureModelClient, respondWithText, respondWithToolCalls} from ${JSON.stringify(new URL("../providers/fixture-provider.ts", import.meta.url).href)};
const clock = createSystemClock();
const root = ${JSON.stringify(join(root, "sessions"))};
const calls = [];
const factory = {createModel(workerId) {
  const first = workerId === "worker-1";
  const path = first ? "a.js" : "b.js";
  return createFixtureModelClient({modelId: "fixture:recovery", turns: [
    respondWithToolCalls("declare", [{callId: "d", toolName: "declare_file_set", input: {files: [path]}}]),
    respondWithToolCalls("edit", [{callId: "w", toolName: "write", input: {path, content: first ? "export const a = 2;" : "export const b = 3;"}}]),
    respondWithText("done"),
  ]});
}};
const evidence = await openEvidenceSession({root, sessionId: "queue", clock});
const coordinator = {...evidence, record: async (entry) => {
  const captured = await evidence.record(entry);
  if (entry.type === "controller-transition" && entry.payload.kind === "integration-completed") process.kill(process.pid, "SIGKILL");
  return captured;
}};
await runInParallel({...${JSON.stringify(serialized)}, coordinator, createWorkerSession: (sessionId) => openEvidenceSession({root, sessionId, clock}), createModel: factory.createModel, clock, random: createFixedRandom(), emit: () => {}, abortSignal: new AbortController().signal});
`,
  );
  await expect(git(process.execPath, [child], { timeout: 30000 })).rejects.toMatchObject({
    signal: "SIGKILL",
  });
  const restarted = await open();
  const acceptedBefore = new Map(replayController(restarted).accepted);
  expect(acceptedBefore.size).toBe(1);
  const completed = await runInParallel({ ...options(restarted), resume: true });
  expect(completed.outcome.goalAccepted).toBe(true);
  for (const [taskId, accepted] of acceptedBefore)
    expect(replayController(restarted).accepted.get(taskId)).toEqual(accepted);
  expect(calls).not.toContain("worker-1");
}, 60000);
