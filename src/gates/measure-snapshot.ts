import {
  emptyTestFileMeasures,
  isTestFile,
  isTestReachableSource,
  measureTestFile,
  type TestFileMeasures,
} from "./measures.ts";
import { fileLineHits, parseLineHits, parseTapTotals } from "./parsers.ts";
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
  /**
   * What a report's relative file names are relative to. Absent means the report and the change
   * have to spell a path the same way to be about the same file, which is stricter than
   * resolving them and never looser.
   */
  readonly workspaceRoot?: string;
  /** Test files seen earlier in the run, so a file that stops being touched still counts. */
  readonly trackedTestFiles: Iterable<string>;
  /**
   * Coverage reports the runners wrote to paths the harness named. Never a gate's stdout: a
   * number printed by the code under measurement is not a measurement of it.
   */
  readonly coverageReports: readonly string[];
  /**
   * TAP the runners wrote to paths the harness named, which is where the collected count comes
   * from. Never the counters a run printed: node's default reporter passes a test's own
   * `console.log("# tests 999")` through ahead of its own counters, and the counter reader
   * takes the first match, so four print statements reported 999 collected for a suite of one.
   * Empty here means the count is not measured, which the ratchet abstains on by name.
   */
  readonly testReports: readonly string[];
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
  const runner = runnerTotals(input);

  return {
    perTestFile,
    perTestFileAtBase,
    testsCollected: runner?.collected ?? null,
    testsSkippedByRunner: runner?.skipped ?? null,
    changedLineCoverage: coverage?.ratio ?? null,
    changedLinesCovered: coverage?.covered ?? null,
    changedLinesMeasured: coverage?.measured ?? null,
  };
}

/**
 * What the runners reported, summed over the artifacts they were asked to write. Null wherever
 * no artifact was readable, or wherever one of them does not agree with itself: a TAP document
 * whose plan disagrees with its own top-level point count is not read at all, and one unreadable
 * report makes the cycle's total a partial sum rather than a total, which is not a measurement
 * of the suite.
 */
function runnerTotals(input: SnapshotInput): { collected: number; skipped: number } | null {
  const reports = input.testReports ?? [];
  if (reports.length === 0) {
    return null;
  }

  let collected = 0;
  let skipped = 0;
  for (const report of reports) {
    const totals = parseTapTotals(report);
    if (totals === null) {
      return null;
    }
    collected += totals.collected;
    skipped += totals.skipped;
  }
  return { collected, skipped };
}

interface CoverageResult {
  readonly ratio: number;
  readonly covered: number;
  readonly measured: number;
}

/**
 * Coverage of changed lines, from a report the runner wrote intersected with the lines this
 * change added. When no runner left a report, the answer is null: there is no proxy here,
 * because "the tests were not run against these lines" and "these lines are not covered" are
 * different findings and only one of them is measured. In particular there is no fallback to
 * what a gate printed, since that is a number the code under measurement can author, and an
 * artifact that is not a complete lcov report parses as nothing, which lands here as the same
 * null a coverage-free project produces.
 *
 * A changed line counts as covered only where the report names it and says a run reached it.
 * The reading this replaces asked the opposite question, whether the line was named as missed,
 * so every line a report simply left out came back covered: a section listing two hit lines out
 * of nine reported nine covered. What a report does not say is not a measurement.
 */
