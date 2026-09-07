import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolveLocalBackend } from "./cli-local-backend.ts";
import type { SelectCommand } from "./cli-options.ts";
import type { ResolvedSettings } from "./config/settings.ts";
import type { RandomSource } from "./core/random-source.ts";
import { exitCodes } from "./machine-output.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { fetchServedModels } from "./providers/served-models.ts";
import {
  defaultCompetencyTablePath,
  lookupCompetency,
  readCompetencyTable,
} from "./select/competency-table.ts";
import { probeHardware } from "./select/hardware-probe.ts";
import { defaultPickPath, readCalibrationPick } from "./select/pick-store.ts";
import { recommendModel } from "./select/recommendation.ts";
import { defaultRoutingLogPath, openRoutingLog } from "./select/routing-log.ts";
import { renderSelectReport } from "./select/select-report.ts";
import { servableCandidates } from "./select/servable-candidates.ts";
import { loadShortlist } from "./select/shortlist-source.ts";
import { systemProbeEnvironment } from "./select/system-probe.ts";
import { classifyTask } from "./select/task-class.ts";
import { type RoutingDecision, routeModel } from "./select/ucb.ts";

/** Long enough for the shortlist host to answer, short enough that an offline run is not a wait. */
export const shortlistFetchTimeoutMs = 4_000;

/** A local server either answers about what it serves promptly or is treated as serving nothing. */
export const servedModelsTimeoutMs = 2_000;

/**
 * No model, no ledger: every number this prints came off the machine or out of the shortlist,
 * so there is no claim here for evidence to answer.
 */
export async function select(options: SelectCommand): Promise<number> {
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
export async function chooseModel(
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
