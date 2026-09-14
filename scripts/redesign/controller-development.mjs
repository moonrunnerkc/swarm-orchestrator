import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createSystemClock } from "../../src/cli-runtime-inputs.ts";
import { bundleSourceFromRecorder } from "../../src/evidence/bundle.ts";
import { asJsonValue, digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { exportCombinedBundle } from "../../src/evidence/combined-bundle.ts";
import { freezeGoalContract } from "../../src/evidence/goal-contract.ts";
import { LedgerWriteFailedError } from "../../src/evidence/ledger.ts";
import { createRecordingModelClient } from "../../src/evidence/model-call-recording.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { createEphemeralSigningKey } from "../../src/evidence/signing.ts";
import { verifyBundle } from "../../src/evidence/verifier/verify.mjs";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { createProviderRegistry } from "../../src/providers/registry.ts";
import { controllerEvents } from "../../src/workers/controller-events.ts";
import { replayController } from "../../src/workers/controller-state.ts";
import { runInParallel } from "../../src/workers/parallel-run.ts";
import { readTaskGraph } from "../../src/workers/task-graph.ts";
import { developmentGoals } from "./development-goals.mjs";

const execute = promisify(execFile);
const sourceRoot = resolve(new URL("../..", import.meta.url).pathname);
const root = resolve(process.argv[2] ?? "");
const modelId = process.argv[3] ?? "swarm-redesign-qwen36-32k:latest";
if (
  !process.argv[2] ||
  root === sourceRoot ||
  root.startsWith(`${sourceRoot}/`) ||
  /cloud/i.test(modelId)
)
  throw new Error(
    "Supply a new directory outside the source workspace and a locally installed model.",
  );
const git = async (cwd, ...argv) =>
  (
    await execute("git", argv, {
      cwd,
      env: harnessChildEnvironment().variables,
      timeout: 30000,
      maxBuffer: 64000000,
    })
  ).stdout.trim();
if (await git(sourceRoot, "status", "--porcelain"))
  throw new Error("Commit the measured source before freezing the development protocol.");
const sourceCommit = await git(sourceRoot, "rev-parse", "HEAD");
const inventory = await (await fetch("http://127.0.0.1:11434/api/tags")).json();
const model = inventory.models.find((candidate) => candidate.name === modelId);
if (!model || model.remote_host || model.remote_model)
  throw new Error("Local weights unavailable; remote fallback is prohibited.");
const clock = createSystemClock();
await mkdir(root, { mode: 0o700 });
const campaign = await openEvidenceSession({
  root: join(root, "sessions"),
  sessionId: "development",
  clock,
});
const protocol = {
  version: 1,
  kind: "controller-development",
  sourceCommit,
  driverDigest: digestOfBytes(await readFile(new URL(import.meta.url))),
  fixturesDigest: digestOfBytes(
    await readFile(new URL("./development-goals.mjs", import.meta.url)),
  ),
  model,
  localThinking: false,
  prompt: "legacy",
  population:
    "six maintainer-authored synthetic development goals, including deliberately flawed initial decompositions",
  cases: developmentGoals,
  schedule: developmentGoals.map((goal) => goal.id),
  repeats: 1,
  budgets: { tokens: 600000, wallMs: 600000 },
  limits: {
    maxSteps: 16,
    attempts: 1,
    repairAttempts: 2,
    graphRevisions: 4,
    modelConcurrency: 1,
    testConcurrency: 1,
    worktreeConcurrency: 2,
  },
  stopping:
    "fixed six launches; retain every refusal, timeout, unknown usage and unlaunched remainder after cancellation",
  includesPlanning: false,
  includesVerification: true,
  interruptions:
    "one declared in-process crash injection after a persisted accepted landing; production crash/restart tests separately kill an actual process",
  acceptance:
    "same pinned behavior artifacts for initial and repaired candidates; checks are maintainer model-authored development instruments, not independent ground truth",
};
await campaign.record({
  type: "campaign-protocol",
  actor: "harness",
  provenance: ["user", "model"],
  payload: asJsonValue(protocol),
});
await writeFile(join(root, "protocol.json"), JSON.stringify(protocol, null, 2), {
  mode: 0o600,
  flag: "wx",
});
const cancellation = new AbortController();
process.once("SIGINT", () => cancellation.abort(new Error("development campaign interrupted")));
process.once("SIGTERM", () => cancellation.abort(new Error("development campaign terminated")));
const registry = createProviderRegistry({
  localBaseUrl: "http://127.0.0.1:11434/v1",
  localThinking: false,
});
const signingKey = createEphemeralSigningKey();
const observations = [];
for (const goal of developmentGoals) {
  if (cancellation.signal.aborted) {
    await campaign.record({
      type: "campaign-observation",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { phase: "not-launched", id: goal.id, reason: "campaign cancellation" },
    });
    continue;
  }
  const started = clock.now();
  await campaign.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { phase: "launch", id: goal.id, started },
  });
  console.log(JSON.stringify({ phase: "launch", id: goal.id }));
  const directory = join(root, goal.id);
  const repository = join(directory, "repo");
  const sessions = new Map();
  let coordinator;
  let measured;
  let failure = null;
  let interrupted = false;
  let acceptedBeforeInterruption = [];
  try {
    await mkdir(repository, { recursive: true, mode: 0o700 });
    for (const [path, content] of Object.entries({
      ...goal.files,
      "package.json": `${JSON.stringify({ type: "module", scripts: { test: "node --test" } })}\n`,
      ".gitignore": "node_modules/\n",
    }))
      await writeFile(join(repository, path), content);
    await git(repository, "init", "--quiet");
    await git(repository, "add", ".");
    await git(
      repository,
      "-c",
      "user.name=Swarm development",
      "-c",
      "user.email=development@example.com",
      "commit",
      "--quiet",
      "-m",
      "frozen synthetic development base",
    );
    const baseCommit = await git(repository, "rev-parse", "HEAD");
    coordinator = await openEvidenceSession({
      root: join(directory, "sessions"),
      sessionId: "queue",
      clock,
    });
    const contract = freezeGoalContract({
      version: 1,
      goal: goal.goal,
      requirements: [{ id: goal.id, description: goal.goal, checks: ["combined"] }],
      immutablePaths: ["base.test.js", "package.json", ".gitignore"],
      checks: [
        {
          id: "combined",
          command: "node .acceptance/combined.mjs",
          author: "model",
          exposure: "withheld",
          artifacts: [{ path: ".acceptance/combined.mjs", content: goal.check }],
        },
      ],
    }).contract;
    const options = {
      repositoryRoot: repository,
      baseRef: baseCommit,
      runId: goal.id,
      scratchRoot: join(directory, "worktrees"),
      coordinator,
      tasks: goal.tasks ?? goal.nodes.map((task) => task.instruction),
      ...(goal.nodes
        ? { graph: readTaskGraph({ goal: goal.goal, nodes: goal.nodes }), graphSource: "file" }
        : {}),
      controllerScope: { kind: "workspace", allowedPaths: [], immutablePaths: [] },
      goalContract: contract,
      createWorkerSession: async (workerId) => {
        const evidence = await openEvidenceSession({
          root: join(directory, "sessions"),
          sessionId: workerId,
          clock,
        });
        sessions.set(workerId, evidence);
        return evidence;
      },
      createModel: (_workerId, evidence) =>
        createRecordingModelClient(registry.create({ provider: "local", modelId }), evidence),
      clock,
      random: { next: () => 0.5 },
      emit: () => {},
      maxSteps: protocol.limits.maxSteps,
      attempts: protocol.limits.attempts,
      repairAttempts: protocol.limits.repairAttempts,
      redundancy: 1,
      concurrency: protocol.limits.worktreeConcurrency,
      modelConcurrency: protocol.limits.modelConcurrency,
      testConcurrency: protocol.limits.testConcurrency,
      graphRevisionLimit: protocol.limits.graphRevisions,
      maxTokens: protocol.budgets.tokens,
      remainingWallMs: () => Math.max(0, started + protocol.budgets.wallMs - clock.now()),
      modelSpec: `local:${modelId}`,
      abortSignal: cancellation.signal,
      peerInformation: goal.peerInformation !== false,
    };
    const injected = {
      ...coordinator,
      record: async (entry) => {
        const captured = await coordinator.record(entry);
        if (
          goal.interruptAfterLanding &&
          !interrupted &&
          entry.type === "controller-transition" &&
          entry.payload.kind === "integration-completed" &&
          entry.payload.landed === true
        ) {
          interrupted = true;
          acceptedBeforeInterruption = [...replayController(coordinator).accepted.values()].map(
            (candidate) => candidate.workerId,
          );
          throw new LedgerWriteFailedError(
            coordinator.ledgerPath,
            new Error("declared development crash after landing completion"),
          );
        }
        return captured;
      },
    };
    try {
      measured = await runInParallel({ ...options, coordinator: injected });
    } catch (cause) {
      if (!interrupted || !(cause instanceof LedgerWriteFailedError)) throw cause;
      await campaign.record({
        type: "campaign-observation",
        actor: "harness",
        provenance: ["tool-output"],
        payload: {
          phase: "injected-crash",
          id: goal.id,
          detail: cause.message,
          acceptedBeforeInterruption,
        },
      });
      measured = await runInParallel({ ...options, resume: true });
    }
  } catch (cause) {
    failure = cause instanceof Error ? cause.message : String(cause);
  }
  let bundle = null;
  let integrity = null;
  if (coordinator) {
    bundle = join(directory, "bundle");
    try {
      await exportCombinedBundle({
        coordinator: bundleSourceFromRecorder(coordinator),
        workers: [...sessions].map(([workerId, evidence]) => ({
          workerId,
          source: bundleSourceFromRecorder(evidence),
        })),
        destination: bundle,
        signingKey,
        clock,
      });
      const lines = [];
      integrity = verifyBundle(bundle, (line) => lines.push(line));
      await writeFile(join(directory, "verify.log"), lines.join("\n"), { mode: 0o600, flag: "wx" });
    } catch (cause) {
      failure = [failure, cause instanceof Error ? cause.message : String(cause)]
        .filter(Boolean)
        .join("; ");
    }
  }
  const events = coordinator ? controllerEvents(coordinator) : [];
  const state = coordinator ? replayController(coordinator) : null;
  const observed = {
    id: goal.id,
    elapsedMs: clock.now() - started,
    accepted: measured?.outcome.goalAccepted === true,
    outcome: measured?.outcome ?? null,
    error: failure,
    bundle,
    integrity,
    interrupted,
    acceptedBeforeInterruption,
    branch: measured?.integrationBranch ?? null,
    commit: measured?.headCommit ?? null,
    repairRequests: events.filter((event) =>
      ["repair-requested", "goal-repair-requested"].includes(event.kind),
    ),
    landings:
      measured?.queue?.landings.map(({ workerId, landed, reason, commit }) => ({
        workerId,
        landed,
        reason,
        commit,
      })) ?? [],
    attempts:
      measured?.workers.map(
        ({ workerId, taskId, baseCommit, graphRevision, green, commit, detail }) => ({
          workerId,
          taskId,
          baseCommit,
          graphRevision,
          green,
          commit,
          detail,
        }),
      ) ?? [],
    graph: state?.graph ?? null,
    resources: await git(repository, "worktree", "list", "--porcelain").catch(
      (cause) => `unavailable: ${cause.message}`,
    ),
    evidence: coordinator?.directory ?? null,
    head: coordinator?.head() ?? null,
  };
  observations.push(observed);
  await campaign.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({ phase: "settled", ...observed }),
  });
  await writeFile(join(directory, "observation.json"), JSON.stringify(observed, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({ phase: "settled", ...observed }));
}
await writeFile(join(root, "observations.json"), JSON.stringify(observations, null, 2), {
  mode: 0o600,
  flag: "wx",
});
console.log(
  JSON.stringify({
    phase: "finished",
    accepted: observations.filter((goal) => goal.accepted).length,
    scheduled: developmentGoals.length,
    head: campaign.head(),
  }),
);
