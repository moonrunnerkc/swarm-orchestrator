import { mkdtemp, readFile, rm } from "node:fs/promises";
import { availableParallelism, homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLocalBackend } from "./cli-local-backend.ts";
import type { ParallelCommand } from "./cli-options.ts";
import { gateOptionsFrom, registrySettingsFrom, settingsFor } from "./cli-run-settings.ts";
import { createSystemClock, createSystemRandom } from "./cli-runtime-inputs.ts";
import type { Clock } from "./core/clock.ts";
import type { ModelClient } from "./core/model-client.ts";
import type { RandomSource } from "./core/random-source.ts";
import { bundleSourceFromRecorder } from "./evidence/bundle.ts";
import { exportCombinedBundle } from "./evidence/combined-bundle.ts";
import { freezeGoalContract } from "./evidence/goal-contract.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { createSessionId, defaultSessionRoot, openEvidenceSession } from "./evidence/session.ts";
import { createKeychainSecretStore, resolveSigningKey } from "./evidence/signing.ts";
import { parseIsolationOption } from "./exec/isolation-option.ts";
import { createRunCancellation } from "./exec/run-cancellation.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import { localEndpointRecord } from "./providers/endpoint-resolution.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { describeLoopEvent } from "./tui/plain-lines.ts";
import { renderParallelReport } from "./workers/parallel-report.ts";
import { runInParallel } from "./workers/parallel-run.ts";
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

