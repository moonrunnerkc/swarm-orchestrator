#!/usr/bin/env node
// First, so its check runs before any other module's top-level code.
import "./node-floor.ts";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { arch, availableParallelism, homedir, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { render as inkRender } from "ink";
import { runAgentTask } from "./agent-run.ts";
import {
  type AddCaseCommand,
  type CalibrateCommand,
  type CommandLine,
  type DoctorCommand,
  type GatesCommand,
  type GcCommand,
  type InitCommand,
  type ParallelCommand,
  parseCommandLine,
  type ReplayCommand,
  type ReviewCommand,
  type RunCommand,
  type SelectCommand,
  type SessionCommand,
  usage,
  type VerifyCommand,
} from "./cli-options.ts";
import { initializeSwarmToml, initWouldHelp, type PlannedGate } from "./config/init.ts";
import {
  type CommandLineSettings,
  type ResolvedSettings,
  resolveSettings,
} from "./config/settings.ts";
import { readSwarmToml } from "./config/swarm-toml.ts";
import type { Clock } from "./core/clock.ts";
import type { ConversationMessage, ModelClient } from "./core/model-client.ts";
import type { RandomSource } from "./core/random-source.ts";
import type { StopReason } from "./core/termination.ts";
import { bundleSourceFromRecorder, exportBundle, readBundle } from "./evidence/bundle.ts";
import type { BundleManifest } from "./evidence/bundle-manifest.ts";
import { exportCombinedBundle } from "./evidence/combined-bundle.ts";
import { buildEvidenceDag, type EvidenceDag } from "./evidence/dag.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { replayBundle } from "./evidence/replay.ts";
import { collectSessions, describeCollection, olderThanMs } from "./evidence/retention.ts";
import {
  createSessionId,
  defaultSessionRoot,
  type EvidenceRecorder,
  openEvidenceSession,
} from "./evidence/session.ts";
import { createKeychainSecretStore, resolveSigningKey } from "./evidence/signing.ts";
import { describeVerdict, runVerdict } from "./evidence/verdict.ts";
import { verifyBundleAt } from "./evidence/verify-report.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import { createContainerBackend } from "./exec/container-backend.ts";
import { parseIsolationOption } from "./exec/isolation-option.ts";
import { createRunCancellation } from "./exec/run-cancellation.ts";
import type { AutoResolveOutcome } from "./gates/auto-resolve.ts";
import type { BondOutcome } from "./gates/bond-runner.ts";
import type { GateSetOptions } from "./gates/default-gates.ts";
import {
  defaultDiffBudget,
  runGatesEngine,
  sealAssembledCriteria,
  vacuousBlockingBonds,
} from "./gates/engine.ts";
import { describeEscalation } from "./gates/escalation.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import type { DiffBudget } from "./gates/gate-definition.ts";
import { citedRecords, type GateCycle, outstandingJustifications } from "./gates/gate-runner.ts";
import { resolveBaseCommit } from "./gates/git-workspace.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
import { summarizeRatchet } from "./gates/ratchet-summary.ts";
import { recordTurnBaseline } from "./gates/turn-baseline.ts";
import { diagnose, remediesFor } from "./install/health.ts";
import { inspectInstall } from "./install/inspect.ts";
import { describeInstall } from "./install/report.ts";
import { exitCodes, jsonEventLine, jsonResultLine } from "./machine-output.ts";
import {
  localEndpointRecord,
  type ResolvedLocalEndpoint,
  resolveLocalEndpoint,
} from "./providers/endpoint-resolution.ts";
import { discoverLocalEndpoints } from "./providers/local-discovery.ts";
import { type ModelSpec, parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { fetchServedModels } from "./providers/served-models.ts";
import type { TransportTraceSink } from "./providers/transport-trace.ts";
import { createFileTraceSink } from "./providers/transport-trace-file.ts";
import {
  type BackendCanary,
  canaryRecord,
  describeCanary,
  runBackendCanary,
} from "./select/backend-canary.ts";
import { runCalibration } from "./select/calibrate.ts";
import { parseCalibrationCase } from "./select/calibration-case.ts";
import { payloadsSince } from "./select/calibration-measures.ts";
import { renderCalibrationReport } from "./select/calibration-report.ts";
import {
  defaultCompetencyTablePath,
  lookupCompetency,
  readCompetencyTable,
  sweepFromRuns,
  withSweep,
  writeCompetencyTable,
} from "./select/competency-table.ts";
import { appendCalibrationCase, defaultGoldenSetPath, readGoldenSet } from "./select/golden-set.ts";
import { probeHardware } from "./select/hardware-probe.ts";
import { createOllamaMemoryProbe } from "./select/memory-probe.ts";
import { chooseUsableModel } from "./select/model-fallback.ts";
import {
  describePreflight,
  type LocalModelPreflight,
  preflightLocalModels,
  preflightRecord,
} from "./select/model-preflight.ts";
import { defaultPickPath, readCalibrationPick, writeCalibrationPick } from "./select/pick-store.ts";
import { loadPricing } from "./select/pricing-source.ts";
import { calibrationCandidates, recommendModel } from "./select/recommendation.ts";
import { buildRewardEntry } from "./select/reward.ts";
import { defaultRoutingLogPath, openRoutingLog } from "./select/routing-log.ts";
import { routingDecisionRecord } from "./select/routing-record.ts";
import { renderRoutingReport } from "./select/routing-report.ts";
import { renderSelectReport } from "./select/select-report.ts";
import { servableCandidates } from "./select/servable-candidates.ts";
import { loadShortlist } from "./select/shortlist-source.ts";
import { systemProbeEnvironment } from "./select/system-probe.ts";
import { classifyTask } from "./select/task-class.ts";
import { costOfTask, type TaskCost } from "./select/task-cost.ts";
import { type RoutingDecision, routeModel } from "./select/ucb.ts";
import { createPolicyGuard, defaultShellAllowlist } from "./tools/policy-guard.ts";
import { createWorkspaceTools } from "./tools/workspace-tools.ts";
import { startCalibrateInterface } from "./tui/calibrate-interface.ts";
import { describeEvidence, type EvidenceSummary } from "./tui/evidence-panel.ts";
import { resolveKeyBindings } from "./tui/key-bindings.ts";
import { evidenceLocation, type OpenCommand, openEnvironment } from "./tui/open-path.ts";
import { describeLoopEvent } from "./tui/plain-lines.ts";
import { type SessionInterface, startSessionInterface } from "./tui/session-interface.ts";
import { resolveTheme } from "./tui/theme.ts";
import { runEmbeddedVerifier } from "./tui/verify-bundle.ts";
import { renderParallelReport } from "./workers/parallel-report.ts";
import { type ParallelRunResult, runInParallel } from "./workers/parallel-run.ts";
import { type PlannerOutcome, runPlanner } from "./workers/planner-run.ts";
import { defaultWorkerConcurrency } from "./workers/pool.ts";
import { readTaskGraph, type TaskGraph } from "./workers/task-graph.ts";

/** The ambient clock lives at the composition root; src/core only ever sees the port. */
function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (milliseconds, cancel) =>
      new Promise((resolveSleep) => {
        if (cancel?.aborted) {
          resolveSleep();
          return;
        }
        const timer = setTimeout(() => {
          cancel?.removeEventListener("abort", onCancel);
          resolveSleep();
        }, milliseconds);
        function onCancel(): void {
          clearTimeout(timer);
          resolveSleep();
        }
        cancel?.addEventListener("abort", onCancel, { once: true });
      }),
  };
}

function createSystemRandom(): RandomSource {
  return { next: () => Math.random() };
}

const noFlagSettings: CommandLineSettings = {
  model: null,
  maxSteps: null,
  attempts: null,
  maxWallMinutes: null,
  localEndpoint: null,
};

/**
 * Config is read once, here at the composition root, and injected downward: nothing below
 * cli.ts sees the file or the environment. Precedence lives in src/config/settings.ts.
 */
async function settingsFor(
  directory: string,
  flags: CommandLineSettings,
): Promise<ResolvedSettings> {
  const found = await readSwarmToml({ directory, readFile: (path) => readFile(path, "utf8") });
  return resolveSettings({ flags, env: process.env, toml: found?.toml ?? null });
}

