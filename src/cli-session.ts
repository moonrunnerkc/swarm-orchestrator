import { statSync } from "node:fs";
import { homedir } from "node:os";
import { runAgentTask } from "./agent-run.ts";
import { announceBundle, writeBundle } from "./cli-bundle.ts";
import { offerInit } from "./cli-init.ts";
import { resolveLocalBackend } from "./cli-local-backend.ts";
import { preflightAll } from "./cli-model-preflight.ts";
import type { SessionCommand } from "./cli-options.ts";
import { registrySettingsFrom } from "./cli-provider-settings.ts";
import { runStorePath } from "./cli-run-commands.ts";
import { reportBonds, reportGates } from "./cli-run-report.ts";
import { diffBudgetFrom, gateOptionsFrom, settingsFor } from "./cli-run-settings.ts";
import { createSystemClock, createSystemRandom } from "./cli-runtime-inputs.ts";
import { chooseModel } from "./cli-select.ts";
import { logReward, priceTask } from "./cli-task-cost.ts";
import { closeTaskReader, startInterface } from "./cli-terminal.ts";
import type { ResolvedSettings } from "./config/settings.ts";
import type { Clock } from "./core/clock.ts";
import type { ConversationMessage } from "./core/model-client.ts";
import type { RandomSource } from "./core/random-source.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import {
  createSessionId,
  defaultSessionRoot,
  type EvidenceRecorder,
  openEvidenceSession,
} from "./evidence/session.ts";
import { parseIsolationOption } from "./exec/isolation-option.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import { defaultDiffBudget, sealAssembledCriteria } from "./gates/engine.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import { requireBaseCommit } from "./gates/git-workspace.ts";
import { summarizeRatchet } from "./gates/ratchet-summary.ts";
import { recordTurnBaseline } from "./gates/turn-baseline.ts";
import { localEndpointRecord } from "./providers/endpoint-resolution.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { chooseUsableModel } from "./select/model-fallback.ts";
import { routingDecisionRecord } from "./select/routing-record.ts";
import type { SessionInterface } from "./tui/session-interface.ts";

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
export async function session(options: SessionCommand): Promise<number> {
  if (!statSync(options.workspace).isDirectory()) {
    throw new Error(`${options.workspace} is not a directory to work in`);
  }
  // Resolved once, here, before any gate reads it and before the model is asked for anything.
  // A symbolic ref is spent at the moment each base-side question is asked, and `git` is on
  // the shell allowlist; a directory with no base commit is found out now rather than after
  // the first turn has written its files.
  const baseCommitAtStart = await requireBaseCommit(options.workspace, options.baseRef);
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
  const ui = await startInterface({ task: "", workspace: options.workspace, settings, clock });

  let baseRef = baseCommitAtStart;
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
    closeTaskReader();
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
    { transcript: "components" },
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
      runStorePath: runStorePath(),
      ...(isolation === null ? {} : { isolation: recordedContainerBackend(isolation, evidence) }),
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
