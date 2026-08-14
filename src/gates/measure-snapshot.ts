import type { GateObservation } from "./gate-definition.ts";
import {
  emptyTestFileMeasures,
  isTestFile,
  measureTestFile,
  type TestFileMeasures,
} from "./measures.ts";
import { matchCoverageFile, measureNames, parseUncoveredLines } from "./parsers.ts";
import type { WorkspaceChanges, WorkspaceProbe } from "./workspace-changes.ts";

/**
 * One attempt's numbers. Per-file where attribution is exact, global where it is not, and
 * null wherever nothing measured it: an absent measure is a measure the ratchet declines to
 * compare, which is different from a zero.
 */
export interface MeasureSnapshot {
  readonly perTestFile: Readonly<Record<string, TestFileMeasures>>;
  /**
   * The same files as they stand at the base commit. A retry that is the first to touch a
   * test file has no earlier snapshot to be compared against, and its baseline is the base
   * commit's content: without this, gutting a file the run had not touched yet compares
   * against nothing and passes.
   */
  readonly perTestFileAtBase: Readonly<Record<string, TestFileMeasures>>;
  /** Collected by the test runner, across the whole suite. */
  readonly testsCollected: number | null;
  readonly testsSkippedByRunner: number | null;
  readonly changedLineCoverage: number | null;
  readonly changedLinesCovered: number | null;
  readonly changedLinesMeasured: number | null;
}

export const emptyMeasureSnapshot: MeasureSnapshot = {
  perTestFile: {},
  perTestFileAtBase: {},
  testsCollected: null,
  testsSkippedByRunner: null,
  changedLineCoverage: null,
  changedLinesCovered: null,
  changedLinesMeasured: null,
};

interface SnapshotInput {
  readonly changes: WorkspaceChanges;
  readonly probe: WorkspaceProbe;
  /** Test files seen earlier in the run, so a file that stops being touched still counts. */
  readonly trackedTestFiles: Iterable<string>;
  /** The measures the gates parsed this cycle, merged across gates. */
  readonly gateMeasures: Readonly<Record<string, number>>;
  /** Raw output of gates that may carry a coverage report. */
  readonly gateOutputs: readonly GateObservation[];
}

/**
 * Reads the numbers from the working tree and from what the gates printed. Test files are
 * measured from their current text, so a deleted test file measures zero rather than
 * vanishing from the comparison, which is the whole point of counting.
 */
export async function takeMeasureSnapshot(input: SnapshotInput): Promise<MeasureSnapshot> {
  const testFiles = new Set<string>(input.trackedTestFiles);
  for (const file of input.changes.files) {
    if (isTestFile(file.path)) {
      testFiles.add(file.path);
    }
  }

  const perTestFile: Record<string, TestFileMeasures> = {};
  const perTestFileAtBase: Record<string, TestFileMeasures> = {};
  for (const path of [...testFiles].sort()) {
    perTestFile[path] = measureTestFile(await input.probe.readCurrent(path));
    perTestFileAtBase[path] = measureTestFile(await input.probe.readBase(path));
  }

  const coverage = changedLineCoverage(input);

  return {
    perTestFile,
    perTestFileAtBase,
    testsCollected: input.gateMeasures[measureNames.testsCollected] ?? null,
    testsSkippedByRunner: input.gateMeasures[measureNames.testsSkipped] ?? null,
    changedLineCoverage: coverage?.ratio ?? null,
    changedLinesCovered: coverage?.covered ?? null,
    changedLinesMeasured: coverage?.measured ?? null,
  };
}

interface CoverageResult {
  readonly ratio: number;
  readonly covered: number;
  readonly measured: number;
}

/**
 * Coverage of changed lines, from an executed run's own report intersected with the lines
 * this change added. When no gate printed a report, the answer is null: there is no proxy
 * here, because "the tests were not run against these lines" and "these lines are not
 * covered" are different findings and only one of them is measured.
 */