function gateOptionsFrom(settings: ResolvedSettings): GateSetOptions | undefined {
  return Object.keys(settings.gateCommandOverrides).length === 0
    ? undefined
    : { commandOverrides: settings.gateCommandOverrides };
}

function diffBudgetFrom(settings: ResolvedSettings): DiffBudget | undefined {
  return Object.keys(settings.diffBudget).length === 0
    ? undefined
    : { ...defaultDiffBudget, ...settings.diffBudget };
}

function registrySettingsFrom(
  settings: ResolvedSettings,
  localBackend: ResolvedLocalEndpoint | null,
): {
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;
  googleApiKey: string | undefined;
  localBaseUrl: string | undefined;
  localThinking: boolean | null;
  transportTrace: TransportTraceSink | undefined;
} {
  return {
    anthropicApiKey: settings.providerKeys.anthropic,
    openaiApiKey: settings.providerKeys.openai,
    googleApiKey: settings.providerKeys.google,
    localBaseUrl: localBackend?.url,
    localThinking: settings.localThinking,
    // Built here rather than in the registry, so the one module that talks to a network still
    // does no file IO of its own. Nothing is opened until a call is actually traced.
    transportTrace:
      settings.transportTracePath === null
        ? undefined
        : createFileTraceSink(settings.transportTracePath),
  };
}

/** Probing two localhost ports; a runtime that takes longer than this is not running. */
const discoveryTimeoutMs = 1_500;

/**
 * Null unless the spec asks for a local model: only then does an endpoint matter, and
 * resolving one for a frontier run would probe ports the run will never talk to.
 */
async function resolveLocalBackend(
  settings: ResolvedSettings,
  specs: readonly ModelSpec[],
): Promise<ResolvedLocalEndpoint | null> {
  if (!specs.some((spec) => spec.provider === "local")) {
    return null;
  }
  return resolveLocalEndpoint({
    pinned: settings.localEndpoint,
    discover: () =>
      discoverLocalEndpoints({
        fetch: (url) => fetch(url, { signal: AbortSignal.timeout(discoveryTimeoutMs) }),
      }),
    appleSilicon: platform() === "darwin" && arch() === "arm64",
  });
}

/**
 * The bundle's own consistency and the identity that signed it, reported apart. A bundle
 * carries the public key its signature verifies against, so checking it against itself can
 * only ever say "unchanged since written". Who wrote it is a question the caller answers, by
 * naming the signers it expects.
 */
async function verifyBundle(options: VerifyCommand): Promise<number> {
  const verification = await verifyBundleAt(options.bundleDirectory, options.expectedSigners);
  for (const line of verification.lines) {
    process.stdout.write(`${line}\n`);
  }
  if (options.expectedSigners.length === 0) {
    process.stdout.write(
      "\nname the signer you expect with --signer <fingerprint> to check authenticity.\n",
    );
  }
  return verification.exitCode;
}

/**
 * What stored evidence would be removed, and only then removing it. A session holds every
 * prompt and the content of every file its run read, so a machine that ran the tool for a month
 * holds a month of those under a directory nobody looks in. Deleting them is a decision
 * somebody makes, which is why this reports first and needs --remove to act.
 */
async function collectGarbage(options: GcCommand): Promise<number> {
  const root = defaultSessionRoot(homedir());
  const collection = await collectSessions({
    root,
    olderThan: olderThanMs(options.olderThan),
    now: Date.now(),
    remove: options.remove,
  });
  process.stdout.write(`${root}\n${describeCollection(collection, options.remove)}\n`);
  return exitCodes.acceptable;
}

async function replay(options: ReplayCommand): Promise<number> {
  for (const line of await replayBundle(options.bundleDirectory)) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}

/** Long enough for a cold CDN, short enough that the bundled snapshot takes over quickly. */
const shortlistFetchTimeoutMs = 4_000;

/**
 * No model, no ledger: every number this prints came off the machine or out of the shortlist,
 * so there is no claim here for evidence to answer.
 */
async function select(options: SelectCommand): Promise<number> {
  const profile = await probeHardware(systemProbeEnvironment());
  const loaded = await loadShortlist({
    fetch: (url) => fetch(url, { signal: AbortSignal.timeout(shortlistFetchTimeoutMs) }),
    readFile: (path) => readFile(path, "utf8"),
    requested: options.shortlist,
  });
  const recommendation = recommendModel(profile, loaded.shortlist);

  for (const line of renderSelectReport({ profile, loaded, recommendation })) {
    process.stdout.write(`${line}\n`);
  }
  return recommendation.outcome === "model" ? 0 : 1;
}

/**
 * Which model this task gets, and on what grounds. Without a calibration behind it there is
 * nothing to route between, so the command line stands and the run is logged as pinned.
 */
async function chooseModel(
  task: string,
  home: string,
  random: RandomSource,
  settings: ResolvedSettings,
): Promise<{
  modelSpec: string | null;
  assignment: "calibration" | "competency" | "ucb" | "epsilon" | "pinned";
  /** What else the calibration measured, so an unserved pick can be swapped for a known one. */
  candidates: readonly string[];
  /**
   * Null where there was nothing to route between. The decision travels back rather than
   * being recorded here because the pick happens before the session opens: the model has
   * to be resolved to build the client, and there is no ledger to write to yet.
   */
  decision: RoutingDecision | null;
}> {
  const calibrated = await readCalibrationPick(defaultPickPath(home));
  if (calibrated?.model == null) {
    return { modelSpec: null, assignment: "pinned", decision: null, candidates: [] };
  }

  // Route between models that can actually answer. A calibration outlives the machine it was
  // measured on: a local arm whose model is no longer served can never be tried, and an arm
  // with no samples is exactly the one UCB reaches for first, so it won a routing every time
  // and was swapped out again every time. The reader saw a model named that no longer exists
  // here, and the arm never got a sample to stop it being picked again.
  const usable = await servedCandidates(calibrated.candidates, settings);
  const candidates = usable.length > 0 ? usable : calibrated.candidates;

  const log = await openRoutingLog({ path: defaultRoutingLogPath(home) });
  const taskClass = classifyTask(task).taskClass;
  const calibrationPick = candidates.includes(calibrated.model)
    ? calibrated.model
    : (candidates[0] ?? calibrated.model);
  // The table is asked with the calibration pick listed first, so a tie falls to it rather
  // than to whichever model the sweep happened to run first.
  const competency = lookupCompetency({
    table: await readCompetencyTable(defaultCompetencyTablePath(home)),
    taskClass,
    goldenSetVersion: calibrated.goldenSetVersion,
    candidates: [calibrationPick, ...candidates.filter((model) => model !== calibrationPick)],
  });
  const decision = routeModel({
    taskClass,
    candidates,
    calibrationPick,
    entries: (await log.read()).entries,
    random,
    competency,
  });

  process.stdout.write(
    `routing: ${decision.model} (${decision.assignment}) - ${decision.reason}\n`,
  );
  return {
    modelSpec: decision.model,
    assignment: decision.assignment,
    decision,
    candidates,
  };
}

/**
 * The candidates a run could actually reach: every non-local arm, plus the local ones the
 * endpoint says it serves. An endpoint that cannot be reached filters nothing, because a
 * discovery that failed is not evidence that a model is absent.
 */
async function servedCandidates(
  candidates: readonly string[],
  settings: ResolvedSettings,
): Promise<readonly string[]> {
  const local = candidates.filter((candidate) => candidate.startsWith("local:"));
  if (local.length === 0) {
    return candidates;
  }

  const backend = await resolveLocalBackend(settings, [parseModelSpec(local[0] ?? "local:x")]);
  if (backend === null) {
    return candidates;
  }
  const served = await fetchServedModels({
    baseUrl: backend.url,
    fetch: (url) => fetch(url, { signal: AbortSignal.timeout(servedModelsTimeoutMs) }),
  });
  // An endpoint that would not say what it serves filters nothing: not knowing is not the
  // same as knowing a model is absent.
  if (!served.enumerated) {
    return candidates;
  }
  return servableCandidates(candidates, new Set(served.models.map((model) => model.id)));
}