/**
 * N workers over worktrees, then the queue. The composition root does what it always does:
 * every ambient thing enters here, and the coordinator itself stays testable without one.
 */
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
  const home = homedir();
  const sessionRoot = defaultSessionRoot(home);
  const runId = createSessionId(clock, random);

  const fromFile = options.tasksFile === null ? null : await readTasksFile(options.tasksFile);
  const spec = parseModelSpec(settings.modelSpec);
  const localBackend = await resolveLocalBackend(settings, [spec]);
  const registry = createProviderRegistry(registrySettingsFrom(settings, localBackend));

  const coordinator = await openEvidenceSession({
    root: sessionRoot,
    sessionId: `${runId}-queue`,
    clock,
  });
  if (localBackend !== null) {
    await coordinator.record(localEndpointRecord(localBackend));
  }
  // Worktrees live outside the repository and outside the session store, so a worker's tools
  // can reach neither the tree the user is in nor anybody's evidence.
  const scratchRoot = await mkdtemp(join(tmpdir(), "swarm-parallel-"));

  // One place this run is stopped from: the wall budget, a Ctrl-C, and a supervisor's SIGTERM
  // all reach the same signal, and every worker is handed that signal rather than a fresh
  // controller nobody aborts. Before this, `--max-wall-minutes` reached `runInParallel` through
  // a spread into an options object with no such field, so it did nothing at all.
  const parallelIsolation = parseIsolationOption(options.isolation, options.workspace);
  const cancellation = createRunCancellation({
    clock,
    wallBudgetMs: settings.maxWallMinutes === null ? null : settings.maxWallMinutes * 60_000,
  });
  const onInterrupt = () => {
    cancellation.cancel("interrupted");
  };
  const onTerminate = () => {
    cancellation.cancel("terminated");
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);

  const runContext = await createRunContext({
    evidence: coordinator,
    clock,
    runId,
    maxTokens: options.maxTokens ?? 200_000,
    maxWallMs: cancellation.remainingMs() ?? 30 * 60_000,
    modelConcurrency: options.modelConcurrency ?? 1,
    testConcurrency: options.testConcurrency ?? 1,
    signal: cancellation.signal,
  });
  try {
    const suppliedGoal =
      options.goalChecksFile === undefined
        ? undefined
        : freezeGoalContract(JSON.parse(await readFile(options.goalChecksFile, "utf8"))).contract;
    const planned =
      options.goal === null
        ? null
        : await decompose(options.goal, {
            workspace: options.workspace,
            sessionRoot,
            runId,
            clock,
            random,
            home,
            model: () => registry.create(spec),
            maxSteps: settings.maxSteps,
            runContext,
            requireGoalChecks: suppliedGoal === undefined,
          });
    const graph = planned === null ? (fromFile?.graph ?? null) : planned.graph;
    if (planned !== null && planned.graph === null) {
      // How it stopped, not just that nothing arrived: a loop that ran out of steps wants a
      // different answer from one whose model returned nothing at all, and a person told only
      // "no graph" cannot tell those apart.
      throw new Error(
        `the planner declared no task graph. It stopped with "${planned.stopReason}" after ` +
          `${planned.steps} step(s), and its session records what it read and what it said. ` +
          `${describePlannerStop(planned.stopReason)} Or write the graph yourself and pass it ` +
          "with --tasks: a file beginning with { is read as one.",
      );
    }
    const goalContract = suppliedGoal ?? planned?.goalContract;
    if (options.goal !== null && goalContract == null)
      throw new Error(
        "planning did not pin goal acceptance; inspect the planning evidence or supply --goal-checks <file>",
      );
    const tasks =
      graph === null ? (fromFile?.tasks ?? []) : graph.nodes.map((node) => node.instruction);

    const redundancy = options.redundancy ?? 1;
    // Capped whether or not a task is tried several ways. Twenty tasks against one local model
    // server is the same failure as one task tried twenty ways, and the fan-out was unbounded
    // here long before redundancy existed.
    const concurrency =
      options.concurrency ??
      defaultWorkerConcurrency({
        servedLocally: spec.provider === "local",
        cores: availableParallelism(),
      });

    const workerCount = tasks.length * redundancy;
    process.stdout.write(
      redundancy > 1
        ? `starting ${tasks.length} task(s) ${redundancy} ways from ${options.baseRef}, ` +
            `${concurrency} of ${workerCount} worker(s) at a time\n`
        : `starting ${workerCount} worker(s) from ${options.baseRef}, ` +
            `${concurrency} at a time\n`,
    );
    const gateOptions = gateOptionsFrom(settings);

    const result = await runInParallel({
      repositoryRoot: options.workspace,
      runContext,
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      ...(options.repairAttempts === undefined ? {} : { repairAttempts: options.repairAttempts }),
      ...(goalContract == null ? {} : { goalContract }),
      baseRef: options.baseRef,
      tasks,
      runId,
      scratchRoot,
      coordinator,
      createWorkerSession: (workerId) =>
        openEvidenceSession({ root: sessionRoot, sessionId: `${runId}-${workerId}`, clock }),
      createModel: (_workerId, evidence) =>
        createRecordingModelClient(registry.create(spec), evidence, { transcript: "components" }),
      redundancy,
      concurrency,
      modelSpec: settings.modelSpec,
      ...(graph === null
        ? {}
        : { graph, graphSource: options.goal === null ? ("file" as const) : ("goal" as const) }),
      clock,
      random,
      emit: (workerId, event) => {
        const line = describeLoopEvent(event);
        if (line !== null) {
          process.stdout.write(`[${workerId}] ${line}\n`);
        }
      },
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
      remainingWallMs: () => cancellation.remainingMs(),
      ...(parallelIsolation === null
        ? {}
        : {
            isolation: (worktreePath: string) =>
              recordedContainerBackend(
                { ...parallelIsolation, workspaceRoot: worktreePath },
                coordinator,
              ),
          }),
      ...(gateOptions === undefined ? {} : { gateOptions }),
      abortSignal: cancellation.signal,
    });

    for (const line of renderParallelReport(result, {
      repositoryRoot: options.workspace,
      baseRef: options.baseRef,
    })) {
      process.stdout.write(`${line}\n`);
    }

    const signing = await resolveSigningKey(createKeychainSecretStore({ platform: platform() }));
    if (signing.notice !== null) {
      process.stderr.write(`[signing] ${signing.notice}\n`);
    }
    const directory = options.bundleDirectory ?? join(coordinator.directory, "bundle");
    await exportCombinedBundle({
      coordinator: bundleSourceFromRecorder(coordinator),
      workers: result.workers.map((worker) => ({
        workerId: worker.workerId,
        source: bundleSourceFromRecorder(worker.evidence),
      })),
      destination: directory,
      signingKey: signing.key,
      clock,
    });
    process.stdout.write(`evidence bundle: ${directory}\n`);

    return result.outcome.exitCode;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    runContext.dispose();
    cancellation.dispose();
    await rm(scratchRoot, { recursive: true, force: true });
  }
}
