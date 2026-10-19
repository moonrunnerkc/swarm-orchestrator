#!/usr/bin/env node
// Check the runtime before loading the command composition.
import "./node-floor-check.ts";

import { execFile, spawn } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { runAgentTask } from "./agent-run.ts";
import { describeRunningVersion } from "./build-version.ts";
import { announceBundle, writeBundle } from "./cli-bundle.ts";
import { summarizeEvidence } from "./cli-evidence-summary.ts";
import { gates } from "./cli-gates.ts";
import {
  approvalOfferOnDisk,
  NoManifestError,
  offerApprovalMode,
  offerInit,
  offerNodeHarness,
} from "./cli-init.ts";
import { resolveLocalBackend } from "./cli-local-backend.ts";
import { defaultModelFor, NoDefaultModelError } from "./cli-model-default.ts";
import { preflightAll } from "./cli-model-preflight.ts";
import {
  type CommandLine,
  type DoctorCommand,
  type GcCommand,
  InvalidCommandLineError,
  parseCommandLine,
  type ReplayCommand,
  type ReviewCommand,
  type RunCommand,
  usage,
} from "./cli-options.ts";
import { type PlanChecksOutcome, planChecks } from "./cli-plan-checks.ts";
import { admitPlannedChecks, describeCheckoutPreparation } from "./cli-planned-checks.ts";
import { describePreflight, manifestsIn } from "./cli-preflight.ts";
import { registrySettingsFrom } from "./cli-provider-settings.ts";
import {
  abortRun,
  inspectRun,
  listRuns,
  repairRun,
  resumeRun,
  retryStep,
  runStorePath,
} from "./cli-run-commands.ts";
import {
  changedFilesOf,
  describeRunOutcome,
  exitCodeForStatus,
  interventionsOn,
  type OutcomeStatus,
  outcomeStatus,
  type RunOutcomeInput,
  repairsForGeneratedChecksOnly,
  requirementOutcomes,
} from "./cli-run-outcome.ts";
import { reportGates } from "./cli-run-report.ts";
import {
  diffBudgetFrom,
  gateOptionsFrom,
  settingsFor,
  verificationReserve,
} from "./cli-run-settings.ts";
import { createSystemClock, createSystemRandom } from "./cli-runtime-inputs.ts";
import { chooseModel, select } from "./cli-select.ts";
import {
  remainingTokenBudget,
  strengthenAndRepair,
  strengtheningLimits,
  tokensSpent,
} from "./cli-strengthen.ts";
import {
  assertPresetSelection,
  presetTaskContract,
  readGoalContractFile,
} from "./cli-task-contract.ts";
import { logReward, priceTask } from "./cli-task-cost.ts";
import {
  acceptanceCheckTool,
  baseVerifier,
  describeGoalPreflight,
  finalizeTaskGoal,
  preflightTaskGoal,
  probeVerifier,
  taskGoalGates,
  verifyCandidateUnder,
} from "./cli-task-goal.ts";
import { askOnTerminal, startInterface } from "./cli-terminal.ts";
import { verifyBundle } from "./cli-verify.ts";
import type { LoopEvent } from "./core/loop-events.ts";
import type { StopReason } from "./core/termination.ts";
import { readBundle } from "./evidence/bundle.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import { buildEvidenceDag } from "./evidence/dag.ts";
import {
  declareGoalContract,
  freezeGoalContract,
  type GoalContract,
} from "./evidence/goal-contract.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { replayBundle } from "./evidence/replay.ts";
import { collectSessions, describeCollection, olderThanMs } from "./evidence/retention.ts";
import {
  createSessionId,
  defaultSessionRoot,
  type EvidenceRecorder,
  openEvidenceSession,
} from "./evidence/session.ts";
import type { RunVerdict } from "./evidence/verdict.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import {
  collectChildHomes,
  establishRunChildHome,
  releaseRunChildHome,
} from "./exec/child-home.ts";
import { parseIsolationOption } from "./exec/isolation-option.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import { defaultDiffBudget } from "./gates/engine.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import { requireBaseCommit } from "./gates/git-workspace.ts";
import { summarizeRatchet } from "./gates/ratchet-summary.ts";
import { diagnose, remediesFor, runtimeFinding } from "./install/health.ts";
import { inspectInstall } from "./install/inspect.ts";
import { describeInstall } from "./install/report.ts";
import { exitCodes, jsonEventLine, jsonResultLine, type MachineResult } from "./machine-output.ts";
import { localEndpointRecord } from "./providers/endpoint-resolution.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { chooseUsableModel } from "./select/model-fallback.ts";
import { defaultRoutingLogPath, openRoutingLog } from "./select/routing-log.ts";
import { routingDecisionRecord } from "./select/routing-record.ts";
import { renderRoutingReport } from "./select/routing-report.ts";
import { createTelemetry, jsonLinesSink, type Telemetry } from "./telemetry/otel.ts";
import { describeEvidence } from "./tui/evidence-panel.ts";
import { glyphsFor } from "./tui/glyphs.ts";

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
  // Private child homes nobody holds: a run killed before it could release its own, or one
  // kept for a resumption that never came. The same window and the same ask-first rule.
  const homes = collectChildHomes({
    olderThan: olderThanMs(options.olderThan),
    now: Date.now(),
    remove: options.remove,
  });
  if (homes.length > 0)
    process.stdout.write(
      `${options.remove ? "removed" : "would remove"} ${homes.length} unheld child home(s): ${homes
        .slice(0, 8)
        .map((home) => home.runId)
        .join(", ")}${homes.length > 8 ? ", ..." : ""}\n`,
    );
  return exitCodes.acceptable;
}

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
    if (typeof version !== "string") return "unknown";
    let describe: string | null = null;
    try {
      const source: unknown = JSON.parse(
        await readFile(join(import.meta.dirname, "source.json"), "utf8"),
      );
      const recorded = (source as { readonly describe?: unknown } | null)?.describe;
      describe = typeof recorded === "string" ? recorded : null;
    } catch {
      // Run from source, or built before builds recorded their commit: the manifest's version is all there is.
    }
    return describeRunningVersion(version, describe);
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

  // Before the session opens and before the model is asked for anything: a run that discovers
  // it has no base commit after the model has edited files has spent the interesting part of
  // its budget finding out.
  let baseCommit = await requireBaseCommit(options.workspace, options.baseRef);
  // A repository with no manifest cannot be measured, and the criteria are sealed from the
  // base before the model runs, so the harness is added and committed first or the run stops.
  if (await offerNodeHarness(options.workspace)) {
    baseCommit = await requireBaseCommit(options.workspace, options.baseRef);
  }

  await offerInit(options.workspace);
  await offerApprovalMode(approvalOfferOnDisk(options.workspace));
  let sealedGoal =
    options.recovery?.goal?.contract ??
    (options.goalContract === undefined
      ? undefined
      : await readGoalContractFile(options.goalContract));
  if (sealedGoal !== undefined) assertPresetSelection(options.preset, sealedGoal);
  const settings = await settingsFor(options.workspace, {
    model: options.modelSpec,
    maxSteps: options.maxSteps,
    attempts: options.attempts,
    maxWallMinutes: options.maxWallMinutes,
    localEndpoint: options.localEndpoint,
    interfaceFlags: options.interfaceFlags,
    approval: options.approval,
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
  // Nothing pinned and nothing calibrated: the run picks from what a local backend serves,
  // says so before the session opens, and records the choice once it has (ADR 0011).
  const chosen =
    settings.modelPinned || routed.modelSpec !== null ? null : await defaultModelFor(settings);
  const modelSpec = chosen?.modelSpec ?? routed.modelSpec ?? settings.modelSpec;
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
  // One HOME for every child of this run: the loop's shells, the gates, each repair attempt
  // and the final independent verification. A resumption takes the original run's home back,
  // validated as that run's, however many sessions lie between; a finished run removes it; an
  // interrupted one keeps it to resume.
  const childHome = establishRunChildHome({
    runId: evidence.sessionId,
    ...(options.recovery === undefined ? {} : { resumeOf: options.recovery.childHomeOwner }),
  });
  let keepChildHome = true;
  if (options.recovery !== undefined)
    await evidence.record({
      type: "session-started",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        task: options.task,
        continuation: options.recovery.source,
        childHomeOwner: options.recovery.childHomeOwner,
        // Named with the scrubber's metric names: the allowance this continuation runs under,
        // and what cancelled calls with no reported usage were charged against the sealed budget.
        maxTokens: options.recovery.remainingTokens,
        chargedForCancelledCalls: {
          calls: options.recovery.chargedForCancelledCalls.calls,
          reservedTokens: options.recovery.chargedForCancelledCalls.tokens,
        },
      },
    });
  if (localBackend !== null) {
    await evidence.record(localEndpointRecord(localBackend));
  }
  if (chosen !== null) {
    await evidence.record({
      type: "model-default",
      actor: "harness",
      provenance: ["tool-output"],
      payload: chosen.record,
    });
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
  const runSpec = parseModelSpec(usable.modelSpec);

  // The card stays on the scrollback above the screen, so what the run settled before the
  // model was asked for anything can still be read once the screen has come down.
  const modelReason =
    usable.outcome === "substituted"
      ? `instead of ${usable.requested}: ${usable.reason}`
      : chosen !== null
        ? `${chosen.reason}; pass --model to choose another`
        : routed.modelSpec !== null
          ? "routed by calibration"
          : "pinned";
  for (const line of describePreflight({
    workspace: options.workspace,
    home: homedir(),
    baseCommit,
    manifests: await manifestsIn(options.workspace),
    model: { spec: usable.modelSpec, reason: modelReason },
    approval: settings.approval,
    glyphs: glyphsFor(process.env),
  })) {
    process.stderr.write(`${line}\n`);
  }

  const registry = createProviderRegistry(registrySettingsFrom(settings, localBackend));
  const model = createRecordingModelClient(registry.create(runSpec), evidence, {
    transcript: "components",
  });
  const fileSet = createFileSetRegistry(evidence);
  // The earlier session's authorization, carried onto this chain before any edit: without it
  // the continuation's first write is refused for want of a declaration the run already made.
  if (options.recovery !== undefined && options.recovery.declaredFiles.length > 0)
    await fileSet.declare(
      options.recovery.declaredFiles,
      `continuation of ${options.recovery.source.sessionId}`,
    );
  const interruption = new AbortController();
  // One total allowance from the run's start: planning, the loop, repair and strengthening are
  // model work and end a reserve before the deadline; the final verification of the tree they
  // produced runs in that reserve and ends at the deadline itself. Model work ending does not cut
  // the checks: a run whose loop ran to its wall had its final build, lint and tests refused
  // (C1), and earlier a run's verification git commands were cancelled and it printed no result.
  const modelWork = new AbortController();
  interruption.signal.addEventListener("abort", () => modelWork.abort(interruption.signal.reason), {
    once: true,
  });
  // The clock starts before planning: criteria authoring is part of what the task costs.
  const startedAt = clock.now();
  const allowance = options.recovery?.remainingTokens ?? options.maxTokens ?? defaultTaskTokens;

  // Criteria authored before the screen goes up, because the planner's questions and the
  // person's answer go through the terminal, which the screen then owns. The planner reads
  // the workspace with read-only tools on a chain of its own; what it pins is sealed on this
  // chain below exactly as a supplied contract is, and stays labelled model-authored.
  let planning: PlanChecksOutcome | null = null;
  if (options.planChecks === true && options.recovery === undefined) {
    const interactive =
      !options.json && process.stdout.isTTY === true && process.stdin.isTTY === true;
    const supplied = sealedGoal;
    planning = await planChecks({
      ...(supplied === undefined ? {} : { base: supplied }),
      preparation: await describeCheckoutPreparation({
        workspace: options.workspace,
        baseCommit,
        install: options.installDependencies === true,
        ...(options.lockfile === undefined ? {} : { lockfile: options.lockfile }),
        gateOptions: {
          ...(options.lockfile === undefined ? {} : { lockfile: options.lockfile }),
          ...(Object.keys(settings.gateCommandOverrides).length === 0
            ? {}
            : { commandOverrides: settings.gateCommandOverrides }),
        },
      }),
      // Each planned check is run once on a fresh checkout of the base, on the planning chain,
      // and admitted only where it does there what it says it does.
      admit: (chain, contract, base, admitting) =>
        admitPlannedChecks({
          task: options.task,
          contract,
          base,
          evidence: chain,
          ...(admitting?.reclassified === undefined
            ? {}
            : { reclassified: admitting.reclassified }),
          verifyAtBase: (probe) =>
            baseVerifier({
              contract: probe,
              workspace: options.workspace,
              baseCommit,
              evidence: chain,
              clock,
              signal: modelWork.signal,
              isolation,
              install: options.installDependencies === true,
              ...(options.lockfile === undefined ? {} : { lockfile: options.lockfile }),
              ...(Object.keys(settings.gateCommandOverrides).length === 0
                ? {}
                : { commandOverrides: settings.gateCommandOverrides }),
            })(probe),
        }),
      task: options.task,
      workspace: options.workspace,
      home: homedir(),
      sessionRoot,
      runId: evidence.sessionId,
      createModel: (chain) =>
        createRecordingModelClient(registry.create(runSpec), chain, { transcript: "components" }),
      clock,
      random,
      maxSteps: settings.maxSteps,
      // Planning is bounded to a share of the run, so a planner that cannot settle leaves the
      // implementation, its repairs and the final verification the rest: one that spent 314 of
      // a launch's 540 seconds and 938,575 tokens without pinning a check left nothing usable.
      maxTokens: Math.floor(allowance * planningShare),
      maxWallMs: Math.floor((settings.maxWallMinutes ?? 30) * 60_000 * planningShare),
      signal: modelWork.signal,
      note: (line) => process.stderr.write(`${line}\n`),
      // On the machine stream like the implementation's own events, so a consumer that sums the
      // stopped events counts planning: a launcher that did not was short 341,256 tokens.
      ...(options.json
        ? {
            emit: (event: LoopEvent) =>
              process.stdout.write(`${jsonEventLine(event, { runId: evidence.sessionId })}\n`),
          }
        : {}),
      ...(interactive ? { ask: askOnTerminal } : {}),
    });
    await evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["user", "model"],
      payload: {
        rule: "plan-checks-v1",
        outcome: planning.kind,
        planningSession: planning.planningSessionId,
        tokensUsed: planning.tokensUsed,
        durationMs: planning.durationMs,
        steps: planning.steps,
        admission: planning.admission === null ? null : asJsonValue(planning.admission),
        ...(planning.kind === "sealed"
          ? {
              contractDigest: freezeGoalContract(planning.contract).digest,
              confirmedBy: planning.confirmedBy,
              tasksProposed: planning.tasksProposed,
            }
          : {}),
        ...(planning.kind === "unresolved"
          ? { stopReason: planning.stopReason, account: planning.account }
          : {}),
      },
    });
    // With a supplied contract, planning only adds to it: a planner that adds nothing leaves the
    // contract the user wrote, and the run goes on against it rather than ending unrun.
    if (planning.kind === "unresolved" && supplied !== undefined)
      process.stderr.write(
        `no planned check was added (the planner stopped as ${planning.stopReason}); implementing against the supplied contract\n`,
      );
    else if (planning.kind !== "sealed") {
      const written = await writeBundle(evidence, options.bundleDirectory, clock, (line) =>
        process.stderr.write(`${line}\n`),
      );
      const why =
        planning.kind === "declined"
          ? "criteria declined; nothing was implemented and no model call was spent on implementation."
          : `no criteria could be sealed for this task (the planner stopped as ${planning.stopReason})` +
            (planning.account.length === 0
              ? "."
              : `. It said:\n${planning.account}\n` +
                "Answer that in the task text, or pass --goal-contract with the criteria written out.");
      process.stderr.write(
        `${why}\nplanning used ${planning.tokensUsed} tokens in ${Math.round(planning.durationMs / 1000)}s; evidence: ${written.directory}\n`,
      );
      if (options.json)
        process.stdout.write(
          `${jsonResultLine({
            runId: evidence.sessionId,
            verdict: null,
            bundleDirectory: written.directory,
            exitCode: planning.kind === "declined" ? exitCodes.cancelled : exitCodes.unavailable,
            planning: {
              outcome: planning.kind,
              tokensUsed: planning.tokensUsed,
              durationMs: planning.durationMs,
            },
          })}\n`,
        );
      releaseRunChildHome(childHome, { keep: false });
      return planning.kind === "declined" ? exitCodes.cancelled : exitCodes.unavailable;
    }
    if (planning.kind === "sealed") sealedGoal = planning.contract;
    if (planning.kind === "sealed" && planning.tasksProposed > 1)
      process.stderr.write(
        `the planner would split this into ${planning.tasksProposed} tasks; this run does it as one. swarm parallel --goal runs them as separate workers.\n`,
      );
  }
  const implementationTokens = Math.max(0, allowance - (planning?.tokensUsed ?? 0));

  const ui = await startInterface({
    task: options.task,
    workspace: options.workspace,
    settings,
    clock,
  });

  const onInterrupt = () => {
    interruption.abort("the run was cancelled from the keyboard");
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  // Ink holds stdin in raw mode, so Ctrl-C arrives as a keystroke rather than as a signal.
  // Both routes reach the same abort, and neither is the one that leaves the view.
  void ui.cancelled().then(onInterrupt);
  const deadline =
    options.recovery?.deadline ??
    (sealedGoal === undefined && settings.maxWallMinutes === null
      ? null
      : startedAt + (settings.maxWallMinutes ?? 30) * 60_000);
  // What stops a check: the person's cancellation, or the end of the whole allowance.
  const allowanceEnd = new AbortController();
  const allowanceTimer =
    deadline === null
      ? null
      : setTimeout(
          () =>
            allowanceEnd.abort(
              "the run's total allowance ended before final verification finished",
            ),
          Math.max(0, deadline - clock.now()),
        );
  const verifying = AbortSignal.any([interruption.signal, allowanceEnd.signal]);
  // Armed once the reserve is known, after the preflight has measured what verification costs.
  let modelWorkTimer: ReturnType<typeof setTimeout> | null = null;
  let reserveMs = 0;
  const lockfile = options.recovery?.goal?.lockfile ?? options.lockfile;
  const goalContext =
    sealedGoal === undefined
      ? undefined
      : {
          contract: sealedGoal,
          workspace: options.workspace,
          baseCommit,
          evidence,
          clock,
          signal: verifying,
          isolation,
          install: options.recovery?.goal?.install ?? options.installDependencies === true,
          ...(lockfile === undefined ? {} : { lockfile }),
          // The same gate commands the run's own gates are assembled from, so the independent
          // verification judges by the gates the run sealed rather than by the checkout's manifest.
          ...(Object.keys(settings.gateCommandOverrides).length === 0
            ? {}
            : { commandOverrides: settings.gateCommandOverrides }),
          challengePolicy: options.challenges ?? ("off" as const),
        };
  const gateOptions = {
    ...gateOptionsFrom(settings),
    ...(lockfile === undefined ? {} : { lockfile }),
    ...(sealedGoal?.preset?.kind === "upgrade"
      ? {
          authorizedInstrumentPaths: [sealedGoal.preset.manifest, sealedGoal.preset.lockfile],
        }
      : {}),
    ...(goalContext === undefined ? {} : goalGateOptions(goalContext)),
  };
  // An authorized upgrade regenerates its lockfile, and that file's size is not authored work:
  // its lines are counted apart. The final verification still holds the change to the sealed
  // dependency targets, and every other file, the manifest included, stays on the budget.
  const configuredBudget = diffBudgetFrom(settings);
  const diffBudget =
    sealedGoal?.preset?.kind === "upgrade"
      ? {
          ...(configuredBudget ?? defaultDiffBudget),
          generatedPaths: [sealedGoal.preset.lockfile],
        }
      : configuredBudget;
  // Off unless a destination is named. A telemetry pipeline that is on by default is a place
  // secrets end up somewhere nobody scrubs, and payload capture stays a second decision on top.
  const telemetry = createRunTelemetry(evidence.sessionId);

  let exporting = false;
  try {
    if (sealedGoal !== undefined) {
      await declareGoalContract(evidence, sealedGoal);
      await evidence.record({
        type: "verification-command",
        actor: "harness",
        provenance: ["user"],
        payload: {
          rule: "goal-run-settings-v1",
          contractDigest: freezeGoalContract(sealedGoal).digest,
          install: goalContext?.install ?? false,
          ...(lockfile === undefined ? {} : { lockfile }),
          deadline,
          sourceBase: baseCommit,
        },
      });
    }
    const preflightStarted = clock.now();
    if (goalContext !== undefined) {
      await preflightTaskGoal(goalContext);
      for (const line of describeGoalPreflight(evidence)) ui.note(line);
    }
    if (deadline !== null) {
      const reserve = verificationReserve(
        (settings.maxWallMinutes ?? 30) * 60_000,
        goalContext === undefined ? null : clock.now() - preflightStarted,
      );
      reserveMs = reserve.reserveMs;
      await evidence.record({
        type: "session-budget",
        actor: "harness",
        provenance: ["tool-output"],
        payload: {
          rule: "verification-reserve-v1",
          ...reserve,
          deadline,
          modelWorkEnds: deadline - reserveMs,
          note: "the share of the total allowance held for the final gate cycle, acceptance and the final independent verification; model work ends at modelWorkEnds and the checks at the deadline, where any still running are stopped and reported as not run",
        },
      });
      modelWorkTimer = setTimeout(
        () =>
          modelWork.abort(
            "the model-work allowance is spent; the rest is held for final verification",
          ),
        Math.max(0, deadline - reserveMs - clock.now()),
      );
    }
    if (goalContext !== undefined && deadline !== null && deadline - clock.now() <= reserveMs)
      throw new Error(
        "preset preflight exhausted implementation allowance; final verification time stays reserved",
      );
    const implementation = (
      goal: typeof sealedGoal,
      repairFeedback?: string,
    ): Parameters<typeof runAgentTask>[0] => ({
      task: options.task,
      ...(options.promptProfile === undefined ? {} : { promptProfile: options.promptProfile }),
      ...(repairFeedback === undefined ? {} : { repairFeedback }),
      ...(options.escalationModel === undefined
        ? {}
        : {
            escalation: {
              settings: {
                target: options.escalationModel,
                trigger: "repeated-failure" as const,
                maximum: 1 as const,
                reservedTokens: 4096,
                reserveMs: 30000,
              },
              target: createRecordingModelClient(
                registry.create(parseModelSpec(options.escalationModel)),
                evidence,
                { transcript: "components" },
              ),
              previousCount: options.recovery?.escalationCount ?? 0,
            },
          }),
      ...(options.recovery === undefined
        ? options.maxTokens === undefined && planning === null
          ? {}
          : { maxTokens: implementationTokens }
        : {
            history: options.recovery.history,
            maxTokens: options.recovery.remainingTokens,
            previousSpec: options.recovery.previousSpec,
            previousCriteria: options.recovery.previousCriteria,
          }),
      ...(goal === undefined
        ? {}
        : {
            contract: presetTaskContract({
              goal,
              task: options.task,
              uncovered: planning?.admission?.uncovered ?? [],
              ...(options.recovery === undefined
                ? {}
                : { originalObjective: options.recovery.previousSpec.task }),
              maxSteps: settings.maxSteps,
              maxWallMs: (settings.maxWallMinutes ?? 30) * 60000,
              network: isolation === null ? "unrestricted" : "denied",
            }),
          }),
      workspace: options.workspace,
      runStorePath: runStorePath(),
      ...(isolation === null ? {} : { isolation: recordedContainerBackend(isolation, evidence) }),
      baseRef: baseCommit,
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
      ...(deadline === null
        ? {}
        : {
            // A second short of the backstop, so the loop's own wall ends it and names its stop.
            maxWallTimeMs: Math.max(0, deadline - clock.now() - reserveMs - backstopMarginMs),
          }),
      verificationSignal: verifying,
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
      approvalMode: settings.approval,
      abortSignal: modelWork.signal,
      homeDir: homedir(),
      ...(goalContext === undefined || goal === undefined
        ? {}
        : {
            // A check the worker asks for is model work, and ends with it rather than in the reserve.
            checkTool: acceptanceCheckTool({
              ...goalContext,
              contract: goal,
              signal: modelWork.signal,
            }),
          }),
      ...(gateOptions === undefined
        ? {}
        : {
            gateOptions:
              goalContext === undefined || goal === undefined || goal === sealedGoal
                ? gateOptions
                : { ...gateOptions, ...goalGateOptions({ ...goalContext, contract: goal }) },
          }),
      ...(diffBudget === undefined ? {} : { diffBudget }),
    });
    const taskRun = await runAgentTask(implementation(sealedGoal));

    const { loop, gates } = taskRun;
    let { green, verdict } = taskRun;
    let strengthening: MachineResult["strengthening"];
    if (goalContext !== undefined) {
      // Strengthening follows a challenge and only where asked; challenging alone never calls a model.
      const strengthened =
        options.strengthen === undefined ||
        options.challenges === undefined ||
        options.challenges === "off"
          ? null
          : await strengthenAndRepair({
              evidence,
              workspace: options.workspace,
              baseCommit,
              root: goalContext.contract,
              policy: options.challenges,
              limits: strengtheningLimits(options.strengthen),
              model,
              clock,
              signal: modelWork.signal,
              deadline,
              reserveMs,
              remainingTokens: () => remainingTokenBudget(evidence, implementationTokens),
              verifyCandidate: (contract, policy) =>
                verifyCandidateUnder(goalContext, contract, policy),
              verifyProbe: probeVerifier(goalContext),
              repair: async (brief, contract) => {
                const used = tokensSpent(evidence);
                await runAgentTask({
                  ...implementation(contract, brief),
                  // Measured under the criteria the implementation run sealed; a second seal
                  // would be a second set of criteria, which the bundle's verifier refuses. The
                  // acceptance gate keeps its identity and judges the recorded revision.
                  criteriaSealed: true,
                  maxTokens: Math.max(0, implementationTokens - used.spent),
                  ...(deadline === null
                    ? {}
                    : {
                        maxWallTimeMs: Math.max(
                          0,
                          deadline - clock.now() - reserveMs - backstopMarginMs,
                        ),
                      }),
                });
              },
            });
      if (strengthened !== null) {
        strengthening = {
          rounds: strengthened.rounds,
          admitted: strengthened.admitted,
          stopped: strengthened.stopped,
          contractDigest: strengthened.digest,
        };
        ui.note(
          `strengthening: ${strengthened.admitted.length} check(s) admitted over ${strengthened.rounds} round(s); stopped because ${strengthened.stopped}`,
        );
      }
      verdict = await finalizeTaskGoal(
        strengthened === null ? goalContext : { ...goalContext, contract: strengthened.contract },
      );
      green = verdict.acceptable;
    }
    reportGates(gates.outcome, evidence, ui.note);

    // Every finished run is one more sample the router learns from, and the ratchet numerics
    // ride along so a pass earned by erosion cannot look like a win (section 3.8).
    const cost = await priceTask(usable.modelSpec, evidence);
    const outcome = await runOutcome({
      evidence,
      task: options.task,
      verdict,
      lifecycle: loop.stopReason,
      workspace: options.workspace,
      baseCommit,
      gates: gates.outcome.finalCycle,
      contract: strengthening === undefined ? sealedGoal : (goalContext?.contract ?? sealedGoal),
      uncheckedRequirements: planning?.admission?.uncheckedRequirements ?? [],
      uncovered: planning?.admission?.uncovered ?? [],
      repairsForGeneratedChecksOnly: repairsForGeneratedChecksOnly(gates.outcome),
      usage: {
        durationMs: clock.now() - startedAt,
        steps: loop.steps,
        tokensUsed: loop.tokensUsed,
        callsWithUnknownUsage: loop.callsWithUnknownUsage,
        costUsd: cost.costUsd,
        setup:
          planning === null
            ? null
            : { tokensUsed: planning.tokensUsed, durationMs: planning.durationMs },
      },
    });
    keepChildHome = outcome.resumable;
    // The terminal, the result line and the exit status read one status, so a run the outcome
    // calls partially checked cannot exit as if it were accepted.
    const status = outcomeStatus(outcome);
    for (const line of describeRunOutcome(outcome)) ui.note(line);
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
      cost,
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
    await ui.presentEvidence(
      await summarizeEvidence(written, {
        durationMs: clock.now() - startedAt,
        steps: loop.steps,
        tokensUsed: loop.tokensUsed,
        costUsd: cost.costUsd,
      }),
    );
    const code = exitCodeFor(loop.stopReason, status);
    if (options.json) {
      process.stdout.write(
        `${jsonResultLine({
          runId: evidence.sessionId,
          verdict,
          bundleDirectory: written.directory,
          exitCode: code,
          ...(strengthening === undefined ? {} : { strengthening }),
          outcome: {
            status,
            lifecycle: outcome.lifecycle,
            requirements: outcome.requirements,
            changedFiles: outcome.changedFiles,
            finalVerification: outcome.finalVerification,
            interventions: outcome.interventions,
            setup: outcome.usage.setup,
            resumable: outcome.resumable,
            ...(outcome.uncheckedRequirements === undefined
              ? {}
              : { uncheckedRequirements: outcome.uncheckedRequirements }),
            ...(outcome.repairsForGeneratedChecksOnly === undefined
              ? {}
              : { repairsForGeneratedChecksOnly: outcome.repairsForGeneratedChecksOnly }),
          },
          ...(planning === null
            ? {}
            : {
                plannedChecks: {
                  outcome: planning.kind,
                  admitted: planning.admission?.admitted ?? [],
                  dropped: planning.admission?.dropped ?? [],
                  revision: planning.admission?.revision ?? null,
                  coverage: planning.admission?.coverage ?? null,
                  uncovered: planning.admission?.uncovered ?? [],
                },
              }),
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
    if (allowanceTimer !== null) clearTimeout(allowanceTimer);
    if (modelWorkTimer !== null) clearTimeout(modelWorkTimer);
    await ui.stop();
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    releaseRunChildHome(childHome, { keep: keepChildHome });
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * How much earlier than the model-work backstop the implementation's own wall ends: enough that the
 * loop stops on its wall and reports it, and the backstop only cuts what is still in flight.
 */
const backstopMarginMs = 1_000;

/** The run's default token allowance where none was named, the figure the spec seals. */
const defaultTaskTokens = 1_000_000;
/**
 * The most of a run's wall and token allowance that authoring planned checks may spend. It is a
 * cap, not a reservation: the run's deadline counts from its start and its tokens as spent, so
 * what planning leaves goes to implementation and repair. A quarter ended the first planning round
 * at its wall in every one of six live launches that pinned checks, once with the base's answer to
 * its checks in hand and the fix unwritten; implementation keeps at least three fifths.
 */
const planningShare = 0.4;
const execFileAsync = promisify(execFile);

/**
 * The outcome block's inputs, read off the chain and the tree rather than off anything the
 * model said: the recorded diff names the files, the last independent verification names the
 * requirements' statuses, the chain counts the interventions.
 */
/** The sealed contract's gates as gate options: its acceptance gate, and its diagnostics gate. */
function goalGateOptions(context: Parameters<typeof taskGoalGates>[0]) {
  const { acceptanceGate, diagnosticsGate } = taskGoalGates(context);
  return { acceptanceGate, ...(diagnosticsGate === null ? {} : { diagnosticsGate }) };
}

async function runOutcome(input: {
  readonly evidence: EvidenceRecorder;
  readonly task: string;
  readonly verdict: RunVerdict;
  readonly lifecycle: string;
  readonly workspace: string;
  readonly baseCommit: string;
  readonly gates: RunOutcomeInput["gates"];
  readonly contract: GoalContract | undefined;
  readonly uncheckedRequirements: NonNullable<RunOutcomeInput["uncheckedRequirements"]>;
  readonly uncovered: NonNullable<RunOutcomeInput["uncovered"]>;
  readonly repairsForGeneratedChecksOnly: readonly number[];
  readonly usage: RunOutcomeInput["usage"];
}): Promise<RunOutcomeInput> {
  const { evidence } = input;
  const payloads = evidence.payloads();
  const diff = evidence.records().findLast((record) => record.type === "workspace-diff");
  const diffPayload = payloads.get(diff?.payloadDigest ?? "") as
    | { patch?: string; truncated?: boolean }
    | undefined;
  const verification = evidence
    .records()
    .findLast((record) => record.type === "independent-verification");
  const verificationPayload = payloads.get(verification?.payloadDigest ?? "") as
    | {
        refusal?: string | null;
        regression?: string;
        unmeasured?: boolean;
        advice?: string;
        goalAcceptance?: Parameters<typeof requirementOutcomes>[1] extends infer T
          ? T extends { goalAcceptance?: infer G }
            ? G
            : never
          : never;
      }
    | undefined;
  let branch: string | null = null;
  try {
    const named = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: input.workspace,
      env: harnessChildEnvironment().variables,
      timeout: 10_000,
    });
    branch = named.stdout.trim() === "HEAD" ? "a detached HEAD" : named.stdout.trim();
  } catch {
    branch = null;
  }
  return {
    task: input.task,
    verdict: input.verdict,
    lifecycle: input.lifecycle,
    workspace: input.workspace,
    branch,
    baseCommit: input.baseCommit,
    changedFiles: changedFilesOf(diffPayload?.patch ?? ""),
    diffTruncated: diffPayload?.truncated === true,
    gates: input.gates,
    ...(input.uncheckedRequirements.length === 0
      ? {}
      : { uncheckedRequirements: input.uncheckedRequirements }),
    ...(input.uncovered.length === 0 ? {} : { uncovered: input.uncovered }),
    ...(input.repairsForGeneratedChecksOnly.length === 0
      ? {}
      : { repairsForGeneratedChecksOnly: input.repairsForGeneratedChecksOnly }),
    requirements:
      input.contract === undefined
        ? null
        : requirementOutcomes(
            input.contract,
            verificationPayload === undefined ? undefined : { ...verificationPayload },
          ),
    finalVerification:
      input.contract === undefined || verificationPayload === undefined
        ? null
        : {
            refusal: verificationPayload.refusal ?? null,
            regression: verificationPayload.regression ?? "unmeasured",
            unmeasured: verificationPayload.unmeasured === true,
            advice: verificationPayload.advice ?? "",
          },
    usage: input.usage,
    interventions: interventionsOn(evidence),
    runId: evidence.sessionId,
    resumable:
      !input.verdict.acceptable &&
      (input.lifecycle === "interrupted" || input.lifecycle === "max-wall-time"),
  };
}

/** How long a local backend gets to say what it serves before the answer stops being worth waiting for. */

/**
 * A tasks file is one task per line, or a JSON task graph. Both reach the same run: what a
 * person hand-writes and what a planner declares are the same artifact, so the scheduler and
 * the outcome claim do not care which happened, and the record says which it was.
 */
/**
 * What the shell is told: the outcome status the terminal and the result line also carry, and
 * for a run someone cancelled the code a shell reports for that rather than borrowing the one
 * that means the work was measured and found wanting.
 */
function exitCodeFor(stopReason: StopReason, status: OutcomeStatus): number {
  // 128 + SIGINT, which is what every shell reports for a process a person stopped, and which
  // a shell will report for this process anyway. The taxonomy in machine-output.ts covers the
  // codes a caller branches on; this one is the convention.
  const cancelledBySignal = 130;
  if (stopReason === "interrupted") {
    return cancelledBySignal;
  }
  return exitCodeForStatus(status);
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
  if (options.command === "check") {
    return (await import("./cli-check.ts")).check(options);
  }
  if (options.command === "action") {
    return (await import("./cli-action.ts")).action(options);
  }
  if (options.command === "verdict") {
    return (await import("./cli-verdict.ts")).verifyVerdict(options);
  }
  if (options.command === "hook" || options.command === "mcp" || options.command === "pre-commit") {
    return (await import("./cli-integrations.ts")).integration(options);
  }
  return options.command === "gates" ? gates(options) : run(options);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    // A command line this build cannot read is an invalid request (2), and a machine with no model
    // to run, or a repository with nothing to measure a change by, is unavailable (4), as `swarm
    // check` already reports it; none of them is work that failed (1).
    process.exitCode =
      error instanceof InvalidCommandLineError
        ? exitCodes.invalidRequest
        : error instanceof NoDefaultModelError || error instanceof NoManifestError
          ? exitCodes.unavailable
          : exitCodes.notAcceptable;
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
      ...(context.localEndpoint === null ? [] : ["--local-endpoint", context.localEndpoint]),
      "--isolation",
      context.spec.isolation.backend === "host" ? "none" : context.spec.isolation.backend,
      ...(context.spec.taskOracle === null ? [] : ["--oracle", context.spec.taskOracle.command]),
      ...(context.spec.escalation === undefined
        ? []
        : ["--escalate-model", context.spec.escalation.target]),
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
      ...(context.goal === undefined ? {} : { goal: context.goal }),
      history: context.history,
      escalationCount: context.escalationCount,
      remainingTokens: context.remainingTokens,
      remainingWallMs: context.remainingWallMs,
      deadline: context.deadline,
      previousSpec: context.spec,
      previousCriteria: context.criteria,
      source: context.source,
      childHomeOwner: context.childHomeOwner,
      chargedForCancelledCalls: context.chargedForCancelledCalls,
      declaredFiles: context.declaredFiles,
    },
  });
}
