import {
  emptyMeasureSnapshot,
  type MeasureSnapshot,
  measuresFor,
} from "../gates/measure-snapshot.ts";

/**
 * Test-file totals for one attempt, counted over a universe every attempt shares.
 */
export interface UniverseTotals {
  readonly tests: number;
  readonly assertions: number;
  readonly skips: number;
}

/**
 * Why the universe has to be fixed before anything is ranked.
 *
 * A run's own totals are counted over the test files that run touched. That is right for the
 * ratchet, which compares one run against itself, and wrong the moment two runs are compared
 * against each other: an attempt that whitespace-touches the repository's largest test file
 * pulls every test in it into its own universe and outscores an attempt that wrote real ones.
 *
 * So the universe is every test file any attempt touched or tracked at the base, and each
 * attempt is counted over all of it. A file an attempt did not touch counts at the content it
 * had at the base commit, which is what `measuresFor` already does pairwise; here the second
 * side is the base as every attempt saw it. Touching a file therefore imports nothing, since
 * the file was already in everyone's universe at its base content, and the only way to move a
 * total is to change what the file contains. Taking the base files in as well as the touched
 * ones also keeps the reported numbers stable: they are levels over the tracked suite, not
 * figures that move for every attempt when one attempt happens to open a large file.
 *
 * This holds only because all attempts at one task branch from one commit, which the
 * scheduler guarantees and the selection record names.
 */
export function totalsOverFixedUniverse(
  snapshots: readonly MeasureSnapshot[],
): readonly UniverseTotals[] {
  const universe = [
    ...new Set(
      snapshots.flatMap((snapshot) => [
        ...Object.keys(snapshot.perTestFile),
        ...Object.keys(snapshot.perTestFileAtBase),
      ]),
    ),
  ].sort();
  const base = sharedBase(snapshots);

  return snapshots.map((snapshot) => {
    const totals = { tests: 0, assertions: 0, skips: 0 };
    for (const path of universe) {
      const measures = measuresFor(snapshot, base, path);
      totals.tests += measures.tests;
      totals.assertions += measures.assertions;
      totals.skips += measures.skips;
    }
    return totals;
  });
}

/**
 * The base content of every test file any attempt tracked. One attempt may have tracked a
 * file another never saw, and they branched from the same commit, so the union is what the
 * base was rather than a merge of disagreeing readings of it.
 */
function sharedBase(snapshots: readonly MeasureSnapshot[]): MeasureSnapshot {
  const perTestFileAtBase = Object.assign(
    {},
    ...snapshots.map((snapshot) => snapshot.perTestFileAtBase),
  );
  return { ...emptyMeasureSnapshot, perTestFileAtBase };
}