/**
 * A session: one process, one ledger, many tasks, each typed rather than passed.
 *
 * Everything expensive is built once, which is the point of a session over repeated runs: the
 * settings, the provider registry, the guard and its tool definitions, the evidence chain and
 * the screen all outlive a turn. What is rebuilt per turn is what carries state that a second
 * task must not inherit, and each of those is a decision rather than an oversight:
 *
 *   - the abort controller, because a signal is one-shot and a reused aborted one would make
 *     the next turn stop before it started;
 *   - the file-set registry, because declaring a set twice is an error and the check walks the
 *     whole chain when it decides what was edited before it was authorised;
 *   - the base commit, because the previous turn's edits are still uncommitted, and measuring
 *     against the start of the session would charge this turn with the last one's diff;
 *   - the routed model, because routing reads the task, and a different task may deserve a
 *     different arm.
 *
 * The conversation is what carries across, so a follow-up can say "now make it throw" and mean
 * the file the previous turn wrote.
 */
async function session(options: SessionCommand): Promise<number> {
  if (!statSync(options.workspace).isDirectory()) {
    throw new Error(`${options.workspace} is not a directory to work in`);
  }
  await offerInit(options.workspace);
  const settings = await settingsFor(options.workspace, {
    model: options.modelSpec,
    maxSteps: options.maxSteps,
    attempts: options.attempts,
    maxWallMinutes: options.maxWallMinutes,
    localEndpoint: options.localEndpoint,
    interfaceFlags: options.interfaceFlags,
  });

  const clock = createSystemClock();
  const random = createSystemRandom();
  const evidence = await openEvidenceSession({
    root: defaultSessionRoot(homedir()),
    sessionId: createSessionId(clock, random),
    clock,
  });
  const ui = startInterface({ task: "", workspace: options.workspace, settings, clock });

  // Resolved once, here, before any gate reads it. A symbolic ref is spent at the moment each
  // base-side question is asked, and `git` is on the shell allowlist.
  let baseRef = await resolveBaseCommit(options.workspace, options.baseRef);
  // The commit the session started on is what every turn is measured by, and it is sealed
  // once, before the first turn. The base moves to the end of each turn so the next is not
  // charged with the last one's diff, and a turn that read its gate commands from there would
  // run whatever the previous turn's model wrote into the manifest.
  const criteriaRef = baseRef;
  const sessionGateOptions = gateOptionsFrom(settings);
  const criteriaSealed = await sealAssembledCriteria({
    workspaceRoot: options.workspace,
    criteriaRef,
    ...(sessionGateOptions === undefined ? {} : { gateOptions: sessionGateOptions }),
    evidence,
    budgets: diffBudgetFrom(settings) ?? defaultDiffBudget,
    attemptCap: settings.attempts,
  });
  let history: readonly ConversationMessage[] = [];
  let turns = 0;
  let lastGreen = true;

  try {
    for (;;) {
      const task = await ui.readTask();
      if (task === null) {
        break;
      }
      turns += 1;
      ui.beginTurn(task);

      const outcome = await runOneTurn({
        task,
        history,
        baseRef,
        criteriaRef,
        criteriaSealed,
        options,
        settings,
        evidence,
        ui,
        clock,
        random,
      });
      history = outcome.messages;
      lastGreen = outcome.green;

      // Where this turn ended is where the next one starts being measured from. A repository
      // with no commit yet has nothing to hang one off, and the base stays where it was.
      const recorded = await recordTurnBaseline({
        workspaceRoot: options.workspace,
        label: `turn ${turns}`,
        previousBase: baseRef,
      });
      if (recorded !== null) {
        baseRef = recorded;
      }
    }
  } finally {
    if (turns > 0) {
      const written = await writeBundle(evidence, options.bundleDirectory, clock, ui.note);
      announceBundle(written.directory, ui.note);
    }
    await ui.stop();
    taskReader?.close();
    taskReader = null;
    taskLines = null;
  }

  if (turns === 0) {
    process.stdout.write("nothing was asked for, so nothing ran.\n");
    return 0;
  }
  return lastGreen ? 0 : 1;
}

/** One turn of a session, from a typed task to a settled set of gates. */
async function runOneTurn(input: {
  readonly task: string;
  readonly history: readonly ConversationMessage[];
  readonly baseRef: string;
  readonly criteriaRef: string;
  readonly criteriaSealed: boolean;
  readonly options: SessionCommand;
  readonly settings: ResolvedSettings;
  readonly evidence: EvidenceRecorder;
  readonly ui: SessionInterface;
  readonly clock: Clock;
  readonly random: RandomSource;
}): Promise<{ readonly messages: readonly ConversationMessage[]; readonly green: boolean }> {
  const { task, options, settings, evidence, ui, clock, random } = input;
  // Refused here, before the model is asked for anything: a run that discovers its runtime is
  // missing after the model has edited files has spent the interesting part of its budget
  // finding out.
  const isolation = parseIsolationOption(options.isolation, options.workspace);

  const routed = settings.modelPinned
    ? {
        modelSpec: null as string | null,
        assignment: "pinned" as const,
        decision: null,
        candidates: [] as readonly string[],
      }
    : await chooseModel(task, homedir(), random, settings);
  const modelSpec = routed.modelSpec ?? settings.modelSpec;
  const spec = parseModelSpec(modelSpec);
  const localBackend = await resolveLocalBackend(settings, [spec]);
  if (localBackend !== null) {
    await evidence.record(localEndpointRecord(localBackend));
  }
  if (routed.decision !== null) {
    await evidence.record(routingDecisionRecord(routed.decision));
  }

  const usable =
    spec.provider === "local" && localBackend !== null
      ? chooseUsableModel({
          requested: modelSpec,
          preflight: await preflightAll(evidence, localBackend.url, [modelSpec]),
          keys: settings.providerKeys,
          candidates: routed.candidates,
        })
      : ({ outcome: "as-requested", modelSpec, reason: "not a local model" } as const);
  if (usable.outcome === "substituted") {
    ui.note(`model: ${usable.modelSpec} instead of ${usable.requested}, ${usable.reason}`);
  }

  const registry = createProviderRegistry(registrySettingsFrom(settings, localBackend));
  const model = createRecordingModelClient(
    registry.create(parseModelSpec(usable.modelSpec)),
    evidence,
  );
  const fileSet = createFileSetRegistry(evidence);

  const interruption = new AbortController();
  const onInterrupt = () => {
    interruption.abort();
  };
  // SIGTERM as well as SIGINT: a run stopped by a supervisor, a container stop or a CI
  // cancellation arrives as SIGTERM, and a run that ignores it is killed with work in flight.
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  void ui.cancelled().then(onInterrupt);
  const startedAt = clock.now();
  const gateOptions = gateOptionsFrom(settings);
  const diffBudget = diffBudgetFrom(settings);

  try {
    const { loop, gates, green } = await runAgentTask({
      task,
      workspace: options.workspace,
      ...(isolation === null ? {} : { isolation: createContainerBackend(isolation) }),
      baseRef: input.baseRef,
      criteriaRef: input.criteriaRef,
      criteriaSealed: input.criteriaSealed,
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
      ...(settings.maxWallMinutes === null
        ? {}
        : { maxWallTimeMs: settings.maxWallMinutes * 60_000 }),
      model,
      evidence,
      fileSet,
      clock,
      random,
      emit: (event) => {
        ui.emit(event);
      },
      confirm: ui.confirm,
      abortSignal: interruption.signal,
      homeDir: homedir(),
      history: input.history,
      ...(gateOptions === undefined ? {} : { gateOptions }),
      ...(diffBudget === undefined ? {} : { diffBudget }),
    });

    reportGates(gates.outcome, evidence, ui.note);
    reportBonds(gates.bonds, ui.note);
    await logReward({
      evidence,
      home: homedir(),
      task,
      modelSpec: usable.modelSpec,
      assignment: routed.assignment,
      ratchet: summarizeRatchet(gates.outcome),
      green,
      changedFiles: gates.outcome.finalCycle.measures.changedFiles ?? null,
      latencyMs: clock.now() - startedAt,
      recordedAt: clock.now(),
      cost: await priceTask(usable.modelSpec, evidence),
      note: ui.note,
    });

    return {
      messages: loop.messages,
      // The run's own verdict. This had a third copy of the rule and it was the stale one, so
      // a session turn could call green what a single run would not.
      green,
    };
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
}

const initOnDisk = (workspace: string) => ({
  workspace,
  exists: (path: string) =>
    access(path).then(
      () => true,
      () => false,
    ),
  readFile: (path: string) =>
    readFile(path, "utf8").catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") {
        return null;
      }
      throw cause;
    }),
  writeFile: (path: string, text: string) => writeFile(path, text, "utf8"),
});

