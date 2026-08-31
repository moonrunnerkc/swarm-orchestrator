import { join } from "node:path";

/**
 * How many tests a run collected, read from a result the runner wrote to a path the harness
 * named, and never from what the run printed.
 *
 * This is the coverage arm's rule applied to the one numeric the ratchet was still taking off
 * stdout. A gate's printed output is authored inside the surface being measured: a test that
 * writes `Tests  9999 passed (9999)` supplies the vitest reader its summary line before the
 * runner's own summary exists, and the reader takes the first match. The count then reaches the
 * ratchet as `testsCollected`, where a raised number is exactly what hides a deleted test the
 * per-file counting never saw, because that counting only reads files the harness recognizes as
 * test files.
 *
 * So the number comes from an artifact or it does not come at all. Not measured is a verdict;
 * a count the code under measurement could have written is not one.
 */

export interface TestCounts {
  readonly collected: number;
  /** Null where the result declared no skipped counter, which is not the same as zero. */
  readonly skipped: number | null;
}

/**
 * One gate's result path, beside its coverage report and under the same session directory.
 * Per gate id for the reason the coverage path is: two test gates in a polyglot tree must not
 * read each other's numbers.
 */
export function testCountArtifactPath(directory: string, gateId: string): string {
  return join(directory, `${gateId.replaceAll(/[^A-Za-z0-9._-]+/g, "-")}.tap`);
}

/** The end-of-run counter block a TAP producer writes, at the left margin and nowhere else. */
function counterLines(text: string, name: string): readonly number[] {
  const pattern = new RegExp(`^# ${name} (\\d+)$`, "gm");
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
}

/**
 * The counters a TAP result declares, or null when it declares none.
 *
 * The last block rather than the first. Node escapes a leading `#` in output it captured from a
 * test, so a test cannot write one of these lines into the result at all; reading the last one
 * anyway costs nothing and means a producer that does not escape still cannot put its forgery
 * ahead of its own summary.
 */
export function parseTestCounts(text: string): TestCounts | null {
  const collected = counterLines(text, "tests").at(-1);
  if (collected === undefined) {
    return null;
  }
  return { collected, skipped: counterLines(text, "skipped").at(-1) ?? null };
}

/**
 * The counts for one cycle, or null to abstain.
 *
 * Exactly one result, because the ratchet compares one number across two attempts and two
 * results are two suites. Adding them would make the comparison depend on how many arms
 * happened to produce a result rather than on how many tests exist, which is the same defect as
 * folding two coverage sections for one file: an abstention is the honest answer where two
 * accounts arrive, not their sum.
 */
export function countsForCycle(reports: readonly string[]): TestCounts | null {
  const parsed = reports
    .map((report) => parseTestCounts(report))
    .filter((counts) => counts !== null);
  return parsed.length === 1 ? (parsed[0] ?? null) : null;
}