function changedLineCoverage(input: SnapshotInput): CoverageResult | null {
  const uncovered = new Map<string, Set<number>>();
  for (const observation of input.gateOutputs) {
    const text = `${observation.stdout}\n${observation.stderr}`;
    if (!text.includes("coverage report")) {
      continue;
    }
    for (const [file, lines] of parseUncoveredLines(text)) {
      const merged = uncovered.get(file) ?? new Set<number>();
      for (const line of lines) {
        merged.add(line);
      }
      uncovered.set(file, merged);
    }
  }
  if (uncovered.size === 0) {
    return null;
  }

  let measured = 0;
  let covered = 0;
  for (const file of input.changes.files) {
    if (isTestFile(file.path)) {
      continue;
    }
    const missed = matchCoverageFile(uncovered, file.path);
    if (missed === null) {
      continue;
    }
    for (const added of file.addedLines) {
      measured += 1;
      if (!missed.has(added.line)) {
        covered += 1;
      }
    }
  }

  return measured === 0 ? null : { ratio: covered / measured, covered, measured };
}

/**
 * The same universe of test files as they stood at the base commit, so the final state can be
 * judged against where the run started rather than only against the retry before it. The
 * runner-reported measures are null on purpose: the suite was not executed at the base, and
 * an absent measure the ratchet declines to compare is honest where a zero would not be.
 */
export function measuresAtBase(snapshot: MeasureSnapshot): MeasureSnapshot {
  return {
    perTestFile: snapshot.perTestFileAtBase,
    perTestFileAtBase: snapshot.perTestFileAtBase,
    testsCollected: null,
    testsSkippedByRunner: null,
    changedLineCoverage: null,
    changedLinesCovered: null,
    changedLinesMeasured: null,
  };
}

interface ComparableTotals {
  readonly tests: number;
  readonly assertions: number;
  readonly skips: number;
  readonly files: readonly string[];
}

interface ComparablePair {
  readonly before: ComparableTotals;
  readonly after: ComparableTotals;
}

/**
 * A file's measures as of one snapshot. A file that snapshot never tracked stood at its
 * base-commit content, which the other snapshot recorded, so the comparison is over the
 * same universe of files on both sides rather than over whatever each side happened to
 * have touched.
 */
export function measuresFor(
  snapshot: MeasureSnapshot,
  other: MeasureSnapshot,
  path: string,
): TestFileMeasures {
  return (
    snapshot.perTestFile[path] ??
    other.perTestFileAtBase[path] ??
    snapshot.perTestFileAtBase[path] ??
    emptyTestFileMeasures
  );
}

/**
 * Both sides of the comparison over one universe of test files, with the exempt ones
 * dropped from each. Exemption applies to both sides or to neither, so an exempt file can
 * never make a regression elsewhere look like progress.
 */
export function comparableTotals(
  baseline: MeasureSnapshot,
  candidate: MeasureSnapshot,
  exempt: ReadonlySet<string>,
): ComparablePair {
  const files = [
    ...new Set([...Object.keys(baseline.perTestFile), ...Object.keys(candidate.perTestFile)]),
  ]
    .filter((path) => !exempt.has(path))
    .sort();

  const sum = (snapshot: MeasureSnapshot, other: MeasureSnapshot): ComparableTotals => {
    let tests = 0;
    let assertions = 0;
    let skips = 0;
    for (const path of files) {
      const measures = measuresFor(snapshot, other, path);
      tests += measures.tests;
      assertions += measures.assertions;
      skips += measures.skips;
    }
    return { tests, assertions, skips, files };
  };

  return { before: sum(baseline, candidate), after: sum(candidate, baseline) };
}

/**
 * How many of a file's lost assertions a re-specification explains. For every subject that
 * newly carries an exact-match assertion, the assertions it shed are counted as
 * consolidated rather than stripped: an exact matcher pins the value, so one of them is at
 * least as strong as any number of looser assertions on the same subject.
 */
export function respecificationAllowance(
  baseline: MeasureSnapshot,
  candidate: MeasureSnapshot,
  path: string,
): number {
  const before = measuresFor(baseline, candidate, path);
  const after = measuresFor(candidate, baseline, path);

  const alreadyExact = new Set(before.exactSubjects);
  let allowance = 0;
  for (const subject of after.exactSubjects) {
    if (alreadyExact.has(subject)) {
      continue;
    }
    const lost =
      (before.assertionsBySubject[subject] ?? 0) - (after.assertionsBySubject[subject] ?? 0);
    if (lost > 0) {
      allowance += lost;
    }
  }
  return allowance;
}
