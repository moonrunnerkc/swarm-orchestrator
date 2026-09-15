import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { render as inkRender } from "ink";
import { announceBundle, writeBundle } from "./cli-bundle.ts";
import { resolveLocalBackend } from "./cli-local-backend.ts";
import { preflightAll } from "./cli-model-preflight.ts";
import type { AddCaseCommand, CalibrateCommand } from "./cli-options.ts";
import { registrySettingsFrom } from "./cli-provider-settings.ts";
import { noFlagSettings, settingsFor } from "./cli-run-settings.ts";
import { createSystemClock, createSystemRandom } from "./cli-runtime-inputs.ts";
import { shortlistFetchTimeoutMs } from "./cli-select.ts";
import {
  createSessionId,
  defaultSessionRoot,
  type EvidenceRecorder,
  openEvidenceSession,
} from "./evidence/session.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
import { localEndpointRecord } from "./providers/endpoint-resolution.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import {
  type BackendCanary,
  canaryRecord,
  describeCanary,
  runBackendCanary,
} from "./select/backend-canary.ts";
import { runCalibration } from "./select/calibrate.ts";
import { parseCalibrationCase } from "./select/calibration-case.ts";
import { renderCalibrationReport } from "./select/calibration-report.ts";
import {
  defaultCompetencyTablePath,
  readCompetencyTable,
  sweepFromRuns,
  withSweep,
  writeCompetencyTable,
} from "./select/competency-table.ts";
import { appendCalibrationCase, defaultGoldenSetPath, readGoldenSet } from "./select/golden-set.ts";
import { probeHardware } from "./select/hardware-probe.ts";
import { createOllamaMemoryProbe } from "./select/memory-probe.ts";
import { describePreflight } from "./select/model-preflight.ts";
import { defaultPickPath, writeCalibrationPick } from "./select/pick-store.ts";
import { calibrationCandidates, recommendModel } from "./select/recommendation.ts";
import { loadShortlist } from "./select/shortlist-source.ts";
import { systemProbeEnvironment } from "./select/system-probe.ts";
import { classifyTask } from "./select/task-class.ts";
import { createPolicyGuard, defaultShellAllowlist } from "./tools/policy-guard.ts";
import { createWorkspaceTools } from "./tools/workspace-tools.ts";
import { startCalibrateInterface } from "./tui/calibrate-interface.ts";
import { resolveTheme } from "./tui/theme.ts";

/** Roughly the build guide's five to ten minutes: four cases, three repeats, two models. */
const calibrationModelLimit = 2;

export async function calibrate(options: CalibrateCommand): Promise<number> {
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

/** Turns a task that went wrong into a case the golden set will measure against forever. */
export async function addCase(options: AddCaseCommand): Promise<number> {
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
