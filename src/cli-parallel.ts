import { execFile } from "node:child_process";
import { mkdtemp, readFile, rmdir } from "node:fs/promises";
import { availableParallelism, homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveLocalBackend } from "./cli-local-backend.ts";
import type { ParallelCommand } from "./cli-options.ts";
import { runStorePath } from "./cli-run-commands.ts";
import { gateOptionsFrom, registrySettingsFrom, settingsFor } from "./cli-run-settings.ts";
import { createSystemClock, createSystemRandom } from "./cli-runtime-inputs.ts";
import type { Clock } from "./core/clock.ts";
import type { ModelClient } from "./core/model-client.ts";
import type { RandomSource } from "./core/random-source.ts";
import { controllerSessionId } from "./durable/controller-location.ts";
import { bundleSourceFromRecorder } from "./evidence/bundle.ts";
import { asJsonValue, digestOfJson } from "./evidence/canonical-json.ts";
import { exportCombinedBundle } from "./evidence/combined-bundle.ts";
import { freezeGoalContract } from "./evidence/goal-contract.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import {
  createSessionId,
  defaultSessionRoot,
  type EvidenceRecorder,
  openEvidenceSession,
} from "./evidence/session.ts";
import { createKeychainSecretStore, resolveSigningKey } from "./evidence/signing.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import { containerClientEnvironment } from "./exec/container-backend.ts";
import { parseIsolationOption } from "./exec/isolation-option.ts";
import { createRunCancellation } from "./exec/run-cancellation.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import { localEndpointRecord } from "./providers/endpoint-resolution.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { describeLoopEvent } from "./tui/plain-lines.ts";
import { controllerAdministration } from "./workers/controller-administration.ts";
import { withControllerCleanup } from "./workers/controller-cleanup.ts";
import { controllerConfiguration } from "./workers/controller-configuration.ts";
import {
  type ControllerLaunch,
  controllerLaunch,
  controllerLaunchSchema,
  declareControllerLaunch,
} from "./workers/controller-launch.ts";
import { acquireControllerOwner } from "./workers/controller-owner.ts";
import { reconcileController, repairControllerRuntime } from "./workers/controller-recovery.ts";
import { renderParallelReport } from "./workers/parallel-report.ts";
import { type ParallelRunResult, runInParallel } from "./workers/parallel-run.ts";
import { type PlannerOutcome, runPlanner } from "./workers/planner-run.ts";
import { defaultWorkerConcurrency } from "./workers/pool.ts";
import { createRunContext, type RunContext } from "./workers/run-context.ts";
import { readTaskGraph, type TaskGraph } from "./workers/task-graph.ts";

async function readTasksFile(
  path: string,
): Promise<{ tasks: readonly string[]; graph: TaskGraph | null }> {
  const text = await readFile(path, "utf8");

  if (text.trimStart().startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new Error(`${path} starts like JSON but is not: ${(cause as Error).message}`);
    }
    const graph = readTaskGraph(parsed);
    return { tasks: graph.nodes.map((node) => node.instruction), graph };
  }

  const tasks = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (tasks.length === 0) {
    throw new Error(
      `${path} names no tasks. Put one task per line; lines starting with # are ignored. A ` +
        "file that begins with { is read as a JSON task graph instead.",
    );
  }
  return { tasks, graph: null };
}

interface DecomposeContext {
  readonly runContext: RunContext;
  readonly requireGoalChecks: boolean;
  readonly workspace: string;
  readonly sessionRoot: string;
  readonly runId: string;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly home: string;
  readonly model: () => ModelClient;
  readonly maxSteps: number;
}

/** The planner, on a chain of its own, so what it read before deciding is on the record. */
/**
 * What to try next, per way the planner can end without a graph. Each of these wants a
 * different thing done about it, which is the whole reason the stop reason travels.
 */
function describePlannerStop(stopReason: string): string {
  switch (stopReason) {
    case "empty-response":
      return (
        "The model answered with neither text nor a tool call, which a broad goal tends to " +
        "produce: try one that names a single piece of work."
      );
    case "output-cap":
      return (
        "It was cut off at the output-token cap before it said anything, which is what a " +
        "reasoning model does when it spends the whole budget thinking: try a model that " +
        "reasons less, or a goal that needs less of it."
      );
    case "max-steps":
      return "It ran out of steps before it declared anything: raise --max-steps.";
    case "max-wall-time":
      return "It ran out of wall time before it declared anything: raise --max-wall-minutes.";
    case "completed":
      return (
        "It finished without calling declare_task_graph, so it either answered in prose or " +
        "could not drive the tool: check its session, and try a narrower goal."
      );
    case "model-error":
      return "The model could not be reached; the error is on its chain.";
    default:
      return "Its chain records what happened.";
  }
}

