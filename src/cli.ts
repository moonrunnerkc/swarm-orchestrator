#!/usr/bin/env node
// Check the runtime before loading the command composition.
import "./node-floor-check.ts";

import { spawn } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { runAgentTask } from "./agent-run.ts";
import { announceBundle, summarizeEvidence, writeBundle } from "./cli-bundle.ts";
import { offerInit } from "./cli-init.ts";
import { resolveLocalBackend } from "./cli-local-backend.ts";
import { preflightAll } from "./cli-model-preflight.ts";
import {
  type CommandLine,
  type DoctorCommand,
  type GatesCommand,
  type GcCommand,
  parseCommandLine,
  type ReplayCommand,
  type ReviewCommand,
  type RunCommand,
  usage,
  type VerifyCommand,
} from "./cli-options.ts";
import {
  abortRun,
  inspectRun,
  listRuns,
  repairRun,
  resumeRun,
  retryStep,
  runStorePath,
} from "./cli-run-commands.ts";
import { describeCycle, reportBonds, reportGates } from "./cli-run-report.ts";
import {
  diffBudgetFrom,
  gateOptionsFrom,
  noFlagSettings,
  registrySettingsFrom,
  settingsFor,
} from "./cli-run-settings.ts";
import { createSystemClock, createSystemRandom } from "./cli-runtime-inputs.ts";
import { chooseModel, select } from "./cli-select.ts";
import { logReward, priceTask } from "./cli-task-cost.ts";
import { startInterface } from "./cli-terminal.ts";
import type { StopReason } from "./core/termination.ts";
import { readBundle } from "./evidence/bundle.ts";
import { buildEvidenceDag } from "./evidence/dag.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { replayBundle } from "./evidence/replay.ts";
import { collectSessions, describeCollection, olderThanMs } from "./evidence/retention.ts";
import { recordRunAssessment } from "./evidence/run-assessment.ts";
import { createSessionId, defaultSessionRoot, openEvidenceSession } from "./evidence/session.ts";
import { describeVerdict } from "./evidence/verdict.ts";
import { verifyBundleAt } from "./evidence/verify-report.ts";
import { hostExecutionBackend, selfTestContainment } from "./exec/execution-mode.ts";
import { parseIsolationOption } from "./exec/isolation-option.ts";
import { createRunCancellation } from "./exec/run-cancellation.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import { defaultDiffBudget, runGatesEngine, sealAssembledCriteria } from "./gates/engine.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import { citedRecords, outstandingJustifications } from "./gates/gate-runner.ts";
import { resolveBaseCommit } from "./gates/git-workspace.ts";
import { summarizeRatchet } from "./gates/ratchet-summary.ts";
import { diagnose, remediesFor, runtimeFinding } from "./install/health.ts";
import { inspectInstall } from "./install/inspect.ts";
import { describeInstall } from "./install/report.ts";
import { exitCodes, jsonEventLine, jsonResultLine } from "./machine-output.ts";
import { localEndpointRecord } from "./providers/endpoint-resolution.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { chooseUsableModel } from "./select/model-fallback.ts";
import { defaultRoutingLogPath, openRoutingLog } from "./select/routing-log.ts";
import { routingDecisionRecord } from "./select/routing-record.ts";
import { renderRoutingReport } from "./select/routing-report.ts";
import { createTelemetry, jsonLinesSink, type Telemetry } from "./telemetry/otel.ts";
import { describeEvidence } from "./tui/evidence-panel.ts";

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

/**
 * A patch, verified where nothing that produced it can reach. Every gate a run executes runs in
 * the workspace the run was editing, with the tests the run may have changed, reading reports
 * the run's own processes wrote. This is the separate opinion: a fresh checkout of the base, the
 * patch applied there, the checks run there, and nothing from the producer travelling except the
 * patch itself.
 */
/**
 * Spans go where SWARM_OTEL_FILE names, and nowhere otherwise. Payload capture is a second
 * decision on top of that, because tool arguments are where the credentials are and a telemetry
 * pipeline is exactly the place one ends up somewhere nobody scrubs.
 */