function describePlannedGate(gate: PlannedGate): string {
  return (
    `  ${gate.id}: ${gate.command} (${gate.parser}, ${gate.severity}) from scripts.${gate.script}` +
    (gate.reason === null ? "" : `\n    ${gate.reason}`)
  );
}

/** `swarm init`: the file a first run can work from, from what package.json declares. */
async function init(options: InitCommand): Promise<number> {
  if (!statSync(options.workspace, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `workspace ${options.workspace} is not a directory. Create it, or pass --workspace.`,
    );
  }
  const outcome = await initializeSwarmToml(initOnDisk(options.workspace));
  writeOut(`wrote ${outcome.path}`);
  for (const gate of outcome.gates) {
    writeOut(describePlannedGate(gate));
  }
  if (outcome.gates.length === 0) {
    writeOut("  no gate written: package.json declares none of test, lint, typecheck or build");
  }
  return 0;
}

/**
 * The first run in a workspace with a manifest and no swarm.toml offers to write one, in the
 * one question the chokepoint's plain path asks and with the same answer key. Off a terminal
 * nothing is asked and nothing is written: the run works from what the harness detects, as
 * it always did.
 */
async function offerInit(workspace: string): Promise<void> {
  const onDisk = initOnDisk(workspace);
  const isTty = process.stdout.isTTY === true && process.stdin.isTTY === true;
  if (!isTty || !(await initWouldHelp(onDisk))) {
    return;
  }
  process.stderr.write(
    "no swarm.toml here, and package.json declares scripts: swarm init would write one with " +
      "the gates read off them, each naming the rule that reads it.\n",
  );
  const answer = await askOnTerminal('Run "swarm init" first? [y/N] ');
  if (answer.trim().toLowerCase() !== "y") {
    return;
  }
  const outcome = await initializeSwarmToml(onDisk);
  process.stderr.write(`wrote ${outcome.path}\n`);
  for (const gate of outcome.gates) {
    process.stderr.write(`${describePlannedGate(gate)}\n`);
  }
}

/**
 * What owns the `swarm` command, and with `--fix`, making the right thing own it.
 *
 * A development checkout linked into the global prefix owns the command until it is removed,
 * and npm cannot install over it: the install either fails renaming a symlinked directory aside
 * or succeeds behind a stale executable that still points at the checkout. Neither presents as
 * what it is. This asks the question directly and answers it.
 */
async function doctor(options: DoctorCommand): Promise<number> {
  const here = resolve(import.meta.dirname, "..");
  const snapshot = await inspectInstall({
    runningVersion: await runningVersion(here),
    runningFrom: await realpath(here).catch(() => here),
    path: process.env.PATH ?? "",
    askRegistry: options.askRegistry,
  });

  const findings = diagnose(snapshot);
  const remedies = remediesFor(findings);
  for (const line of describeInstall(findings, remedies.length > 0 && !options.fix)) {
    process.stdout.write(`${line}\n`);
  }

  if (!options.fix || remedies.length === 0) {
    return findings.some((finding) => finding.severity === "broken") ? 1 : 0;
  }

  for (const command of remedies) {
    process.stdout.write(`running: ${command}\n`);
    const [file, ...args] = command.split(" ");
    if (file === undefined) {
      continue;
    }
    // An argument vector, not a shell: these are commands this file wrote, and keeping a shell
    // out of the one path that repairs an install keeps it that way.
    const finished = await new Promise<number>((settle) => {
      const child = spawn(file, args, { stdio: "inherit" });
      child.on("error", () => {
        settle(1);
      });
      child.on("close", (code) => {
        settle(code ?? 1);
      });
    });
    if (finished !== 0) {
      process.stdout.write(`\n${command} exited ${finished}, so the rest was not run.\n`);
      return 1;
    }
  }

  process.stdout.write("\nfixed. Run swarm doctor again to see what owns the command now.\n");
  return 0;
}

async function runningVersion(packageRoot: string): Promise<string> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    const version =
      manifest !== null && typeof manifest === "object"
        ? (manifest as { readonly version?: unknown }).version
        : undefined;
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Everything ambient the screen needs, gathered here so nothing below the composition root
 * reads a terminal, an environment variable, or the clock (invariant 8).
 */
function startInterface(input: {
  readonly task: string;
  readonly workspace: string;
  readonly settings: ResolvedSettings;
  readonly clock: Clock;
}): SessionInterface {
  const isTty = process.stdout.isTTY === true && process.stdin.isTTY === true;
  const ui = input.settings.interface;

  return startSessionInterface({
    task: input.task,
    workspace: input.workspace,
    isTty,
    interactive: ui.tui,
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
    writeError: (line) => {
      process.stderr.write(`${line}\n`);
    },
    clock: input.clock,
    theme: resolveTheme({
      mode: ui.color,
      term: process.env.TERM,
      noColorSet: process.env.NO_COLOR !== undefined,
      isTty,
      palette: ui.theme,
    }),
    bindings: resolveKeyBindings(ui.keys),
    ...(isTty ? { askOnTerminal } : {}),
    readLine: readTaskLine,
    openEvidence: ui.openEvidence,
    confirmTimeoutMs: ui.confirmTimeoutMs,
    spawnOpen: spawnOpener,
    platform: platform(),
  });
}

/**
 * One readline for the whole session, opened when the first task is asked for.
 *
 * Kept open rather than opened per question, because a fresh interface per line loses whatever
 * is already buffered from a pipe, and a piped session is a list of tasks somebody wrote down.
 * Null at end of input is what ends the session.
 */
let taskReader: ReturnType<typeof createInterface> | null = null;
let taskLines: AsyncIterator<string> | null = null;

async function readTaskLine(prompt: string): Promise<string | null> {
  if (taskReader === null) {
    taskReader = createInterface({ input: process.stdin, output: process.stderr });
    taskLines = taskReader[Symbol.asyncIterator]();
  }
  if (process.stdin.isTTY === true) {
    process.stderr.write(prompt);
  }
  const next = await taskLines?.next();
  if (next === undefined || next.done === true) {
    return null;
  }
  return next.value;
}

