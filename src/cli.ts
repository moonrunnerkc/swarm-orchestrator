#!/usr/bin/env node
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { arch, availableParallelism, homedir, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { runAgentTask } from "./agent-run.ts";
import {
  type AddCaseCommand,
  type CalibrateCommand,
  type CommandLine,
  type DoctorCommand,
  type GatesCommand,
  type ParallelCommand,
  parseCommandLine,
  type ReplayCommand,
  type ReviewCommand,
  type RunCommand,
  type SelectCommand,
  type SessionCommand,
  usage,
} from "./cli-options.ts";
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
import {
  createSessionId,
  defaultSessionRoot,
  type EvidenceRecorder,
  openEvidenceSession,
} from "./evidence/session.ts";
import { createKeychainSecretStore, resolveSigningKey } from "./evidence/signing.ts";
import type { AutoResolveOutcome } from "./gates/auto-resolve.ts";
import type { GateSetOptions } from "./gates/default-gates.ts";
import { defaultDiffBudget, runGatesEngine } from "./gates/engine.ts";
import { describeEscalation } from "./gates/escalation.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import type { DiffBudget } from "./gates/gate-definition.ts";
import { citedRecords, type GateCycle, outstandingJustifications } from "./gates/gate-runner.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
import { summarizeRatchet } from "./gates/ratchet-summary.ts";
import { recordTurnBaseline } from "./gates/turn-baseline.ts";
import { diagnose, remediesFor } from "./install/health.ts";
import { inspectInstall } from "./install/inspect.ts";
import { describeInstall } from "./install/report.ts";
import {
  localEndpointRecord,
  type ResolvedLocalEndpoint,
  resolveLocalEndpoint,
} from "./providers/endpoint-resolution.ts";
import { discoverLocalEndpoints } from "./providers/local-discovery.ts";
import { type ModelSpec, parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { fetchServedModels } from "./providers/served-models.ts";
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
import { loadShortlist } from "./select/shortlist-source.ts";
import { systemProbeEnvironment } from "./select/system-probe.ts";
import { classifyTask } from "./select/task-class.ts";
import { costOfTask, type TaskCost } from "./select/task-cost.ts";
import { type RoutingDecision, routeModel } from "./select/ucb.ts";
import { createSandbox, defaultShellAllowlist } from "./tools/sandbox.ts";
import { createWorkspaceTools } from "./tools/workspace-tools.ts";
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
    sleep: (milliseconds) =>
      new Promise((resolveSleep) => {
        setTimeout(resolveSleep, milliseconds);
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
} {
  return {
    anthropicApiKey: settings.providerKeys.anthropic,
    openaiApiKey: settings.providerKeys.openai,
    googleApiKey: settings.providerKeys.google,
    localBaseUrl: localBackend?.url,
    localThinking: settings.localThinking,
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
): Promise<{
  modelSpec: string | null;
  assignment: "calibration" | "ucb" | "epsilon" | "pinned";
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

  const log = await openRoutingLog({ path: defaultRoutingLogPath(home) });
  const decision = routeModel({
    taskClass: classifyTask(task).taskClass,
    candidates: calibrated.candidates,
    calibrationPick: calibrated.model,
    entries: (await log.read()).entries,
    random,
  });

  process.stdout.write(
    `routing: ${decision.model} (${decision.assignment}) - ${decision.reason}\n`,
  );
  return {
    modelSpec: decision.model,
    assignment: decision.assignment,
    decision,
    candidates: calibrated.candidates,
  };
}

/**
 * A session: one process, one ledger, many tasks, each typed rather than passed.
 *
 * Everything expensive is built once, which is the point of a session over repeated runs: the
 * settings, the provider registry, the sandbox and its tool definitions, the evidence chain and
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
  const settings = await settingsFor(options.workspace, {
    model: options.modelSpec,
    maxSteps: options.maxSteps,
    attempts: options.attempts,
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

  let baseRef = options.baseRef;
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
  readonly options: SessionCommand;
  readonly settings: ResolvedSettings;
  readonly evidence: EvidenceRecorder;
  readonly ui: SessionInterface;
  readonly clock: Clock;
  readonly random: RandomSource;
}): Promise<{ readonly messages: readonly ConversationMessage[]; readonly green: boolean }> {
  const { task, options, settings, evidence, ui, clock, random } = input;

  const routed = settings.modelPinned
    ? {
        modelSpec: null as string | null,
        assignment: "pinned" as const,
        decision: null,
        candidates: [] as readonly string[],
      }
    : await chooseModel(task, homedir(), random);
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
  process.on("SIGINT", onInterrupt);
  void ui.cancelled().then(onInterrupt);
  const startedAt = clock.now();
  const gateOptions = gateOptionsFrom(settings);
  const diffBudget = diffBudgetFrom(settings);

  try {
    const { loop, gates } = await runAgentTask({
      task,
      workspace: options.workspace,
      baseRef: input.baseRef,
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
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
    await logReward({
      evidence,
      home: homedir(),
      task,
      modelSpec: usable.modelSpec,
      assignment: routed.assignment,
      ratchet: summarizeRatchet(gates.outcome),
      changedFiles: gates.outcome.finalCycle.measures.changedFiles ?? null,
      latencyMs: clock.now() - startedAt,
      recordedAt: clock.now(),
      cost: await priceTask(usable.modelSpec, evidence),
      note: ui.note,
    });

    return {
      messages: loop.messages,
      green: loop.stopReason === "completed" && gates.outcome.settled === "green",
    };
  } finally {
    process.off("SIGINT", onInterrupt);
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

  const settings = await settingsFor(options.workspace, {
    model: options.modelSpec,
    maxSteps: options.maxSteps,
    attempts: options.attempts,
    localEndpoint: options.localEndpoint,
    interfaceFlags: options.interfaceFlags,
  });
  const random = createSystemRandom();
  const routed = settings.modelPinned
    ? {
        modelSpec: null as string | null,
        assignment: "pinned" as const,
        decision: null,
        candidates: [] as readonly string[],
      }
    : await chooseModel(options.task, homedir(), random);
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
  // Ink holds stdin in raw mode, so Ctrl-C arrives as a keystroke rather than as a signal.
  // Both routes reach the same abort, and neither is the one that leaves the view.
  void ui.cancelled().then(onInterrupt);
  const startedAt = clock.now();
  const gateOptions = gateOptionsFrom(settings);
  const diffBudget = diffBudgetFrom(settings);

  try {
    const { loop, gates } = await runAgentTask({
      task: options.task,
      workspace: options.workspace,
      baseRef: options.baseRef,
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
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
      ...(gateOptions === undefined ? {} : { gateOptions }),
      ...(diffBudget === undefined ? {} : { diffBudget }),
    });

    reportGates(gates.outcome, evidence, ui.note);

    // Every finished run is one more sample the router learns from, and the ratchet numerics
    // ride along so a pass earned by erosion cannot look like a win (section 3.8).
    await logReward({
      evidence,
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
    return exitCodeFor(loop.stopReason, gates.outcome.settled);
  } finally {
    await ui.stop();
    process.off("SIGINT", onInterrupt);
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
  readonly assignment: "calibration" | "ucb" | "epsilon" | "pinned";
  readonly ratchet: ReturnType<typeof summarizeRatchet>;
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

  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: { task: "gates", workspace: options.workspace, baseRef: options.baseRef },
  });

  const gateOptions = gateOptionsFrom(settings);
  const diffBudget = diffBudgetFrom(settings);
  const run = await runGatesEngine({
    workspaceRoot: options.workspace,
    baseRef: options.baseRef,
    evidence,
    fileSet,
    clock,
    emit: () => {},
    // No retries are offered, so none are spent: this command measures and reports.
    cap: 0,
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
  announceBundle((await writeBundle(evidence, options.bundleDirectory, clock)).directory);
  return run.outcome.firstCycle.blockingFailures.length === 0 ? 0 : 1;
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

  process.stdout.write(
    `calibrating ${runSet.length} model(s) over ${goldenSet.cases.length} case(s), ` +
      `${options.repeats} repeat(s) each\n`,
  );

  try {
    const result = await runCalibration({
      models: runSet,
      repeats: options.repeats,
      goldenSet,
      staticPick,
      deps: {
        evidence,
        clock,
        random,
        createModel: (modelSpec) => registry.create(parseModelSpec(modelSpec)),
        commands: createNodeCommandRunner(clock),
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
    return result.pick.model === null ? 1 : 0;
  } finally {
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
  const sandbox = createSandbox({
    workspaceRoot: probeRoot,
    homeDir: probeRoot,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [],
  });

  const canary = await runBackendCanary({
    modelSpec: local,
    model: registry.create(parseModelSpec(local)),
    tools: createWorkspaceTools(sandbox),
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
function exitCodeFor(stopReason: StopReason, settled: "green" | "escalated"): number {
  // 128 + SIGINT, which is what every shell reports for a process a person stopped.
  const cancelled = 130;
  return stopReason === "interrupted" ? cancelled : settled === "green" ? 0 : 1;
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
      ...(gateOptions === undefined ? {} : { gateOptions }),
      abortSignal: new AbortController().signal,
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