async function decompose(goal: string, context: DecomposeContext): Promise<PlannerOutcome> {
  const evidence = await openEvidenceSession({
    root: context.sessionRoot,
    sessionId: `${context.runId}-plan`,
    clock: context.clock,
  });
  process.stdout.write(`planning: ${goal}\n`);

  const outcome = await runPlanner({
    goal,
    workspace: context.workspace,
    homeDir: context.home,
    model: context.runContext.model(
      "planning",
      createRecordingModelClient(context.model(), evidence),
    ),
    requireGoalChecks: context.requireGoalChecks,
    maxTokens: context.runContext.accounting().remaining,
    maxWallTimeMs: context.runContext.remainingWallMs(),
    evidence,
    clock: context.clock,
    random: context.random,
    emit: () => {},
    maxSteps: context.maxSteps,
    abortSignal: context.runContext.signal,
  });

  if (outcome.graph !== null) {
    const named = outcome.graph.nodes.map((node) => node.id).join(", ");
    process.stdout.write(`planned ${outcome.graph.nodes.length} task(s): ${named}\n`);
  }
  return outcome;
}

const execute = promisify(execFile);

export async function parallel(options: ParallelCommand): Promise<number> {
  const settings = await settingsFor(options.workspace, {
    model: options.modelSpec,
    maxSteps: options.maxSteps,
    attempts: options.attempts,
    maxWallMinutes: options.maxWallMinutes,
    localEndpoint: options.localEndpoint,
  });
  const clock = createSystemClock();
  const random = createSystemRandom();
  const sessionRoot = defaultSessionRoot(homedir());
  const runId = createSessionId(clock, random);
  const baseCommit = (
    await execute("git", ["rev-parse", `${options.baseRef}^{commit}`], {
      cwd: options.workspace,
      env: harnessChildEnvironment().variables,
      timeout: 30000,
    })
  ).stdout.trim();
  const fromFile = options.tasksFile === null ? null : await readTasksFile(options.tasksFile);
  const spec = parseModelSpec(settings.modelSpec);
  const localBackend = await resolveLocalBackend(settings, [spec]);
  const registry = createProviderRegistry(registrySettingsFrom(settings, localBackend));
  const isolation = parseIsolationOption(options.isolation, options.workspace);
  const image =
    isolation === null
      ? null
      : (
          await execute(
            isolation.runtime,
            ["image", "inspect", "--format", "{{.Id}}", isolation.image],
            { cwd: options.workspace, env: containerClientEnvironment(), timeout: 15000 },
          )
        ).stdout.trim();
  const coordinator = await openEvidenceSession({
    root: sessionRoot,
    sessionId: `${runId}-queue`,
    clock,
  });
  if (localBackend !== null) await coordinator.record(localEndpointRecord(localBackend));
  const scratchRoot = await mkdtemp(join(tmpdir(), "swarm-parallel-"));
  const launch = await declareControllerLaunch(
    coordinator,
    controllerLaunchSchema.parse({
      version: 1,
      runId,
      repositoryRoot: options.workspace,
      baseCommit,
      scratchRoot,
      goal: options.goal,
      tasks: [...(fromFile?.tasks ?? [])],
      graph: fromFile?.graph ?? null,
      suppliedGoal:
        options.goalChecksFile === undefined
          ? null
          : freezeGoalContract(JSON.parse(await readFile(options.goalChecksFile, "utf8"))).contract,
      modelSpec: settings.modelSpec,
      localBaseUrl: localBackend?.url ?? null,
      localThinking: settings.localThinking,
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
      maxWallMs: (settings.maxWallMinutes ?? 30) * 60000,
      maxTokens: options.maxTokens ?? 200000,
      repairAttempts: options.repairAttempts ?? 2,
      redundancy: options.redundancy ?? 1,
      concurrency:
        options.concurrency ??
        defaultWorkerConcurrency({
          servedLocally: spec.provider === "local",
          cores: availableParallelism(),
        }),
      modelConcurrency: options.modelConcurrency ?? 1,
      testConcurrency: options.testConcurrency ?? 1,
      isolation:
        isolation === null
          ? null
          : { runtime: isolation.runtime, image: image ?? "", user: isolation.user },
      gateOptions: gateOptionsFrom(settings) ?? {},
      bundleDirectory: options.bundleDirectory,
    }),
  );
  return presentParallel(
    await executeControllerLaunch(launch, {
      coordinator,
      clock,
      random,
      sessionRoot,
      home: homedir(),
      storePath: runStorePath(),
      createModel: () => registry.create(spec),
    }),
    launch,
    coordinator,
    clock,
  );
}