/** Readline, on the plain path only. Ink owns stdin whenever the screen is up. */
async function askOnTerminal(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

/**
 * An argument vector, spawned with no shell in between and under an environment built rather
 * than inherited. The path is one argument, so nothing in it is read as syntax by anything.
 */
function spawnOpener(command: OpenCommand): Promise<number | null> {
  return new Promise((settle, fail) => {
    const child = spawn(command.file, [...command.args], {
      env: openEnvironment(process.env),
      stdio: "ignore",
      detached: false,
    });
    child.on("error", fail);
    child.on("exit", (code) => {
      settle(code);
    });
  });
}

/** How long the embedded verifier gets before the panel says it could not be asked. */
const verifyTimeoutMs = 60_000;

/**
 * What the run produced, with the bundle checked by its own verifier here rather than taken
 * on trust: the panel may say verified only where that ran in this session and exited zero.
 */
async function summarizeEvidence(written: {
  readonly directory: string;
  readonly manifest: BundleManifest;
  readonly dag: EvidenceDag;
}): Promise<EvidenceSummary> {
  const location = evidenceLocation(written.directory, "harness");
  return {
    location,
    recordCount: written.manifest.recordCount,
    claimsVerified: written.dag.verifiedCount,
    claimsRefused: written.dag.unverifiedCount,
    verification: await runEmbeddedVerifier({
      location,
      nodeExecutable: process.execPath,
      environment: process.env,
      timeoutMs: verifyTimeoutMs,
    }),
  };
}

/** A past bundle, through the same panel a finished run ends on. Nothing is re-run. */
async function review(options: ReviewCommand): Promise<number> {
  const contents = await readBundle(options.bundleDirectory);
  const dag = buildEvidenceDag(contents.records, contents.payloads);
  const summary = await summarizeEvidence({
    directory: options.bundleDirectory,
    manifest: contents.manifest,
    dag,
  });

  for (const line of describeEvidence(summary, process.stdout.columns ?? null)) {
    process.stdout.write(`${line}\n`);
  }
  return summary.verification.kind === "verified" ? 0 : 1;
}

async function run(options: RunCommand): Promise<number> {
  if (!statSync(options.workspace, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `workspace ${options.workspace} is not a directory. Create it, or pass --workspace.`,
    );
  }

  await offerInit(options.workspace);
  const settings = await settingsFor(options.workspace, {
    model: options.modelSpec,
    maxSteps: options.maxSteps,
    attempts: options.attempts,
    maxWallMinutes: options.maxWallMinutes,
    localEndpoint: options.localEndpoint,
    interfaceFlags: options.interfaceFlags,
  });
  const random = createSystemRandom();
  // Before the session opens and before the model is asked for anything: a run that discovers
  // its runtime is missing after the model has edited files has spent the interesting part of
  // its budget finding out.
  const isolation = parseIsolationOption(options.isolation, options.workspace);
  const routed = settings.modelPinned
    ? {
        modelSpec: null as string | null,
        assignment: "pinned" as const,
        decision: null,
        candidates: [] as readonly string[],
      }
    : await chooseModel(options.task, homedir(), random, settings);
  const modelSpec = routed.modelSpec ?? settings.modelSpec;
  const spec = parseModelSpec(modelSpec);
  // Resolved before the session opens, so a machine with no local runtime fails here,
  // with the remedy named, rather than after an empty ledger has been created.
  const localBackend = await resolveLocalBackend(settings, [spec]);

  const clock = createSystemClock();
  const sessionRoot = defaultSessionRoot(homedir());
  const evidence = await openEvidenceSession({
    root: sessionRoot,
    sessionId: createSessionId(clock, random),
    clock,
  });
  if (localBackend !== null) {
    await evidence.record(localEndpointRecord(localBackend));
  }
  if (routed.decision !== null) {
    // Written here rather than where the choice was made, because the choice has to happen
    // before the session exists. What it names is still the decision that ran this task.
    await evidence.record(routingDecisionRecord(routed.decision));
  }

  // What the backend is serving decides, rather than what a calibration measured on some
  // earlier day. Without this a routed model the endpoint has never heard of reaches dispatch
  // and answers Not Found, which names neither the endpoint nor the model that was missing.
  const usable =
    spec.provider === "local" && localBackend !== null
      ? chooseUsableModel({
          requested: modelSpec,
          preflight: await preflightAll(evidence, localBackend.url, [modelSpec]),
          keys: settings.providerKeys,
          candidates: routed.candidates,
        })
      : ({ outcome: "as-requested", modelSpec, reason: "not a local model" } as const);
  if (usable.outcome === "substituted") {
    process.stdout.write(
      `model: ${usable.modelSpec} instead of ${usable.requested}, ${usable.reason}\n`,
    );
  }
  const runSpec = parseModelSpec(usable.modelSpec);

  const registry = createProviderRegistry(registrySettingsFrom(settings, localBackend));
  const model = createRecordingModelClient(registry.create(runSpec), evidence);
  const fileSet = createFileSetRegistry(evidence);

  const ui = startInterface({
    task: options.task,
    workspace: options.workspace,
    settings,
    clock,
  });

  const interruption = new AbortController();
  const onInterrupt = () => {
    interruption.abort();
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  // Ink holds stdin in raw mode, so Ctrl-C arrives as a keystroke rather than as a signal.
  // Both routes reach the same abort, and neither is the one that leaves the view.
  void ui.cancelled().then(onInterrupt);
  const startedAt = clock.now();
  const gateOptions = gateOptionsFrom(settings);
  const diffBudget = diffBudgetFrom(settings);

  try {
    const { loop, gates, green } = await runAgentTask({
      task: options.task,
      workspace: options.workspace,
      ...(isolation === null ? {} : { isolation: createContainerBackend(isolation) }),
      baseRef: await resolveBaseCommit(options.workspace, options.baseRef),
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
      ...(settings.maxWallMinutes === null
        ? {}
        : { maxWallTimeMs: settings.maxWallMinutes * 60_000 }),
      model,
      evidence,
      fileSet,
      clock,
      random,
      emit: (event) => {
        ui.emit(event);
        if (options.json) {
          process.stdout.write(`${jsonEventLine(event, { runId: evidence.sessionId })}\n`);
        }
      },
      confirm: ui.confirm,
      abortSignal: interruption.signal,
      homeDir: homedir(),
      ...(gateOptions === undefined ? {} : { gateOptions }),
      ...(diffBudget === undefined ? {} : { diffBudget }),
    });

    reportGates(gates.outcome, evidence, ui.note);

    // Every finished run is one more sample the router learns from, and the ratchet numerics
    // ride along so a pass earned by erosion cannot look like a win (section 3.8).
    await logReward({
      evidence,
      green,
      home: homedir(),
      task: options.task,
      modelSpec: usable.modelSpec,
      assignment: routed.assignment,
      ratchet: summarizeRatchet(gates.outcome),
      // The diff-budget gate's own measure, merged into the cycle. Read from there rather
      // than recomputed, so the number the reward turns on is one a gate recorded.
      changedFiles: gates.outcome.finalCycle.measures.changedFiles ?? null,
      latencyMs: clock.now() - startedAt,
      recordedAt: clock.now(),
      cost: await priceTask(usable.modelSpec, evidence),
      note: ui.note,
    });

    const written = await writeBundle(evidence, options.bundleDirectory, clock, ui.note);
    announceBundle(written.directory, ui.note);
    await ui.presentEvidence(await summarizeEvidence(written));
    // The run's own verdict rather than a second reading of the gate strip: recomputing it
    // here from `settled` alone let the two disagree, and they did. A run wrote three files
    // into a workspace whose only command gate found no tests to run, so nothing measured the
    // change, `green` said so, and the exit code said 0 because no gate had actually failed.
    const verdict = runVerdict({
      cycle: gates.outcome.finalCycle,
      integrity: "valid",
      signer: "untrusted",
      executionTrust: isolation === null ? "restricted" : "isolated",
    });
    const code = exitCodeFor(loop.stopReason, green);
    if (options.json) {
      process.stdout.write(
        `${jsonResultLine({
          runId: evidence.sessionId,
          verdict,
          bundleDirectory: written.directory,
          exitCode: code,
        })}\n`,
      );
    }
    return code;
  } finally {
    await ui.stop();
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
}

function describeCycle(cycle: GateCycle): string {
  return cycle.runs
    .map((gate) => {
      const label = gate.status === "not-applicable" ? "n/a" : gate.status;
      const advisory = gate.severity === "advisory" ? " (advisory)" : "";
      return `  ${label.padEnd(8)} ${gate.gateId}${advisory}: ${gate.detail}`;
    })
    .join("\n");
}

/** Written through `note`, so an interactive screen holds them until it comes down. */
function reportGates(
  outcome: AutoResolveOutcome,
  evidence: EvidenceRecorder,
  note: (line: string) => void,
): void {
  // Said before the gate table rather than after it, because a table of passes over a tree
  // nothing touched is the most misleading thing this tool can print. A model that answered in
  // prose, or emitted its tool calls as text the protocol never parsed, reaches here having
  // done nothing, stops for the honest reason "completed", and every gate then passes over an
  // empty diff. A task can legitimately change nothing, so this states the fact rather than
  // calling it a failure.
  if (outcome.finalCycle.measures.changedFiles === 0) {
    note(
      "\nno files were changed. The gates below measured an unchanged workspace, so they say " +
        "nothing about work being done.",
    );
  }
  note(`\ngates:\n${describeCycle(outcome.finalCycle)}`);

  for (const attempt of outcome.attempts) {
    note(
      `attempt ${attempt.attempt}: ${attempt.decision.accepted ? "accepted" : "REJECTED"} - ` +
        `${attempt.decision.detail}`,
    );
  }

  for (const run of outstandingJustifications(outcome.finalCycle, citedRecords(evidence))) {
    note(
      `\nthe ${run.gateId} gate asked for a justification and no claim cites its record ` +
        `${run.record}. This does not block, and the bundle shows it unanswered.`,
    );
  }

  if (outcome.escalation !== null) {
    note(`\n${describeEscalation(outcome.escalation)}`);
  }
}

/**
 * What this run cost, from its own ledger's token counts times the published rate. A table
 * that cannot be read prices the run as unknown: the run still finishes, and the reward
 * treats unknown as neutral rather than free (see src/select/reward.ts).
 */
async function priceTask(modelSpec: string, evidence: EvidenceRecorder): Promise<TaskCost> {
  try {
    const loaded = await loadPricing({
      fetch: (url) => fetch(url, { signal: AbortSignal.timeout(shortlistFetchTimeoutMs) }),
    });
    return costOfTask({ modelSpec, entries: payloadsSince(evidence, 0), pricing: loaded.pricing });
  } catch (cause) {
    return {
      costUsd: null,
      source: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 0,
      detail: `no pricing table could be read: ${describeError(cause)}`,
    };
  }
}

interface RewardLogInput {
  readonly evidence: EvidenceRecorder;
  readonly home: string;
  readonly task: string;
  readonly modelSpec: string;
  readonly assignment: "calibration" | "competency" | "ucb" | "epsilon" | "pinned";
  readonly ratchet: ReturnType<typeof summarizeRatchet>;
  /** The run's own verdict, so the router is not taught by the gate strip alone. */
  readonly green: boolean;
  readonly changedFiles: number | null;
  readonly latencyMs: number;
  readonly recordedAt: number;
  readonly cost: TaskCost;
  readonly note: (line: string) => void;
}

/**
 * Written twice on purpose: into the session ledger, where it is part of this run's evidence,
 * and into the cross-session routing log, which is the signal the bandit reads. A failure to
 * write the log is reported and not fatal: routing is a hint, and losing one sample must not
 * cost a run that has already finished.
 */
async function logReward(input: RewardLogInput): Promise<void> {
  const classification = classifyTask(input.task);
  const entry = buildRewardEntry({
    recordedAt: input.recordedAt,
    sessionId: input.evidence.sessionId,
    taskClass: classification.taskClass,
    model: input.modelSpec,
    assignment: input.assignment,
    ratchet: input.ratchet,
    green: input.green,
    changedFiles: input.changedFiles,
    latencyMs: input.latencyMs,
    costUsd: input.cost.costUsd,
    costSource: input.cost.source,
  });

  await input.evidence.record({
    type: "reward",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      ...entry,
      taskClassRule: classification.rule,
      costDetail: input.cost.detail,
      costInputTokens: input.cost.inputTokens,
      costOutputTokens: input.cost.outputTokens,
    },
  });

  try {
    const log = await openRoutingLog({ path: defaultRoutingLogPath(input.home) });
    await log.append(entry);
    input.note(`\nrouting reward: ${entry.reward.toFixed(3)} (${entry.rewardReason})`);
  } catch (cause) {
    input.note(`[routing] the reward could not be appended to the log: ${describeError(cause)}`);
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function announceBundle(directory: string, note: (line: string) => void = writeOut): void {
  note(`\nevidence bundle: ${directory}`);
  note(`verify it anywhere: node ${join(directory, "verify.mjs")} ${directory}`);
  note(`review it: open ${join(directory, "review.html")}`);
}

function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The gates on their own: no model, no retries, just what the workspace measures right now. */
async function gates(options: GatesCommand): Promise<number> {
  const settings = await settingsFor(options.workspace, noFlagSettings);
  const clock = createSystemClock();
  const random = createSystemRandom();
  const evidence = await openEvidenceSession({
    root: defaultSessionRoot(homedir()),
    sessionId: createSessionId(clock, random),
    clock,
  });
  const fileSet = createFileSetRegistry(evidence);
  const baseRef = await resolveBaseCommit(options.workspace, options.baseRef);

  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    // The commit that was measured, not the name it was asked for: a bundle saying HEAD
    // names whatever HEAD points at when someone reads the bundle.
    payload: { task: "gates", workspace: options.workspace, baseRef },
  });

  const gateOptions = gateOptionsFrom(settings);
  const diffBudget = diffBudgetFrom(settings);
  // Sealed before anything runs, exactly as a task run seals its criteria before the loop, so
  // a gates-only bundle is held to the same conformance check by the verifier.
  const criteriaSealed = await sealAssembledCriteria({
    workspaceRoot: options.workspace,
    criteriaRef: baseRef,
    ...(gateOptions === undefined ? {} : { gateOptions }),
    evidence,
    budgets: diffBudget ?? defaultDiffBudget,
    attemptCap: 0,
  });
  const run = await runGatesEngine({
    workspaceRoot: options.workspace,
    baseRef,
    evidence,
    fileSet,
    // This command has no planner, so nothing declared an intended set. Without a scope the
    // caller authorised, the file-set gate reports what it observed and abstains rather than
    // failing every changed repository for a declaration nobody was there to make.
    authorizedScope:
      options.allowedFiles === null
        ? { kind: "observed" }
        : { kind: "allowed-files", files: options.allowedFiles },
    clock,
    emit: () => {},
    // No retries are offered, so none are spent: this command measures and reports.
    cap: 0,
    criteriaSealed,
    resolve: () => Promise.reject(new Error("swarm gates reports; it does not fix")),
    ...(gateOptions === undefined ? {} : { gateOptions }),
    ...(diffBudget === undefined ? {} : { budgets: diffBudget }),
  });

  process.stdout.write(
    `project: ${run.detection.types.join(", ") || "no manifest detected"}\n\n` +
      `${describeCycle(run.outcome.firstCycle)}\n`,
  );
  for (const gate of outstandingJustifications(run.outcome.firstCycle, citedRecords(evidence))) {
    process.stdout.write(`\nthe ${gate.gateId} gate asked for a justification: ${gate.detail}\n`);
  }
  reportBonds(run.bonds, writeOut);

  // The verdict rather than a boolean: a change nothing executed used to exit 0 here, because
  // "no blocking gate failed" is true of a run where the only thing that passed was a linter.
  // Each dimension is reported with its reason, and unmeasured is never coerced into a pass.
  const verdict = runVerdict({
    cycle: run.outcome.firstCycle,
    integrity: "valid",
    signer: "untrusted",
    executionTrust: "restricted",
  });
  process.stdout.write(`\n${describeVerdict(verdict).join("\n")}\n`);

  announceBundle((await writeBundle(evidence, options.bundleDirectory, clock)).directory);
  const vacuous = vacuousBlockingBonds(run.bonds).length > 0;
  return verdict.acceptable && !vacuous ? 0 : 1;
}

/**
 * What each pass was shown to be worth. Said after the table, since the table is what the
 * gates decided and this is whether that decision could have gone the other way.
 */
function reportBonds(bonds: readonly BondOutcome[], note: (line: string) => void): void {
  if (bonds.length === 0) {
    return;
  }
  note("\nbonds, one per gate that passed:");
  for (const bond of bonds) {
    const mark =
      bond.verdict === "held"
        ? "held"
        : bond.verdict === "vacuous"
          ? "VACUOUS"
          : bond.verdict === "not-bonded"
            ? "not bonded"
            : bond.verdict;
    note(`  ${bond.gateId}: ${mark}. ${bond.detail}`);
  }
  const vacuous = vacuousBlockingBonds(bonds);
  if (vacuous.length > 0) {
    note(
      `\n${vacuous.map((bond) => bond.gateId).join(", ")}: a blocking gate passed over a change it ` +
        "had to refuse, so its pass has not been shown capable of failing and this run is not green.",
    );
  }
}

async function writeBundle(
  evidence: EvidenceRecorder,
  destination: string | null,
  clock: Clock,
  note: (line: string) => void = writeOut,
): Promise<{
  readonly directory: string;
  readonly manifest: BundleManifest;
  readonly dag: EvidenceDag;
}> {
  const signing = await resolveSigningKey(createKeychainSecretStore({ platform: platform() }));
  if (signing.notice !== null) {
    note(`[signing] ${signing.notice}`);
  }
  const directory = destination ?? join(evidence.directory, "bundle");
  const written = await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination: directory,
    signingKey: signing.key,
    clock,
  });
  return { directory, manifest: written.manifest, dag: written.dag };
}

