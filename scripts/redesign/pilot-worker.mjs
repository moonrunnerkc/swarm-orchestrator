import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createSystemClock } from "../../src/cli-runtime-inputs.ts";
import { unobservedGoalMetrics } from "../../src/eval/goal-observation.ts";
import { bundleSourceFromRecorder } from "../../src/evidence/bundle.ts";
import { asJsonValue, digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { exportCombinedBundle } from "../../src/evidence/combined-bundle.ts";
import { declareGoalContract, goalImmutablePaths } from "../../src/evidence/goal-contract.ts";
import { createRecordingModelClient } from "../../src/evidence/model-call-recording.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { createEphemeralSigningKey } from "../../src/evidence/signing.ts";
import { parseTaskContract } from "../../src/evidence/task-contract.ts";
import { verifyBundle } from "../../src/evidence/verifier/verify.mjs";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { runProcessGroup } from "../../src/exec/run-process.ts";
import { installFromLockfile } from "../../src/gates/dependency-install.ts";
import { verifyIndependently } from "../../src/gates/independent-verification.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";
import { createProviderRegistry } from "../../src/providers/registry.ts";
import { controllerEvents } from "../../src/workers/controller-events.ts";
import { verifyControllerCommit } from "../../src/workers/controller-verification.ts";
import { runInParallel } from "../../src/workers/parallel-run.ts";
import { runPlanner } from "../../src/workers/planner-run.ts";
import { createRunContext } from "../../src/workers/run-context.ts";
import { contractsFromGraph, MalformedTaskContractError } from "../../src/workers/task-contract.ts";
import { checkoutBase, projectGateOptions, runtimeFor } from "./pilot-runtime.mjs";

const execute = promisify(execFile);
const git = async (cwd, ...argv) =>
  (
    await execute("git", argv, {
      cwd,
      env: harnessChildEnvironment().variables,
      timeout: 30000,
      maxBuffer: 64000000,
    })
  ).stdout.trim();

/** Each scheduled launch owns its context before checkout, planning or implementation. */
export async function executePilotGoal({
  candidate,
  arm,
  execution,
  root,
  settings,
  frozenSource,
  createModel,
}) {
  const clock = createSystemClock();
  const started = clock.now();
  const runId = execution.executionId.replace(/^sha256:/, "");
  // Execution ids remain content-addressed in evidence, but a filesystem component must not
  // contain the colon that Docker interprets as a volume separator.
  const directory = join(root, runId);
  await mkdir(directory, { mode: 0o700 });
  const coordinator = await openEvidenceSession({
    root: join(directory, "sessions"),
    sessionId: "controller",
    clock,
  });
  const context = await createRunContext({
    evidence: coordinator,
    clock,
    runId,
    maxTokens: execution.budget.tokens,
    maxWallMs: execution.budget.wallMs,
    modelConcurrency: settings.modelConcurrency,
    testConcurrency: settings.testConcurrency,
    signal: AbortSignal.any([execution.signal, AbortSignal.timeout(execution.budget.wallMs)]),
  });
  const sessions = new Map();
  const workspace = join(directory, "repo");
  const scratchRoot = join(directory, "worktrees");
  const runtimeEvents = [];
  const runtimeEvidence = {
    ...coordinator,
    record: async (entry) => {
      const captured = await coordinator.record(entry);
      if (entry.type === "campaign-observation" && entry.payload.kind === "runtime-resource")
        runtimeEvents.push(entry.payload);
      return captured;
    },
  };
  const registry = createProviderRegistry({
    localBaseUrl: settings.endpoint,
    localThinking: false,
  });
  const client = (evidence) =>
    createRecordingModelClient(
      createModel
        ? createModel(evidence)
        : registry.create({ provider: "local", modelId: settings.model }),
      evidence,
      { transcript: "components" },
    );
  const session = async (id) => {
    const evidence = await openEvidenceSession({
      root: join(directory, "sessions"),
      sessionId: id,
      clock,
    });
    sessions.set(id, evidence);
    return evidence;
  };
  const runtime = (checkout) =>
    runtimeFor({
      candidate,
      workspace: checkout,
      evidence: runtimeEvidence,
      clock,
      signal: context.signal,
      commandPool: context.tests,
    });
  // Some pinned runtime images intentionally contain only the project toolchain. Git remains a
  // host-owned operation for the fresh verifier checkout, while checks still run in the image.
  const verifierIsolation = (checkout) => {
    const isolated = runtime(checkout).isolation;
    if (isolated === undefined) return undefined;
    return {
      ...isolated,
      run: async (argv, commandOptions) =>
        argv[0] === "git"
          ? runProcessGroup(argv[0], argv.slice(1), {
              cwd: commandOptions.cwd,
              env: harnessChildEnvironment().variables,
              signal: commandOptions.signal,
              timeoutMs: commandOptions.timeoutMs,
              maxOutputBytes: 16_000_000,
            })
          : isolated.run(argv, commandOptions),
    };
  };
  let measured = null;
  let failure = null;
  let plannerFallback = null;
  let sealed = null;
  let heldBack = null;
  let integrity = null;
  let branch = null;
  let head = candidate.baseCommit;
  try {
    await checkoutBase({
      clone: candidate.clone,
      baseCommit: candidate.baseCommit,
      workspace,
      evidence: coordinator,
      signal: context.signal,
    });
    await mkdir(scratchRoot, { mode: 0o700 });
    await declareGoalContract(coordinator, candidate.contracts.sealed);
    const immutablePaths = [
      ...new Set([
        ...goalImmutablePaths(candidate.contracts.sealed),
        ...goalImmutablePaths(candidate.contracts["held-back"]),
      ]),
    ];
    const task = `${candidate.goal}\nPreserve existing supported APIs except the requested change. Maintain tests and documentation. The controller pins the original dependency lockfile, tool configuration and independent acceptance artifacts. Required repository checks: ${JSON.stringify(projectGateOptions(candidate).commandOverrides ?? {})}. Acceptance feedback may be supplied after integration; you cannot edit the acceptance artifacts.`;
    const frozen = arm.role === "frozen-parallel";
    const planner = frozen
      ? (await import(pathToFileURL(join(frozenSource, "src/workers/planner-run.ts")).href))
          .runPlanner
      : runPlanner;
    let graph = null;
    if (arm.role !== "single") {
      const evidence = await session("planner");
      const planned = await planner({
        goal: task,
        workspace,
        homeDir: directory,
        model: context.model("planning", client(evidence)),
        evidence,
        clock,
        random: { next: () => 0.5 },
        emit: () => {},
        maxSteps: settings.plannerSteps,
        maxTokens: context.accounting().remaining,
        maxWallTimeMs: context.remainingWallMs(),
        abortSignal: context.signal,
      });
      graph = planned.graph;
      if (graph === null) {
        plannerFallback = planned.stopReason;
        await coordinator.record({
          type: "campaign-observation",
          actor: "harness",
          provenance: ["model", "tool-output"],
          payload: { phase: "planner-fallback", stopReason: planned.stopReason },
        });
      }
    }
    const contractDefaults = {
      maxSteps: settings.maxSteps,
      maxTokens: execution.budget.tokens,
      maxWallMs: execution.budget.wallMs,
      immutablePaths,
      requiredChecks: ["tests"],
      network: candidate.language === "python" ? "denied" : "unrestricted",
      execution: candidate.language === "python" ? "isolated" : "restricted",
      allowedTools: ["read", "write", "edit", "list", "search", "shell", "trail", "coordination"],
    };
    let contracts;
    if (graph !== null) {
      try {
        contracts = contractsFromGraph(graph, contractDefaults);
      } catch (cause) {
        if (!(cause instanceof MalformedTaskContractError)) throw cause;
        await coordinator.record({
          type: "campaign-observation",
          actor: "harness",
          provenance: ["model", "tool-output"],
          payload: {
            phase: "planner-contract-fallback",
            detail: cause.message,
            graphRevision: 0,
          },
        });
        graph = null;
        plannerFallback = plannerFallback ?? "planner contract rejected";
      }
    }
    contracts ??= [
      parseTaskContract({
        version: 3,
        taskId: "task-1",
        objective: task,
        dependsOn: [],
        allowedPaths: ["**"],
        scopeKind: "workspace",
        scopeAuthority: "human",
        immutablePaths,
        allowedTools: contractDefaults.allowedTools,
        network: contractDefaults.network,
        execution: contractDefaults.execution,
        requiredChecks: ["tests"],
        riskTier: "medium",
        budget: {
          maxSteps: settings.maxSteps,
          maxTokens: execution.budget.tokens,
          maxWallMs: execution.budget.wallMs,
        },
      }),
    ];
    const options = {
      repositoryRoot: workspace,
      baseRef: candidate.baseCommit,
      runId,
      scratchRoot,
      coordinator,
      tasks: graph?.nodes.map((node) => node.instruction) ?? [task],
      ...(graph ? { graph, graphSource: "goal" } : {}),
      controllerScope: { kind: "workspace", allowedPaths: [], immutablePaths },
      contracts,
      immutablePaths,
      requiredChecks: ["tests"],
      goalContract: candidate.contracts.sealed,
      runContext: context,
      createWorkerSession: session,
      createModel: (_id, evidence) => client(evidence),
      clock,
      random: { next: () => 0.5 },
      emit: () => {},
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
      repairAttempts: settings.repairAttempts,
      redundancy: 1,
      concurrency: arm.role === "single" ? 1 : settings.worktreeConcurrency,
      modelConcurrency: settings.modelConcurrency,
      testConcurrency: settings.testConcurrency,
      graphRevisionLimit: settings.graphRevisions,
      maxTokens: execution.budget.tokens,
      remainingWallMs: () => context.remainingWallMs(),
      modelSpec: `local:${settings.model}`,
      abortSignal: context.signal,
      adaptation: arm.role !== "no-adaptation",
      peerInformation: !["single", "no-peer"].includes(arm.role),
      gateOptions: projectGateOptions(candidate),
      installDependencies: candidate.language !== "python",
      ...(candidate.image === null ? {} : { isolation: (checkout) => runtime(checkout).isolation }),
      verificationIsolation: verifierIsolation,
      executionIdentity: candidate.image ?? `host:${process.version}`,
    };
    if (frozen) {
      const runFrozen = (
        await import(pathToFileURL(join(frozenSource, "src/workers/parallel-run.ts")).href)
      ).runInParallel;
      const prepared = new Map();
      const baseBackend = (checkout) =>
        runtime(checkout).isolation ?? {
          name: "host",
          nodeProgram: process.execPath,
          run: async (argv, options) =>
            runProcessGroup(argv[0], argv.slice(1), {
              cwd: options.cwd,
              env: harnessChildEnvironment().variables,
              signal: options.signal,
              timeoutMs: options.timeoutMs,
              maxOutputBytes: 16000000,
            }),
        };
      const backend = (checkout) => {
        const underlying = baseBackend(checkout);
        return {
          ...underlying,
          run: async (argv, commandOptions) => {
            if (candidate.language !== "python" && !prepared.has(checkout)) {
              prepared.set(
                checkout,
                installFromLockfile({
                  workspace: checkout,
                  commands: createNodeCommandRunner(
                    clock,
                    harnessChildEnvironment(),
                    underlying,
                    context.signal,
                    context.tests,
                  ),
                  timeoutMs: Math.min(180000, context.remainingWallMs()),
                  signal: context.signal,
                  evidence: coordinator,
                }),
              );
            }
            const setup = await prepared.get(checkout);
            if (setup && !setup.succeeded) throw new Error(setup.detail);
            return context.tests.run(
              () => underlying.run(argv, { ...commandOptions, signal: context.signal }),
              context.signal,
            );
          },
        };
      };
      measured = await runFrozen({
        ...options,
        isolation: backend,
        createModel: (id, evidence) => context.model(id, client(evidence)),
      });
      branch = measured.integrationBranch;
      head = measured.headCommit;
      sealed = (
        await verifyControllerCommit(
          { ...options, coordinator: runtimeEvidence },
          candidate.baseCommit,
          head,
        )
      ).verification;
    } else {
      measured = await runInParallel(options);
      branch = measured.integrationBranch;
      head = measured.headCommit;
      sealed = measured.verification;
    }
    if (!context.signal.aborted) {
      const patch = await git(workspace, "diff", "--binary", candidate.baseCommit, head);
      const tree = await git(workspace, "rev-parse", `${head}^{tree}`);
      const heldBackEvidence = await session("held-back-verifier");
      await declareGoalContract(heldBackEvidence, candidate.contracts["held-back"]);
      heldBack = await verifyIndependently({
        repositoryRoot: workspace,
        checkoutRoot: scratchRoot,
        baseCommit: candidate.baseCommit,
        patch,
        immutablePaths,
        clock,
        signal: context.signal,
        timeoutMs: Math.min(180000, context.remainingWallMs()),
        commands: createNodeCommandRunner(
          clock,
          harnessChildEnvironment(),
          undefined,
          context.signal,
          context.tests,
        ),
        commandsForCheckout: async (checkout) =>
          createNodeCommandRunner(
            clock,
            harnessChildEnvironment(),
            verifierIsolation(checkout),
            context.signal,
            context.tests,
          ),
        goal: { contract: candidate.contracts["held-back"], evidence: heldBackEvidence, tree },
        installDependencies: candidate.language !== "python",
        repositoryChecks: "skip",
        gateOptions: projectGateOptions(candidate),
      });
    }
  } catch (cause) {
    failure = cause instanceof Error ? cause.message : String(cause);
  } finally {
    context.dispose();
  }
  await coordinator.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      phase: "pilot-final-observation",
      arm: arm.id,
      caseId: candidate.id,
      branch,
      head,
      failure,
      sealed,
      heldBack,
      accounting: context.accounting(),
    }),
  });
  const events = controllerEvents(coordinator);
  const accounting = context.accounting();
  let inputTokens = 0,
    outputTokens = 0;
  for (const event of events)
    if (event.kind === "usage-settled" && event.status === "reported") {
      inputTokens += event.inputTokens;
      outputTokens += event.outputTokens;
    }
  for (const [sessionId, evidence] of sessions)
    await coordinator.record({
      type: "campaign-observation",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { phase: "chain-linked", sessionId, chainHead: evidence.head().hash },
    });
  const bundle = join(directory, "bundle");
  try {
    await exportCombinedBundle({
      coordinator: bundleSourceFromRecorder(coordinator),
      workers: [...sessions].map(([workerId, evidence]) => ({
        workerId,
        source: bundleSourceFromRecorder(evidence),
      })),
      destination: bundle,
      signingKey: createEphemeralSigningKey(),
      clock,
    });
    const lines = [];
    integrity = verifyBundle(bundle, (line) => lines.push(line));
    if (integrity !== 0)
      console.log(
        JSON.stringify({ phase: "bundle-refused", executionId: execution.executionId, lines }),
      );
    await writeFile(join(directory, "verify.log"), lines.join("\n"), { flag: "wx", mode: 0o600 });
  } catch (cause) {
    failure = [failure, cause instanceof Error ? cause.message : String(cause)]
      .filter(Boolean)
      .join("; ");
  }
  const live = new Set();
  for (const event of runtimeEvents) {
    if (["create-intent", "created"].includes(event.phase)) live.add(event.identity);
    if (event.phase === "removed") live.delete(event.identity);
  }
  const cleanup = live.size === 0 ? "confirmed" : "failed";
  const cancelled = context.signal.aborted;
  const termination = execution.signal.aborted
    ? "cancelled"
    : accounting.unknownCalls > 0 || failure
      ? "crashed"
      : cancelled
        ? "budget"
        : "completed";
  const certified =
    sealed?.verified === true &&
    integrity === 0 &&
    (arm.role === "frozen-parallel" || measured?.outcome.goalAccepted === true);
  const goal = {
    ...unobservedGoalMetrics(
      candidate.contracts.sealed.requirements.length,
      termination,
      failure ??
        context.signal.reason?.message ??
        (plannerFallback === null
          ? "All observations retained; generated or historical checks are limited acceptance instruments."
          : `Planner stopped with ${plannerFallback}; one bounded worker handled the goal.`),
    ),
    inputTokens: accounting.unknownCalls === 0 ? inputTokens : null,
    outputTokens: accounting.unknownCalls === 0 ? outputTokens : null,
    reservedTokens: accounting.reserved,
    unknownCalls: accounting.unknownCalls,
    retries: events.filter(
      (event) => event.kind === "repair-requested" || event.kind === "goal-repair-requested",
    ).length,
    integrationFailures: measured?.queue?.landings.filter((item) => !item.landed).length ?? 0,
    integrationRepairs:
      measured?.queue?.landings.filter(
        (item) =>
          item.landed &&
          events.some(
            (event) => event.kind === "repair-requested" && event.workerId === item.workerId,
          ),
      ).length ?? 0,
    humanInterventions: 0,
    humanRepairMinutes: 0,
    accepted: certified ? candidate.contracts.sealed.requirements.length : 0,
    missedChecks:
      sealed === null
        ? ["final integrated verification unavailable"]
        : sealed.checks
            .filter((check) => check.id === "tests" && check.status === "not-applicable")
            .map((check) => check.id),
    partialBranch: branch,
  };
  const outcome = {
    status:
      termination === "cancelled" || termination === "budget"
        ? "cancelled"
        : failure || heldBack === null || heldBack.task === "unjudged"
          ? "crashed"
          : "completed",
    certified,
    heldBackAccepted:
      heldBack === null || heldBack.task === "unjudged" ? null : heldBack.task === "accepted",
    costUsd: null,
    latencyMs: clock.now() - started,
    evidenceDigest:
      integrity === null ? null : digestOfBytes(await readFile(join(bundle, "manifest.json"))),
    cleanup,
    goal,
  };
  const observation = {
    outcome,
    head,
    branch,
    bundle,
    integrity,
    failure,
    knownReportedTokens: { inputTokens, outputTokens },
    accounting,
    sealed,
    heldBack,
  };
  await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({ phase: "settled", executionId: execution.executionId, ...outcome, head }),
  );
  return outcome;
}