export async function resumeParallel(runId: string): Promise<number> {
  const sessionRoot = defaultSessionRoot(homedir());
  const sessionId = await controllerSessionId(sessionRoot, runId);
  if (sessionId === null) throw new Error(`no controller session exists for ${runId}`);
  const clock = createSystemClock();
  const coordinator = await openEvidenceSession({ root: sessionRoot, sessionId, clock });
  const launch = controllerLaunch(coordinator);
  if (launch === null)
    throw new Error(
      "this controller predates pre-planning recovery; preserve its branches and inspect the recorded configuration",
    );
  const settings = await settingsFor(launch.repositoryRoot, {
    model: launch.modelSpec,
    maxSteps: launch.maxSteps,
    attempts: launch.attempts,
    maxWallMinutes: launch.maxWallMs / 60000,
    localEndpoint: launch.localBaseUrl,
  });
  const registry = createProviderRegistry({
    ...registrySettingsFrom(settings, null),
    localBaseUrl: launch.localBaseUrl ?? undefined,
    localThinking: launch.localThinking,
  });
  const spec = parseModelSpec(launch.modelSpec);
  const completed = await executeControllerLaunch(launch, {
    coordinator,
    clock,
    random: createSystemRandom(),
    sessionRoot,
    home: homedir(),
    storePath: runStorePath(),
    createModel: () => registry.create(spec),
  });
  return presentParallel(completed, launch, coordinator, clock);
}