/** Roughly the build guide's five to ten minutes: four cases, three repeats, two models. */
const calibrationModelLimit = 2;

async function calibrate(options: CalibrateCommand): Promise<number> {
  const settings = await settingsFor(process.cwd(), noFlagSettings);
  const clock = createSystemClock();
  const random = createSystemRandom();
  const home = homedir();

  const profile = await probeHardware(systemProbeEnvironment());
  const loaded = await loadShortlist({
    fetch: (url) => fetch(url, { signal: AbortSignal.timeout(shortlistFetchTimeoutMs) }),
    readFile: (path) => readFile(path, "utf8"),
    requested: options.shortlist,
  });
  const recommendation = recommendModel(profile, loaded.shortlist);
  const staticPick = recommendation.outcome === "model" ? recommendation.modelSpec : null;
  const models =
    options.models ??
    (recommendation.outcome === "model"
      ? calibrationCandidates(recommendation, profile, calibrationModelLimit)
      : []);

  if (models.length === 0) {
    throw new Error(
      "there is nothing to calibrate: the shortlist matched no tier for this machine and " +
        "--models named none. Run swarm select to see why, or pass --models <a,b>.",
    );
  }

  const goldenSet = await readGoldenSet({ localPath: defaultGoldenSetPath(home) });
  const evidence = await openEvidenceSession({
    root: defaultSessionRoot(home),
    sessionId: createSessionId(clock, random),
    clock,
  });
  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: {
      task: "calibrate",
      models: [...models],
      repeats: options.repeats,
      goldenSetVersion: goldenSet.version,
      staticPick,
    },
  });

  const localBackend = await resolveLocalBackend(
    settings,
    models.map((candidate) => parseModelSpec(candidate)),
  );
  if (localBackend !== null) {
    await evidence.record(localEndpointRecord(localBackend));
  }

  // Before any run exists: a model the backend does not serve fails at dispatch, and repeats
  // that never dispatched would be recorded as runs of a model nothing was measured about.
  const runSet =
    localBackend === null ? models : await preflight(evidence, localBackend.url, models);
  if (runSet.length === 0) {
    const empty = (await writeBundle(evidence, options.bundleDirectory, clock)).directory;
    process.stdout.write(
      "no usable model: the backend serves none of the models asked for, so nothing was " +
        "calibrated, no runs were created, and no pick was written.\n",
    );
    announceBundle(empty);
    return 1;
  }

  const registry = createProviderRegistry(registrySettingsFrom(settings, localBackend));
  // Outside the session store, which tools may never write to, and outside any workspace.
  const scratchRoot = await mkdtemp(join(tmpdir(), "swarm-calibration-"));

  // One round trip before the golden set: a runtime that cannot form a single tool call will
  // score every model at zero, and learning that from the report costs the whole run.
  const canary = await canaryFor(evidence, registry, runSet, scratchRoot);
  if (canary !== null && !canary.healthy) {
    const sick = (await writeBundle(evidence, options.bundleDirectory, clock)).directory;
    process.stdout.write(
      "no usable backend: calibration would measure the runtime rather than the model, " +
        "so no runs were created and no pick was written.\n",
    );
    announceBundle(sick);
    await rm(scratchRoot, { recursive: true, force: true });
    return 1;
  }

  const isTty = process.stdout.isTTY === true && process.stdin.isTTY === true;
  const screen = startCalibrateInterface({
    isTty,
    interactive: settings.interface.tui,
    theme: resolveTheme({
      mode: settings.interface.color,
      term: process.env.TERM,
      noColorSet: process.env.NO_COLOR !== undefined,
      isTty,
      palette: settings.interface.theme,
    }),
    clock,
    bundleDirectory: options.bundleDirectory ?? defaultSessionRoot(home),
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
    ...(isTty && settings.interface.tui ? { render: inkRender } : {}),
  });
  screen.apply({
    type: "plan",
    plan: {
      models: [...runSet],
      cases: goldenSet.cases.length,
      repeats: options.repeats,
      goldenSetVersion: goldenSet.version,
    },
  });

  try {
    const result = await runCalibration({
      models: runSet,
      repeats: options.repeats,
      goldenSet,
      staticPick,
      onProgress: (event) => {
        screen.apply(
          event.type === "run-started"
            ? {
                type: "run-started",
                current: { model: event.model, caseId: event.caseId, repeat: event.repeat },
              }
            : {
                type: "run-finished",
                outcome: {
                  model: event.observation.model,
                  caseId: event.observation.caseId,
                  repeat: event.observation.repeat,
                  executed: event.observation.executed,
                  gatePassed: event.observation.gatePassed,
                  abstentionReason: event.observation.abstentionReason,
                },
              },
        );
      },
      deps: {
        evidence,
        clock,
        random,
        createModel: (modelSpec) => registry.create(parseModelSpec(modelSpec)),
        commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
        probeMemory: createOllamaMemoryProbe({
          // With no local model among the candidates there is nothing to probe, and the
          // probe against the default port simply reports nothing.
          baseUrl: localBackend?.url ?? "http://127.0.0.1:11434/v1",
          fetch: (url) => fetch(url, { signal: AbortSignal.timeout(2_000) }),
        }),
        scratchRoot,
        maxSteps: 12,
        abortSignal: new AbortController().signal,
      },
    });

    const directory = (await writeBundle(evidence, options.bundleDirectory, clock)).directory;
    for (const line of renderCalibrationReport({
      goldenSetVersion: result.goldenSetVersion,
      cases: result.cases,
      repeats: result.repeats,
      models: result.models,
      pick: result.pick,
      comparison: result.comparison,
      bundleDirectory: directory,
    })) {
      process.stdout.write(`${line}\n`);
    }
    announceBundle(directory);

    await writeCalibrationPick(defaultPickPath(home), {
      model: result.pick.model,
      candidates: [...runSet],
      goldenSetVersion: result.goldenSetVersion,
      recordedAt: clock.now(),
    });
    // The class-by-class counts beside the pick, from this sweep's own run records, added to
    // whatever earlier sweeps of the same golden set already measured.
    const tablePath = defaultCompetencyTablePath(home);
    await writeCompetencyTable(
      tablePath,
      withSweep(
        await readCompetencyTable(tablePath),
        sweepFromRuns(
          {
            sessionId: evidence.sessionId,
            goldenSetVersion: result.goldenSetVersion,
            recordedAt: clock.now(),
          },
          result.observations,
        ),
      ),
    );
    return result.pick.model === null ? 1 : 0;
  } finally {
    // Before the report is read, so the screen is down and the terminal is the shell's again.
    await screen.stop();
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

/** Enough attempts to tell a runtime that cannot form a call from one that merely stumbled. */
const canaryAttempts = 3;

/**
 * The canary, against the first local model in the run set. Frontier models are not what this
 * watches: it exists for a local runtime whose tool-call transport has stopped working, which
 * is a property of the backend rather than of any one model it serves.
 */
async function canaryFor(
  evidence: EvidenceRecorder,
  registry: ReturnType<typeof createProviderRegistry>,
  runSet: readonly string[],
  scratchRoot: string,
): Promise<BackendCanary | null> {
  const local = runSet.find((spec) => parseModelSpec(spec).provider === "local");
  if (local === undefined) {
    return null;
  }

  const probeRoot = join(scratchRoot, "canary");
  await mkdir(probeRoot, { recursive: true });
  const guard = createPolicyGuard({
    workspaceRoot: probeRoot,
    homeDir: probeRoot,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [],
  });

  const canary = await runBackendCanary({
    modelSpec: local,
    model: registry.create(parseModelSpec(local)),
    tools: createWorkspaceTools(guard),
    attempts: canaryAttempts,
    abortSignal: new AbortController().signal,
  });

  await evidence.record(canaryRecord(canary));
  for (const line of describeCanary(canary)) {
    process.stdout.write(`${line}\n`);
  }
  return canary;
}

/** How long a local backend gets to say what it serves before the answer stops being worth waiting for. */
const servedModelsTimeoutMs = 2_000;

/**
 * Which of the requested models the backend is actually serving, recorded and said out loud.
 * A backend that cannot be asked excludes nothing: an unanswered probe is not a backend
 * serving nothing, and treating it as one would drop every model on no evidence at all.
 */
async function preflight(
  evidence: EvidenceRecorder,
  backendUrl: string,
  models: readonly string[],
): Promise<readonly string[]> {
  const checked = await preflightAll(evidence, backendUrl, models);
  // Calibration's own account of the probe: which models it will not create runs for, and
  // how many of the ones asked for survive. A single run says something else, because it
  // goes on to substitute one and needs to name the substitution rather than the shortfall.
  for (const line of describePreflight(checked)) {
    process.stdout.write(`${line}\n`);
  }
  return checked.runnable;
}

/** The whole answer rather than the runnable subset, for the caller that has to choose. */
async function preflightAll(
  evidence: EvidenceRecorder,
  backendUrl: string,
  models: readonly string[],
): Promise<LocalModelPreflight> {
  const checked = preflightLocalModels({
    requested: models,
    backendUrl,
    list: await fetchServedModels({
      baseUrl: backendUrl,
      fetch: (url, init) => fetch(url, init),
      signal: AbortSignal.timeout(servedModelsTimeoutMs),
    }),
  });

  await evidence.record(preflightRecord(checked));
  return checked;
}

/** Turns a task that went wrong into a case the golden set will measure against forever. */
async function addCase(options: AddCaseCommand): Promise<number> {
  const seed: Record<string, string> = {};
  for (const path of options.seed) {
    seed[path] = await readFile(resolve(options.workspace, path), "utf8");
  }

  const clock = createSystemClock();
  const one = parseCalibrationCase(
    {
      id: `captured-${new Date(clock.now())
        .toISOString()
        .replace(/[-:.TZ]/g, "")
        .slice(0, 14)}`,
      taskClass: classifyTask(options.task).taskClass,
      prompt: options.task,
      seed,
      gateCommand: options.gateCommand,
      origin: "captured",
      addedAt: new Date(clock.now()).toISOString().slice(0, 10),
    },
    "the case being captured",
  );

  const localPath = defaultGoldenSetPath(homedir());
  const goldenSet = await appendCalibrationCase({ localPath }, one);

  process.stdout.write(
    `captured ${one.id} (${one.taskClass}) from ${options.seed.length} file(s).\n` +
      `the golden set now holds ${goldenSet.cases.length} case(s) at version ${goldenSet.version}.\n` +
      `it is append-only: this case will be measured by every calibration from now on.\n`,
  );
  return 0;
}

/**
 * A tasks file is one task per line, or a JSON task graph. Both reach the same run: what a
 * person hand-writes and what a planner declares are the same artifact, so the scheduler and
 * the outcome claim do not care which happened, and the record says which it was.
 */
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
  readonly workspace: string;
  readonly sessionRoot: string;
  readonly runId: string;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly home: string;
  readonly model: () => ModelClient;
  readonly maxSteps: number;
}

