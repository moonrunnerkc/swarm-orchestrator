import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { type TaskClass, taskClasses } from "./task-class.ts";

/**
 * What each calibrated model was measured to do on each class of task, kept as counts of
 * executed repeats and of the ones whose gate passed, per sweep. Every number here is read
 * off `calibration-run` ledger records, executed ones only: a repeat the model never answered
 * is not evidence about the model. Sweeps are kept apart rather than folded, so a reader can
 * see which measurement each count came from and a later sweep of the same golden set adds
 * samples rather than replacing them.
 */
const sweepEntrySchema = z.object({
  model: z.string().min(1),
  taskClass: z.enum(taskClasses),
  executed: z.number().int().nonnegative(),
  gatePassed: z.number().int().nonnegative(),
});

const sweepSchema = z.object({
  sessionId: z.string().min(1),
  goldenSetVersion: z.string().min(1),
  recordedAt: z.number(),
  entries: z.array(sweepEntrySchema),
});

export const competencyTableSchema = z.object({
  schemaVersion: z.literal(1),
  sweeps: z.array(sweepSchema),
});

export type CompetencyTable = z.infer<typeof competencyTableSchema>;
export type CompetencySweep = z.infer<typeof sweepSchema>;

export interface CalibrationRunFacts {
  readonly model: string;
  readonly taskClass: TaskClass;
  readonly executed: boolean;
  readonly gatePassed: boolean;
}

/** Beside the pick and the reward log, outside every workspace. */
export function defaultCompetencyTablePath(homeDirectory: string): string {
  return join(homeDirectory, ".swarm", "routing", "competency-table.json");
}

export function emptyCompetencyTable(): CompetencyTable {
  return { schemaVersion: 1, sweeps: [] };
}

/** One sweep's counts, from its own run records. Unexecuted repeats count for nothing. */
export function sweepFromRuns(
  input: {
    readonly sessionId: string;
    readonly goldenSetVersion: string;
    readonly recordedAt: number;
  },
  runs: readonly CalibrationRunFacts[],
): CompetencySweep {
  const counts = new Map<
    string,
    { model: string; taskClass: TaskClass; executed: number; gatePassed: number }
  >();
  for (const run of runs) {
    if (!run.executed) {
      continue;
    }
    const key = `${run.model}\n${run.taskClass}`;
    const entry = counts.get(key) ?? {
      model: run.model,
      taskClass: run.taskClass,
      executed: 0,
      gatePassed: 0,
    };
    entry.executed += 1;
    if (run.gatePassed) {
      entry.gatePassed += 1;
    }
    counts.set(key, entry);
  }
  return sweepSchema.parse({ ...input, entries: [...counts.values()] });
}

/** A sweep already recorded under its session id is not recorded twice. */
export function withSweep(table: CompetencyTable, sweep: CompetencySweep): CompetencyTable {
  return {
    schemaVersion: 1,
    sweeps: [...table.sweeps.filter((entry) => entry.sessionId !== sweep.sessionId), sweep],
  };
}

export interface Competency {
  readonly model: string;
  readonly taskClass: TaskClass;
  readonly executed: number;
  readonly gatePassed: number;
  /** Executed repeats whose gate passed, as a share; null with nothing executed. */
  readonly gateShare: number | null;
  readonly sweeps: number;
}

/**
 * The counts for one class, folded across every sweep of one golden set version. Sweeps of
 * another version are not folded in: they measured a different set of cases.
 */
export function competenciesFor(
  table: CompetencyTable,
  taskClass: TaskClass,
  goldenSetVersion: string,
): readonly Competency[] {
  const folded = new Map<string, { executed: number; gatePassed: number; sweeps: number }>();
  for (const sweep of table.sweeps) {
    if (sweep.goldenSetVersion !== goldenSetVersion) {
      continue;
    }
    for (const entry of sweep.entries) {
      if (entry.taskClass !== taskClass) {
        continue;
      }
      const running = folded.get(entry.model) ?? { executed: 0, gatePassed: 0, sweeps: 0 };
      running.executed += entry.executed;
      running.gatePassed += entry.gatePassed;
      running.sweeps += 1;
      folded.set(entry.model, running);
    }
  }
  return [...folded.entries()].map(([model, counts]) => ({
    model,
    taskClass,
    ...counts,
    gateShare: counts.executed === 0 ? null : counts.gatePassed / counts.executed,
  }));
}

/**
 * Executed repeats a class entry needs before it says anything about a model. Three cases
 * at three repeats is nine; six is two of those cases, the least that is still more than
 * one case's worth of one model's luck.
 */
export const competencyFloor = 6;

export interface CompetencyLookup {
  readonly taskClass: TaskClass;
  readonly floor: number;
  /** The model the table prefers for this class, or null where it abstained. */
  readonly pick: string | null;
  readonly abstained: boolean;
  readonly reason: string;
  readonly considered: readonly Competency[];
}

/**
 * The table's answer for one class, among the candidates the router may choose between. An
 * entry under the floor is not a competency, it is a guess with a number on it, so a class
 * where no candidate clears the floor abstains by name and the caller's default stands.
 * Nothing here interpolates: a model with no entry for a class has no competency there,
 * whatever it did on the others.
 */
export function lookupCompetency(input: {
  readonly table: CompetencyTable;
  readonly taskClass: TaskClass;
  readonly goldenSetVersion: string;
  readonly candidates: readonly string[];
  readonly floor?: number;
}): CompetencyLookup {
  const floor = input.floor ?? competencyFloor;
  const considered = competenciesFor(input.table, input.taskClass, input.goldenSetVersion).filter(
    (entry) => input.candidates.includes(entry.model),
  );
  const sufficient = considered.filter((entry) => entry.executed >= floor);
  if (sufficient.length === 0) {
    const described =
      considered.length === 0
        ? "no candidate has an executed run on this class in the table"
        : considered
            .map((entry) => `${entry.model} has ${entry.executed} executed run(s) on this class`)
            .join(", ");
    return {
      taskClass: input.taskClass,
      floor,
      pick: null,
      abstained: true,
      reason: `${described}, and ${floor} are needed before the table says anything, so the default stands`,
      considered,
    };
  }
  // Highest gate share wins; a tie goes to the candidate the caller listed first, which is
  // the calibration pick where the caller put it first, and never to a coin.
  const best = sufficient.reduce((leading, entry) => {
    if ((entry.gateShare ?? 0) > (leading.gateShare ?? 0)) {
      return entry;
    }
    if ((entry.gateShare ?? 0) === (leading.gateShare ?? 0)) {
      return input.candidates.indexOf(entry.model) < input.candidates.indexOf(leading.model)
        ? entry
        : leading;
    }
    return leading;
  });
  return {
    taskClass: input.taskClass,
    floor,
    pick: best.model,
    abstained: false,
    reason:
      `${best.model} passed the gate on ${best.gatePassed} of ${best.executed} executed ` +
      `${input.taskClass} run(s) across ${best.sweeps} sweep(s), the best share among ` +
      `${sufficient.length} candidate(s) at or above the floor of ${floor}`,
    considered,
  };
}

export async function readCompetencyTable(path: string): Promise<CompetencyTable> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return emptyCompetencyTable();
  }
  return competencyTableSchema.parse(JSON.parse(text));
}

export async function writeCompetencyTable(path: string, table: CompetencyTable): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(competencyTableSchema.parse(table), null, 2)}\n`, "utf8");
}