export async function executeControllerLaunch(
  launch: ControllerLaunch,
  runtime: {
    coordinator: EvidenceRecorder;
    clock: Clock;
    random: RandomSource;
    sessionRoot: string;
    home: string;
    storePath: string;
    createModel: () => ModelClient;
  },
): Promise<ParallelRunResult> {
  const { coordinator, clock, random } = runtime;
  const original = controllerLaunch(coordinator);
  if (
    original === null ||
    digestOfJson(asJsonValue(original)) !== digestOfJson(asJsonValue(launch))
  )
    throw new Error("execution must preserve the original controller launch inputs");
  const owner = acquireControllerOwner({ evidence: coordinator, clock, random });
  const cancellation = createRunCancellation({ clock, wallBudgetMs: null });
  const releasePolling = new AbortController();
  const onInterrupt = () => cancellation.cancel("interrupted");
  const onTerminate = () => cancellation.cancel("terminated");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  let administration: ReturnType<typeof controllerAdministration> | undefined;
  let context: RunContext | undefined;
  let polling: Promise<void> | undefined;
  let stopped: unknown;
  let failure: unknown;
  let completedRun: ParallelRunResult | undefined;
  const recovery = {
    coordinator,
    owner,
    createWorkerSession: (workerId: string) =>
      openEvidenceSession({
        root: runtime.sessionRoot,
        sessionId: `${launch.runId}-${workerId}`,
        clock,
      }),
  };
  try {
    await withControllerCleanup(clock, (signal) => repairControllerRuntime(recovery, signal));
    context = await createRunContext({
      evidence: coordinator,
      clock,
      runId: launch.runId,
      maxTokens: launch.maxTokens,
      maxWallMs: launch.maxWallMs,
      modelConcurrency: launch.modelConcurrency,
      testConcurrency: launch.testConcurrency,
      signal: cancellation.signal,
      observe: () => administration?.synchronize(),
    });
    administration = controllerAdministration({
      evidence: coordinator,
      path: runtime.storePath,
      runId: launch.runId,
      objective: launch.goal ?? launch.tasks.join("; "),
      clock,
      maxTokens: launch.maxTokens,
    });
    administration.synchronize();
    if (administration.aborted())
      throw new Error(
        "this run has an administrative abort request; no further work is authorized",
      );
    polling = (async () => {
      while (!releasePolling.signal.aborted) {
        await clock.sleep(200, releasePolling.signal);
        if (releasePolling.signal.aborted) break;
        owner.assertOwned();
        if (administration?.aborted()) {
          cancellation.cancel("policy");
          break;
        }
      }
    })().catch((cause: unknown) => {
      stopped = cause;
      cancellation.cancel("policy");
    });
    const configured = controllerConfiguration(coordinator);
    let graph = configured?.graph ?? launch.graph;
    let goalContract = configured?.goalContract ?? launch.suppliedGoal;
    if (configured === null && launch.goal !== null) {
      const planning = await openEvidenceSession({
        root: runtime.sessionRoot,
        sessionId: `${launch.runId}-plan`,
        clock,
      });
      if (planning.records().filter((record) => record.type === "session-started").length >= 3)
        throw new Error(
          "planning retry cap exhausted; retain the planning evidence and incomplete goal",
        );
      const pinned = coordinator.records().find((record) => record.type === "goal-contract");
      if (pinned !== undefined) {
        const captured = coordinator.payloads().get(pinned.payloadDigest);
        if (captured === null || typeof captured !== "object" || !("contract" in captured))
          throw new Error("pinned goal contract is malformed");
        goalContract = freezeGoalContract(captured.contract).contract;
      }
      const planned = await decompose(launch.goal, {
        runContext: context,
        requireGoalChecks: goalContract === null,
        workspace: launch.repositoryRoot,
        sessionRoot: runtime.sessionRoot,
        runId: launch.runId,
        clock,
        random,
        home: runtime.home,
        model: runtime.createModel,
        maxSteps: launch.maxSteps,
      });
      if (planned.graph === null)
        throw new Error(
          `planning stopped with ${planned.stopReason}: ${describePlannerStop(planned.stopReason)}`,
        );
      graph = planned.graph;
      goalContract ??= planned.goalContract ?? null;
      if (goalContract === null)
        throw new Error(
          "planning did not pin goal acceptance; inspect the retained planning evidence",
        );
    }
    const tasks = configured?.tasks ?? graph?.nodes.map((node) => node.instruction) ?? launch.tasks;
    process.stdout.write(
      `run ${launch.runId}: ${tasks.length} task(s), ${launch.concurrency} worktree slot(s), ${context.accounting().remaining} tokens remaining\n`,
    );
    const isolation = launch.isolation;
    const completed = await runInParallel({
      repositoryRoot: launch.repositoryRoot,
      baseRef: launch.baseCommit,
      scratchRoot: launch.scratchRoot,
      runId: launch.runId,
      coordinator,
      owner,
      resume: configured !== null,
      runContext: context,
      maxTokens: launch.maxTokens,
      tasks,
      ...(graph === null ? {} : { graph, graphSource: launch.goal === null ? "file" : "goal" }),
      ...(goalContract === null ? {} : { goalContract }),
      createWorkerSession: (workerId) =>
        openEvidenceSession({
          root: runtime.sessionRoot,
          sessionId: `${launch.runId}-${workerId}`,
          clock,
        }),
      createModel: (_workerId, evidence) =>
        createRecordingModelClient(runtime.createModel(), evidence, { transcript: "components" }),
      clock,
      random,
      emit: (workerId, event) => {
        const line = describeLoopEvent(event);
        if (line !== null) process.stdout.write(`[${workerId}] ${line}\n`);
      },
      maxSteps: launch.maxSteps,
      attempts: launch.attempts,
      repairAttempts: launch.repairAttempts,
      modelSpec: launch.modelSpec,
      concurrency: launch.concurrency,
      redundancy: launch.redundancy,
      modelConcurrency: launch.modelConcurrency,
      testConcurrency: launch.testConcurrency,
      gateOptions: {
        commandOverrides: Object.fromEntries(
          Object.entries(launch.gateOptions.commandOverrides ?? {}).map(([id, override]) => [
            id,
            typeof override === "string"
              ? override
              : {
                  command: override.command,
                  ...(override.severity === undefined ? {} : { severity: override.severity }),
                  ...(override.parser === undefined ? {} : { parser: override.parser }),
                },
          ]),
        ),
      },
      abortSignal: context.signal,
      ...(isolation === null
        ? {}
        : {
            executionIdentity: `${isolation.runtime}:${isolation.image}:${isolation.user}`,
            isolation: (workspaceRoot: string) =>
              recordedContainerBackend(
                {
                  runtime: isolation.runtime,
                  image: isolation.image,
                  user: isolation.user,
                  workspaceRoot,
                  ...(isolation.memory === undefined ? {} : { memory: isolation.memory }),
                  ...(isolation.processLimit === undefined
                    ? {}
                    : { processLimit: isolation.processLimit }),
                  ...(isolation.network === undefined ? {} : { network: isolation.network }),
                },
                coordinator,
              ),
          }),
    });
    if (stopped !== undefined) throw stopped;
    administration.finish(
      completed.outcome.exitCode === 0,
      completed.outcome.tasks
        .flatMap((task) => (task.blocker === null ? [] : [task.blocker]))
        .join("; "),
    );
    completedRun = completed;
  } catch (cause) {
    failure = cause;
    try {
      await withControllerCleanup(clock, (signal) => repairControllerRuntime(recovery, signal));
      administration?.finish(false, cause instanceof Error ? cause.message : String(cause));
    } catch (cleanup) {
      failure = new AggregateError(
        [cause, cleanup],
        "controller stopped and cleanup or administrative recording also failed; preserve both observations",
      );
    }
  } finally {
    releasePolling.abort();
    await polling;
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    context?.dispose();
    cancellation.dispose();
    administration?.close();
    try {
      owner.release();
    } catch (cause) {
      failure =
        failure === undefined
          ? cause
          : new AggregateError([failure, cause], "controller stopped and ownership release failed");
    }
    try {
      await rmdir(launch.scratchRoot);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "EEXIST")
        process.stderr.write(`retained worktrees for recovery: ${launch.scratchRoot}\n`);
      else if (code !== "ENOENT")
        failure =
          failure === undefined
            ? cause
            : new AggregateError([failure, cause], "controller stopped and scratch cleanup failed");
    }
  }
  if (failure !== undefined) throw failure;
  if (completedRun === undefined) throw new Error("controller stopped without a final assessment");
  return completedRun;
}