/**
 * What the shell is told. Green is the gates' verdict on the tree, so that is the exit code,
 * and a run someone cancelled reports the code a shell reports for that rather than borrowing
 * the one that means the work was measured and found wanting.
 */
function exitCodeFor(stopReason: StopReason, green: boolean): number {
  // 128 + SIGINT, which is what every shell reports for a process a person stopped, and which
  // a shell will report for this process anyway. The taxonomy in machine-output.ts covers the
  // codes a caller branches on; this one is the convention.
  const cancelledBySignal = 130;
  if (stopReason === "interrupted") {
    return cancelledBySignal;
  }
  return green ? exitCodes.acceptable : exitCodes.notAcceptable;
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
    model: createRecordingModelClient(context.model(), evidence),
    evidence,
    clock: context.clock,
    random: context.random,
    emit: () => {},
    maxSteps: context.maxSteps,
    abortSignal: new AbortController().signal,
  });

  if (outcome.graph !== null) {
    const named = outcome.graph.nodes.map((node) => node.id).join(", ");
    process.stdout.write(`planned ${outcome.graph.nodes.length} task(s): ${named}\n`);
  }
  return outcome;
}

/**
 * Every task landed something. Which attempt it was is the selection's business; what the
 * exit code answers is whether the run produced a change for each task it was given.
 */
