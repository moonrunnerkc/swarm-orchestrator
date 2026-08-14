#!/usr/bin/env node
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { runAgentTask } from "./agent-run.ts";
import {
  type AddCaseCommand,
  type CalibrateCommand,
  type CommandLine,
  type GatesCommand,
  parseCommandLine,
  type ReplayCommand,
  type RunCommand,
  type SelectCommand,
} from "./cli-options.ts";
import type { Clock } from "./core/clock.ts";
import type { RandomSource } from "./core/random-source.ts";
import { bundleSourceFromRecorder, exportBundle } from "./evidence/bundle.ts";
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
import { runGatesEngine } from "./gates/engine.ts";
import { describeEscalation } from "./gates/escalation.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import { citedRecords, type GateCycle, outstandingJustifications } from "./gates/gate-runner.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
import { summarizeRatchet } from "./gates/ratchet-summary.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { runCalibration } from "./select/calibrate.ts";
import { parseCalibrationCase } from "./select/calibration-case.ts";
import { renderCalibrationReport } from "./select/calibration-report.ts";
import { appendCalibrationCase, defaultGoldenSetPath, readGoldenSet } from "./select/golden-set.ts";
import { probeHardware } from "./select/hardware-probe.ts";
import { createOllamaMemoryProbe } from "./select/memory-probe.ts";
import { defaultPickPath, readCalibrationPick, writeCalibrationPick } from "./select/pick-store.ts";
import { calibrationCandidates, recommendModel } from "./select/recommendation.ts";
import { buildRewardEntry } from "./select/reward.ts";
import { defaultRoutingLogPath, openRoutingLog } from "./select/routing-log.ts";
import { renderRoutingReport } from "./select/routing-report.ts";
import { renderSelectReport } from "./select/select-report.ts";
import { loadShortlist } from "./select/shortlist-source.ts";
import { systemProbeEnvironment } from "./select/system-probe.ts";
import { classifyTask } from "./select/task-class.ts";
import { routeModel } from "./select/ucb.ts";
import type { ConfirmationRequest } from "./tools/chokepoint.ts";
import { startSessionInterface } from "./tui/session-interface.ts";

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
): Promise<{ modelSpec: string | null; assignment: "calibration" | "ucb" | "epsilon" | "pinned" }> {
  const calibrated = await readCalibrationPick(defaultPickPath(home));
  if (calibrated?.model == null) {
    return { modelSpec: null, assignment: "pinned" };
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
  return { modelSpec: decision.model, assignment: decision.assignment };
}

async function run(options: RunCommand): Promise<number> {
  if (!statSync(options.workspace, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `workspace ${options.workspace} is not a directory. Create it, or pass --workspace.`,
    );
  }

  const random = createSystemRandom();
  const routed = options.modelPinned
    ? { modelSpec: null as string | null, assignment: "pinned" as const }
    : await chooseModel(options.task, homedir(), random);
  const modelSpec = routed.modelSpec ?? options.modelSpec;
  const spec = parseModelSpec(modelSpec);

  const clock = createSystemClock();
  const sessionRoot = defaultSessionRoot(homedir());
  const evidence = await openEvidenceSession({
    root: sessionRoot,
    sessionId: createSessionId(clock, random),
    clock,
  });

  const registry = createProviderRegistry({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    localBaseUrl: process.env.SWARM_LOCAL_BASE_URL,
  });
  const model = createRecordingModelClient(registry.create(spec), evidence);
  const fileSet = createFileSetRegistry(evidence);
  const isTty = process.stdout.isTTY === true && process.stdin.isTTY === true;

  const ui = startSessionInterface({
    task: options.task,
    isTty,
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });

  const interruption = new AbortController();
  const onInterrupt = () => {
    interruption.abort();
  };
  process.on("SIGINT", onInterrupt);
  const startedAt = clock.now();

  try {
    const { loop, gates } = await runAgentTask({
      task: options.task,
      workspace: options.workspace,
      baseRef: options.baseRef,
      maxSteps: options.maxSteps,
      attempts: options.attempts,
      model,
      evidence,
      fileSet,
      clock,
      random,
      emit: (event) => {
        ui.emit(event);
      },
      confirm: (request) => confirmOnTerminal(request, isTty),
      abortSignal: interruption.signal,
      homeDir: homedir(),
    });

    await ui.stop();
    reportGates(gates.outcome, evidence);

    // Every finished run is one more sample the router learns from, and the ratchet numerics
    // ride along so a pass earned by erosion cannot look like a win (section 3.8).
    await logReward({
      evidence,
      home: homedir(),
      task: options.task,
      modelSpec,
      assignment: routed.assignment,
      ratchet: summarizeRatchet(gates.outcome),
      latencyMs: clock.now() - startedAt,
      recordedAt: clock.now(),
    });

    const directory = await writeBundle(evidence, options.bundleDirectory, clock);
    announceBundle(directory);
    return loop.stopReason === "completed" && gates.outcome.settled === "green" ? 0 : 1;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

/** The only place a human is asked anything. A run with no terminal refuses and records it. */
async function confirmOnTerminal(request: ConfirmationRequest, isTty: boolean): Promise<boolean> {
  if (!isTty) {
    process.stderr.write(
      `[chokepoint] refusing ${request.toolName} without a terminal to confirm on: ${request.explanation}\n`,
    );
    return false;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(`${request.explanation}\n`);
    const answer = await prompt.question(`Run "${request.detail}"? [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    prompt.close();
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

function reportGates(outcome: AutoResolveOutcome, evidence: EvidenceRecorder): void {
  process.stdout.write(`\ngates:\n${describeCycle(outcome.finalCycle)}\n`);

  for (const attempt of outcome.attempts) {
    process.stdout.write(
      `attempt ${attempt.attempt}: ${attempt.decision.accepted ? "accepted" : "REJECTED"} - ` +
        `${attempt.decision.detail}\n`,
    );
  }

  for (const run of outstandingJustifications(outcome.finalCycle, citedRecords(evidence))) {
    process.stdout.write(
      `\nthe ${run.gateId} gate asked for a justification and no claim cites its record ` +
        `${run.record}. This does not block, and the bundle shows it unanswered.\n`,
    );
  }

  if (outcome.escalation !== null) {
    process.stderr.write(`\n${describeEscalation(outcome.escalation)}\n`);
  }
}

interface RewardLogInput {
  readonly evidence: EvidenceRecorder;
  readonly home: string;
  readonly task: string;
  readonly modelSpec: string;
  readonly assignment: "calibration" | "ucb" | "epsilon" | "pinned";
  readonly ratchet: ReturnType<typeof summarizeRatchet>;
  readonly latencyMs: number;
  readonly recordedAt: number;
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
    latencyMs: input.latencyMs,
    costUsd: 0,
  });

  await input.evidence.record({
    type: "reward",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { ...entry, taskClassRule: classification.rule },
  });

  try {
    const log = await openRoutingLog({ path: defaultRoutingLogPath(input.home) });
    await log.append(entry);
    process.stdout.write(`\nrouting reward: ${entry.reward.toFixed(3)} (${entry.rewardReason})\n`);
  } catch (cause) {
    process.stderr.write(
      `[routing] the reward could not be appended to the log: ${describeError(cause)}\n`,
    );
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function announceBundle(directory: string): void {
  process.stdout.write(`\nevidence bundle: ${directory}\n`);
  process.stdout.write(`verify it anywhere: node ${join(directory, "verify.mjs")} ${directory}\n`);
  process.stdout.write(`review it: open ${join(directory, "review.html")}\n`);
}

/** The gates on their own: no model, no retries, just what the workspace measures right now. */
async function gates(options: GatesCommand): Promise<number> {
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
  });

  process.stdout.write(
    `project: ${run.detection.types.join(", ") || "no manifest detected"}\n\n` +
      `${describeCycle(run.outcome.firstCycle)}\n`,
  );
  for (const gate of outstandingJustifications(run.outcome.firstCycle, citedRecords(evidence))) {
    process.stdout.write(`\nthe ${gate.gateId} gate asked for a justification: ${gate.detail}\n`);
  }
  announceBundle(await writeBundle(evidence, options.bundleDirectory, clock));
  return run.outcome.firstCycle.blockingFailures.length === 0 ? 0 : 1;
}

async function writeBundle(
  evidence: EvidenceRecorder,
  destination: string | null,
  clock: Clock,
): Promise<string> {
  const signing = await resolveSigningKey(createKeychainSecretStore({ platform: platform() }));
  if (signing.notice !== null) {
    process.stderr.write(`[signing] ${signing.notice}\n`);
  }
  const directory = destination ?? join(evidence.directory, "bundle");
  await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination: directory,
    signingKey: signing.key,
    clock,
  });
  return directory;
}

/** Roughly the build guide's five to ten minutes: four cases, three repeats, two models. */
const calibrationModelLimit = 2;

async function calibrate(options: CalibrateCommand): Promise<number> {
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

  const registry = createProviderRegistry({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    localBaseUrl: process.env.SWARM_LOCAL_BASE_URL,
  });
  // Outside the session store, which tools may never write to, and outside any workspace.
  const scratchRoot = await mkdtemp(join(tmpdir(), "swarm-calibration-"));

  process.stdout.write(
    `calibrating ${models.length} model(s) over ${goldenSet.cases.length} case(s), ` +
      `${options.repeats} repeat(s) each\n`,
  );

  try {
    const result = await runCalibration({
      models,
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
          baseUrl: process.env.SWARM_LOCAL_BASE_URL ?? "http://127.0.0.1:11434/v1",
          fetch: (url) => fetch(url, { signal: AbortSignal.timeout(2_000) }),
        }),
        scratchRoot,
        maxSteps: 12,
        abortSignal: new AbortController().signal,
      },
    });

    const directory = await writeBundle(evidence, options.bundleDirectory, clock);
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
      candidates: [...models],
      goldenSetVersion: result.goldenSetVersion,
      recordedAt: clock.now(),
    });
    return result.pick.model === null ? 1 : 0;
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
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
    env: process.env,
    currentDirectory: process.cwd(),
  });
  if (options.command === "replay") {
    return replay(options);
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