function changedLineCoverage(input: SnapshotInput): CoverageResult | null {
  // Kept as the sections they were written as, never folded by file. Two sections describing
  // one file are two accounts of it, and adding them together is how one line's measurement
  // used to pay for eight lines nothing measured.
  //
  // Required in the type so every caller in this package has to decide, and tolerated when
  // absent so a caller that hands in no report abstains rather than aborting the run: an arm
  // with nothing to read is not measured, which is a verdict, not an error.
  const sections = (input.coverageReports ?? []).flatMap((report) => parseLineHits(report));
  if (sections.length === 0) {
    return null;
  }

  let measured = 0;
  let covered = 0;
  for (const file of input.changes.files) {
    // A markdown file whose fenced block contains an `if (` is not something a coverage
    // report can speak about, and counting it would put noise into a blocking number.
    if (!isTestReachableSource(file.path)) {
      continue;
    }
    const lineHits = fileLineHits(sections, file.path, input.workspaceRoot);
    if (lineHits === null) {
      continue;
    }
    for (const added of file.addedLines) {
      measured += 1;
      if ((lineHits.get(added.line) ?? 0) > 0) {
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
 * Both sides of the comparison over one universe of test files, per test rather than per
 * file. Granularity is the whole point: a file-level exemption dropped the file from the
 * comparison, so one new specification anywhere in it hid every deletion beside it.
 *
 * Every test that existed at the base is still compared. A proven new specification pays for
 * exactly one deleted test, which is what lets a legitimate re-specification of a whole file
 * clear while a deletion beside one new spec does not: the file has to have replaced what it
 * removed, one for one, not merely have added something.
 */
export function comparableTotals(
  baseline: MeasureSnapshot,
  candidate: MeasureSnapshot,
  newSpecifications: ReadonlySet<string>,
): ComparablePair {
  const files = [
    ...new Set([...Object.keys(baseline.perTestFile), ...Object.keys(candidate.perTestFile)]),
  ].sort();

  const before = { tests: 0, assertions: 0, skips: 0 };
  const after = { tests: 0, assertions: 0, skips: 0 };

  for (const path of files) {
    const was = measuresFor(baseline, candidate, path);
    const is = measuresFor(candidate, baseline, path);
    const replaced = pairReplacements(path, was, is, newSpecifications);

    before.tests += was.tests - replaced.before.tests;
    before.assertions += was.assertions - replaced.before.assertions;
    before.skips += was.skips - replaced.before.skips;
    after.tests += is.tests - replaced.after.tests;
    after.assertions += is.assertions - replaced.after.assertions;
    after.skips += is.skips - replaced.after.skips;
  }

  return { before: { ...before, files }, after: { ...after, files } };
}

interface NamedTest {
  readonly name: string;
  readonly assertions: number;
  readonly skips: number;
}

interface ReplacedTotals {
  readonly before: { tests: number; assertions: number; skips: number };
  readonly after: { tests: number; assertions: number; skips: number };
}

const nothingReplaced: ReplacedTotals = {
  before: { tests: 0, assertions: 0, skips: 0 },
  after: { tests: 0, assertions: 0, skips: 0 },
};

/**
 * How much of a file's loss its proven new specifications account for. Deletions are matched
 * to new specifications one for one, and only the matched pairs leave the comparison.
 *
 * The cheapest deletions are the ones forgiven and the richest new specifications are what
 * pay for them, which is the strictest pairing: what stays in the comparison is the largest
 * loss the file cannot account for, rather than whichever loss happened to sort first.
 */
function pairReplacements(
  path: string,
  before: TestFileMeasures,
  after: TestFileMeasures,
  newSpecifications: ReadonlySet<string>,
): ReplacedTotals {
  const deleted = namedTests(before).filter((test) => !(test.name in after.perTest));
  const proven = namedTests(after).filter(
    (test) => !(test.name in before.perTest) && newSpecifications.has(`${path}::${test.name}`),
  );

  const pairs = Math.min(deleted.length, proven.length);
  if (pairs === 0) {
    return nothingReplaced;
  }

  deleted.sort((left, right) => left.assertions - right.assertions || compareName(left, right));
  proven.sort((left, right) => right.assertions - left.assertions || compareName(left, right));

  return { before: total(deleted.slice(0, pairs)), after: total(proven.slice(0, pairs)) };
}

function namedTests(measures: TestFileMeasures): NamedTest[] {
  return Object.entries(measures.perTest).map(([name, test]) => ({ name, ...test }));
}

function compareName(left: NamedTest, right: NamedTest): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function total(tests: readonly NamedTest[]): { tests: number; assertions: number; skips: number } {
  return {
    tests: tests.length,
    assertions: tests.reduce((sum, test) => sum + test.assertions, 0),
    skips: tests.reduce((sum, test) => sum + test.skips, 0),
  };
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
