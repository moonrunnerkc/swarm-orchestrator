// Population selection for the capability-hunt recall passes.
//
// A pass measures the EG-viable slice of a frozen corpus. The frozen `egViable`
// flag on each dataset entry is the intake-time screen; a later screen version
// (B2's subdirectory-manifest discovery) can find an entry viable that the
// intake screen rejected. The frozen dataset is never rewritten, so the pass
// takes the refreshed verdict from a separate viability file and records which
// source decided each entry. Keeping that resolution here, rather than inline in
// the batch driver, is what lets a test assert the population directly.

/** The fields a recall pass needs from a corpus entry. */
export interface CorpusEntryLike {
  readonly id: string;
  readonly egViable: boolean;
}

/** One row of a viability refresh (b2-ab/corpus-viability-delta.json). */
export interface ViabilityRow {
  readonly id: string;
  readonly viableAfter: boolean;
  readonly reason?: string;
}

/** Which screen decided an entry's viability. */
export type ViabilitySource = 'frozen-dataset' | 'viability-refresh';

/** An entry with its effective viability and the provenance of that verdict. */
export interface PopulationEntry<T extends CorpusEntryLike> {
  readonly entry: T;
  readonly viable: boolean;
  readonly source: ViabilitySource;
  readonly reason: string | null;
  /** True when the refresh disagreed with the frozen flag. */
  readonly changed: boolean;
}

/** The split population plus the counts a three-column report opens with. */
export interface ResolvedPopulation<T extends CorpusEntryLike> {
  readonly all: ReadonlyArray<PopulationEntry<T>>;
  readonly viable: ReadonlyArray<PopulationEntry<T>>;
  readonly nonviable: ReadonlyArray<PopulationEntry<T>>;
  readonly recoveredIds: readonly string[];
  readonly lostIds: readonly string[];
}

/**
 * Resolve each corpus entry's effective viability.
 *
 * An entry absent from the refresh keeps its frozen flag, so a partial refresh
 * never silently drops entries from the population.
 *
 * @param entries the frozen corpus entries, in dataset order.
 * @param viability refresh rows, or null to use the frozen flags unchanged.
 * @returns the population split into viable and non-viable, with per-entry
 *   provenance and the ids the refresh recovered or lost.
 */
export function resolvePopulation<T extends CorpusEntryLike>(
  entries: readonly T[],
  viability: readonly ViabilityRow[] | null,
): ResolvedPopulation<T> {
  const byId = new Map<string, ViabilityRow>();
  for (const row of viability ?? []) byId.set(row.id, row);

  const all = entries.map((entry): PopulationEntry<T> => {
    const row = byId.get(entry.id);
    if (row === undefined) {
      return {
        entry,
        viable: entry.egViable,
        source: 'frozen-dataset',
        reason: null,
        changed: false,
      };
    }
    return {
      entry,
      viable: row.viableAfter,
      source: 'viability-refresh',
      reason: row.reason ?? null,
      changed: row.viableAfter !== entry.egViable,
    };
  });

  return {
    all,
    viable: all.filter((p) => p.viable),
    nonviable: all.filter((p) => !p.viable),
    recoveredIds: all.filter((p) => p.changed && p.viable).map((p) => p.entry.id),
    lostIds: all.filter((p) => p.changed && !p.viable).map((p) => p.entry.id),
  };
}

/** The per-entry facts the three-column population counts over. */
export interface ThreeColumnInput {
  readonly bucket: string;
  readonly provisioned: boolean;
  readonly controlsExecuted: boolean;
}

/**
 * The three-column population of pre-registration amendment 5: provisioned,
 * controls-executable, and proven are not the same set, and reporting only the
 * first and last overstates what was measurable.
 *
 * @param rows one entry per audited record.
 * @returns the three counts plus the rule-of-three recall ceiling, which is
 *   defined only when nothing was proven and at least one control executed.
 */
export function threeColumnPopulation(rows: readonly ThreeColumnInput[]): {
  provisioned: number;
  controlsExecutable: number;
  proven: number;
  ruleOfThreeUpperBound: number | null;
} {
  const provisioned = rows.filter((r) => r.provisioned).length;
  const controlsExecutable = rows.filter((r) => r.controlsExecuted).length;
  const proven = rows.filter((r) => r.bucket === 'proven').length;
  return {
    provisioned,
    controlsExecutable,
    proven,
    ruleOfThreeUpperBound: proven === 0 && controlsExecutable > 0 ? 3 / controlsExecutable : null,
  };
}