function landedEveryTask(result: ParallelRunResult): number {
  const landed = new Set(
    (result.queue?.landings ?? [])
      .filter((landing) => landing.landed)
      .map((landing) => result.workers.find((worker) => worker.workerId === landing.workerId))
      .map((worker) => worker?.taskId)
      .filter((taskId): taskId is string => taskId !== undefined),
  );
  const asked = new Set(result.workers.map((worker) => worker.taskId));
  return landed.size === asked.size ? 0 : 1;
}

/**
 * N workers over worktrees, then the queue. The composition root does what it always does:
 * every ambient thing enters here, and the coordinator itself stays testable without one.
 */
async function parallel(options: ParallelCommand): Promise<number> {
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

  // One place this run is stopped from: the wall budget, a Ctrl-C, and a supervisor's SIGTERM
  // all reach the same signal, and every worker is handed that signal rather than a fresh
  // controller nobody aborts. Before this, `--max-wall-minutes` reached `runInParallel` through
  // a spread into an options object with no such field, so it did nothing at all.
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

  const workerCount = tasks.length * redundancy;
  process.stdout.write(
    redundancy > 1
      ? `starting ${tasks.length} task(s) ${redundancy} ways from ${options.baseRef}, ` +
          `${concurrency} of ${workerCount} worker(s) at a time\n`
      : `starting ${workerCount} worker(s) from ${options.baseRef}, ` +
          `${concurrency} at a time\n`,
  );
  const gateOptions = gateOptionsFrom(settings);

  try {
    const result = await runInParallel({
      repositoryRoot: options.workspace,
      baseRef: options.baseRef,
      tasks,
      runId,
      scratchRoot,
      coordinator,
      createWorkerSession: (workerId) =>
        openEvidenceSession({ root: sessionRoot, sessionId: `${runId}-${workerId}`, clock }),
      createModel: (_workerId, evidence) =>
        createRecordingModelClient(registry.create(spec), evidence),
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
    announceBundle(directory);

    const rejected = result.queue?.landings.filter((landing) => !landing.landed) ?? [];
    if (rejected.length > 0) {
      return 1;
    }
    // Where a task is tried several ways, the attempts that lost are the mechanism working.
    // What has to hold is that every task landed something, not that every worker was green.
    return redundancy > 1
      ? landedEveryTask(result)
      : result.workers.every((worker) => worker.green)
        ? 0
        : 1;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    cancellation.dispose();
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

async function routing(): Promise<number> {
  const path = defaultRoutingLogPath(homedir());
  const log = await openRoutingLog({ path });

  for (const line of renderRoutingReport({ path, contents: await log.read() })) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}

async function main(): Promise<number> {
  const options: CommandLine = parseCommandLine(process.argv.slice(2), {
    currentDirectory: process.cwd(),
  });
  if (options.command === "help") {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (options.command === "verify") {
    return verifyBundle(options);
  }
  if (options.command === "gc") {
    return collectGarbage(options);
  }
  if (options.command === "replay") {
    return replay(options);
  }
  if (options.command === "review") {
    return review(options);
  }
  if (options.command === "select") {
    return select(options);
  }
  if (options.command === "calibrate") {
    return calibrate(options);
  }
  if (options.command === "add-case") {
    return addCase(options);
  }
  if (options.command === "routing") {
    return routing();
  }
  if (options.command === "parallel") {
    return parallel(options);
  }
  if (options.command === "doctor") {
    return doctor(options);
  }
  if (options.command === "session") {
    return session(options);
  }
  if (options.command === "init") {
    return init(options);
  }
  return options.command === "gates" ? gates(options) : run(options);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