async function presentParallel(
  completed: ParallelRunResult,
  launch: ControllerLaunch,
  coordinator: EvidenceRecorder,
  clock: Clock,
): Promise<number> {
  for (const line of renderParallelReport(completed, {
    repositoryRoot: launch.repositoryRoot,
    baseRef: launch.baseCommit,
  }))
    process.stdout.write(`${line}\n`);
  const signing = await resolveSigningKey(createKeychainSecretStore({ platform: platform() }));
  if (signing.notice !== null) process.stderr.write(`[signing] ${signing.notice}\n`);
  const directory =
    launch.bundleDirectory ??
    join(coordinator.directory, `bundle-${coordinator.head().recordCount}`);
  await exportCombinedBundle({
    coordinator: bundleSourceFromRecorder(coordinator),
    workers: completed.workers.map((worker) => ({
      workerId: worker.workerId,
      source: bundleSourceFromRecorder(worker.evidence),
    })),
    destination: directory,
    signingKey: signing.key,
    clock,
  });
  process.stdout.write(`evidence bundle: ${directory}\n`);
  return completed.outcome.exitCode;
}

export async function repairParallel(runId: string): Promise<number> {
  const root = defaultSessionRoot(homedir());
  const sessionId = await controllerSessionId(root, runId);
  if (sessionId === null) throw new Error(`no controller session exists for ${runId}`);
  const clock = createSystemClock();
  const evidence = await openEvidenceSession({ root, sessionId, clock });
  const launch = controllerLaunch(evidence);
  if (launch === null)
    throw new Error("controller launch inputs are unavailable; preserve and inspect the history");
  const owner = acquireControllerOwner({ evidence, clock, random: createSystemRandom() });
  try {
    const recovery = {
      coordinator: evidence,
      owner,
      createWorkerSession: (workerId: string) =>
        openEvidenceSession({ root, sessionId: `${runId}-${workerId}`, clock }),
    };
    await withControllerCleanup(clock, async (signal) => {
      await repairControllerRuntime(recovery, signal);
      if (controllerConfiguration(evidence) !== null) await reconcileController(recovery, signal);
    });
    process.stdout.write(
      `${runId}: owned resources reconciled; no model call or accepted landing was repeated. Resume uses the original budget.\n`,
    );
    return 0;
  } finally {
    owner.release();
  }
}