function createRunTelemetry(runId: string): Telemetry {
  const destination = process.env.SWARM_OTEL_FILE;
  if (destination === undefined || destination.length === 0) {
    return { observe: () => {} };
  }
  return createTelemetry({
    enabled: true,
    runId,
    capturePayloads: process.env.SWARM_OTEL_PAYLOADS === "1",
    sink: jsonLinesSink((line) => {
      try {
        appendFileSync(destination, line, { mode: 0o600 });
      } catch {
        // A collector that cannot be written to is not a reason to stop the run.
      }
    }),
  });
}

async function replay(options: ReplayCommand): Promise<number> {
  for (const line of await replayBundle(options.bundleDirectory)) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}

/** Long enough for a cold CDN, short enough that the bundled snapshot takes over quickly. */

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
  const report = [...findings, runtimeFinding(process.version)];
  for (const line of describeInstall(report, remedies.length > 0 && !options.fix)) {
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
  if (options.recovery !== undefined)
    await evidence.record({
      type: "session-started",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { task: options.task, continuation: options.recovery.source },
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
    process.stderr.write(
      `model: ${usable.modelSpec} instead of ${usable.requested}, ${usable.reason}\n`,
    );
  }
  const runSpec = parseModelSpec(usable.modelSpec);

  const registry = createProviderRegistry(registrySettingsFrom(settings, localBackend));
  const model = createRecordingModelClient(registry.create(runSpec), evidence, {
    transcript: "components",
  });
  const fileSet = createFileSetRegistry(evidence);

  const ui = await startInterface({
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
  // Off unless a destination is named. A telemetry pipeline that is on by default is a place
  // secrets end up somewhere nobody scrubs, and payload capture stays a second decision on top.
  const telemetry = createRunTelemetry(evidence.sessionId);

  let exporting = false;
  try {
    const { loop, gates, green, verdict } = await runAgentTask({
      task: options.task,
      ...(options.recovery === undefined
        ? options.maxTokens === undefined
          ? {}
          : { maxTokens: options.maxTokens }
        : {
            history: options.recovery.history,
            maxTokens: options.recovery.remainingTokens,
            previousSpec: options.recovery.previousSpec,
            previousCriteria: options.recovery.previousCriteria,
          }),
      workspace: options.workspace,
      runStorePath: runStorePath(),
      ...(isolation === null ? {} : { isolation: recordedContainerBackend(isolation, evidence) }),
      baseRef: await resolveBaseCommit(options.workspace, options.baseRef),
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
      ...(options.recovery !== undefined
        ? { maxWallTimeMs: Math.max(0, options.recovery.deadline - clock.now()) }
        : settings.maxWallMinutes === null
          ? {}
          : { maxWallTimeMs: settings.maxWallMinutes * 60_000 }),
      model,
      evidence,
      fileSet,
      clock,
      random,
      emit: (event) => {
        ui.emit(event);
        telemetry.observe(event);
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

    // The run's own verdict rather than a second reading of the gate strip: recomputing it
    // here from `settled` alone let the two disagree, and they did. A run wrote three files
    // into a workspace whose only command gate found no tests to run, so nothing measured the
    // change, `green` said so, and the exit code said 0 because no gate had actually failed.
    exporting = true;
    const written = await writeBundle(evidence, options.bundleDirectory, clock, ui.note, {
      verdict: { ...verdict },
      executionMode: verdict.executionTrust,
    });
    announceBundle(written.directory, ui.note);
    await ui.presentEvidence(await summarizeEvidence(written));
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
  } catch (cause) {
    if (!exporting) {
      try {
        const captured = await writeBundle(evidence, options.bundleDirectory, clock, (line) =>
          process.stderr.write(`${line}\n`),
        );
        process.stderr.write(`execution failed; captured evidence: ${captured.directory}\n`);
      } catch (exportFailure) {
        process.stderr.write(
          `failure evidence could not be exported: ${describeError(exportFailure)}; session: ${evidence.directory}\n`,
        );
      }
    }
    throw cause;
  } finally {
    await ui.stop();
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The gates on their own: no model, no retries, just what the workspace measures right now. */
async function gates(options: GatesCommand): Promise<number> {
  const stopping = createRunCancellation({ clock: createSystemClock(), wallBudgetMs: null });
  const interrupt = () => stopping.cancel("interrupted");
  const terminate = () => stopping.cancel("terminated");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await gatesUnderCancellation(options, stopping.signal);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    stopping.dispose();
  }
}

async function gatesUnderCancellation(options: GatesCommand, signal: AbortSignal): Promise<number> {
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

  const requestedBackend = parseIsolationOption(options.isolation ?? null, options.workspace);
  const backend =
    requestedBackend === null
      ? hostExecutionBackend
      : recordedContainerBackend(requestedBackend, evidence);
  const canary = join(evidence.directory, "containment-canary");
  await writeFile(canary, "synthetic containment control");
  const envelope = await selfTestContainment(backend, {
    workspaceRoot: options.workspace,
    hostFileOutsideWorkspace: canary,
  });
  await evidence.record({
    type: "execution-envelope",
    actor: "harness",
    provenance: ["tool-output"],
    payload: JSON.parse(JSON.stringify(envelope)),
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
    abortSignal: signal,
    ...(requestedBackend === null ? {} : { isolation: backend }),
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
  const verdict = await recordRunAssessment(
    evidence,
    run,
    signal.aborted ? "interrupted" : "completed",
    envelope.mode,
    signal.aborted,
  );
  process.stdout.write(`\n${describeVerdict(verdict).join("\n")}\n`);

  announceBundle((await writeBundle(evidence, options.bundleDirectory, clock)).directory);
  return verdict.acceptable ? 0 : 1;
}

/** How long a local backend gets to say what it serves before the answer stops being worth waiting for. */

/**
 * A tasks file is one task per line, or a JSON task graph. Both reach the same run: what a
 * person hand-writes and what a planner declares are the same artifact, so the scheduler and
 * the outcome claim do not care which happened, and the record says which it was.
 */
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
  if (options.command === "version") {
    process.stdout.write(`${await runningVersion(resolve(import.meta.dirname, ".."))}\n`);
    return 0;
  }
  if (options.command === "verify") {
    return verifyBundle(options);
  }
  if (options.command === "gc") {
    return collectGarbage(options);
  }
  if (options.command === "ci") {
    return (await import("./cli-ci.ts")).verifyPatch(options);
  }
  if (options.command === "list-runs") {
    return listRuns();
  }
  if (options.command === "inspect") {
    return inspectRun(options);
  }
  if (options.command === "resume") {
    return resumeRun(options, resumeExecution);
  }
  if (options.command === "retry-step") {
    return retryStep(options, resumeExecution);
  }
  if (options.command === "abort") {
    return abortRun(options);
  }
  if (options.command === "repair") {
    return repairRun(options);
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
    return (await import("./cli-calibrate.ts")).calibrate(options);
  }
  if (options.command === "add-case") {
    return (await import("./cli-calibrate.ts")).addCase(options);
  }
  if (options.command === "routing") {
    return routing();
  }
  if (options.command === "parallel") {
    return (await import("./cli-parallel.ts")).parallel(options);
  }
  if (options.command === "doctor") {
    return doctor(options);
  }
  if (options.command === "session") {
    return (await import("./cli-session.ts")).session(options);
  }
  if (options.command === "init") {
    return (await import("./cli-init.ts")).init(options);
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

async function resumeExecution(
  context: Awaited<ReturnType<typeof import("./durable/recovery-context.ts").recoveryContext>>,
): Promise<number> {
  const parsed = parseCommandLine(
    [
      "--workspace",
      context.spec.repository.root,
      "--base",
      context.spec.repository.baseCommit,
      "--model",
      context.spec.model.spec,
      "--isolation",
      context.spec.isolation.backend === "host" ? "none" : context.spec.isolation.backend,
      ...(context.spec.taskOracle === null ? [] : ["--oracle", context.spec.taskOracle.command]),
      "--attempts",
      String(context.remainingAttempts),
      "--max-steps",
      String(context.remainingSteps),
      "--max-wall-minutes",
      String(Math.max(1, Math.floor(context.spec.budgets.maxWallMs / 60_000))),
      context.spec.task,
    ],
    { currentDirectory: process.cwd() },
  );
  if (parsed.command !== "run")
    throw new Error("recovery could not construct the original run command");
  return run({
    ...parsed,
    recovery: {
      history: context.history,
      remainingTokens: context.remainingTokens,
      remainingWallMs: context.remainingWallMs,
      deadline: context.deadline,
      previousSpec: context.spec,
      previousCriteria: context.criteria,
      source: context.source,
    },
  });
}
