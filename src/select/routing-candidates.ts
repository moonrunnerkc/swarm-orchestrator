import { type CompetencyTable, competenciesFor, competencyFloor } from "./competency-table.ts";
import type { TaskClass } from "./task-class.ts";

/**
 * The models the router may choose between for one task: the calibration pick's own
 * candidates, then every other model the competency table has measured on this task class,
 * on the same golden set, at or above the floor.
 *
 * The pick on disk is the last sweep's, and its candidates are the models that sweep ran
 * together. Reading only those meant a model with the best evidence of all on a class was never
 * in the running when a later sweep happened not to include it: on one machine qwen3.6 held
 * the best edit share across two sweeps and the router chose between gemma4 and mistral. The
 * table folds every sweep of a golden set, so what it has measured is what the router asks
 * about. Nothing here interpolates: a model under the floor on this class, or measured on
 * another golden set, is not a candidate here (invariant 14).
 */
export function routingCandidates(input: {
  readonly pick: { readonly candidates: readonly string[]; readonly goldenSetVersion: string };
  readonly table: CompetencyTable;
  readonly taskClass: TaskClass;
  readonly floor?: number;
}): readonly string[] {
  const floor = input.floor ?? competencyFloor;
  const measured = competenciesFor(input.table, input.taskClass, input.pick.goldenSetVersion)
    .filter((entry) => entry.executed >= floor)
    .map((entry) => entry.model)
    .sort();
  const candidates = [...input.pick.candidates];
  for (const model of measured) {
    if (!candidates.includes(model)) {
      candidates.push(model);
    }
  }
  return candidates;
}
