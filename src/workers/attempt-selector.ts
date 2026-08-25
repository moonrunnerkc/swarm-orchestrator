import type { MeasureSnapshot } from "../gates/measure-snapshot.ts";
import { totalsOverFixedUniverse, type UniverseTotals } from "./attempt-universe.ts";

/** One try at a task, as it stands in its own worktree before anything is merged. */
export interface Attempt {
  readonly workerId: string;
  readonly taskId: string;
  readonly attemptIndex: number;
  readonly green: boolean;
  readonly commit: string | null;
  /** Every attempt at one task branches from this, which is what makes them comparable. */
  readonly baseCommit: string;
  readonly measures: MeasureSnapshot;
  readonly erosions: number;
  readonly changedFiles: number;
  readonly addedLines: number;
}

/** An attempt with every number the comparator reads, so the record shows the working. */
export interface RankedAttempt {
  readonly workerId: string;
  readonly attemptIndex: number;
  readonly eligible: boolean;
  readonly reason: string | null;
  readonly testsCollected: number | null;
  readonly assertions: number;
  readonly tests: number;
  readonly skipMarkers: number;
  readonly changedLinesCovered: number | null;
  readonly uncoveredChangedLines: number | null;
  readonly erosions: number;
  readonly changedFiles: number;
  readonly addedLines: number;
}

export interface Abstention {
  readonly dimension: string;
  readonly reason: string;
}

export interface AttemptSelection {
  readonly taskId: string;
  readonly baseCommit: string;
  /** Every attempt, eligible ones in rank order first, then the ones left out. */
  readonly attempts: readonly RankedAttempt[];
  readonly order: readonly string[];
  readonly winner: string | null;
  /** The first dimension that separated the winner from the runner-up, or null for a tie. */
  readonly decidedBy: string | null;
  readonly abstentions: readonly Abstention[];
}

interface Dimension {
  readonly name: string;
  compare(a: RankedAttempt, b: RankedAttempt): number;
  read(attempt: RankedAttempt): number | null;
}

/**
 * A dimension where either side has no measurement.
 *
 * Skipping such a dimension outright is what the ratchet does, and it is wrong here: an
 * attempt that broke its own coverage run would dodge the one dimension it was going to
 * lose. So a measured attempt outranks an unmeasured one, and no number is invented for the
 * unmeasured side. Where neither measured, there is nothing to compare and the dimension is
 * abstained on by name. The harness builds the same invocation for every attempt at a task,
 * so a missing artifact is that attempt's own tree, not the project's.
 */
function comparing(
  name: string,
  read: (attempt: RankedAttempt) => number | null,
  better: (a: number, b: number) => number,
): Dimension {
  return {
    name,
    read,
    compare(a, b) {
      const left = read(a);
      const right = read(b);
      if (left === null && right === null) {
        return 0;
      }
      if (left === null) {
        return 1;
      }
      if (right === null) {
        return -1;
      }
      return better(left, right);
    },
  };
}

const more = (a: number, b: number): number => b - a;
const fewer = (a: number, b: number): number => a - b;

/**
 * What "better attempt" means here, in the order it is asked.
 *
 * Four earn-it dimensions sit above every do-less one on purpose. A key that rewards
 * changing less is maximized by changing nothing, so leading with one would make "do less"
 * the decision rather than the tiebreak it should be. `changedLinesCovered` has no such
 * gradient: an attempt that changes nothing covers nothing. Parsimony still decides, but
 * only between attempts that already did equal measured work.
 *
 * `assertions` sits above `tests` so an empty test prices at zero. Neither is read off the
 * attempt's own file universe, which an attempt can widen by opening a large test file; both
 * come from a universe fixed across all the attempts first.
 *
 * The comparator picks the most disciplined green attempt. It cannot pick the most complete
 * one: no number here tells "did the whole task" from "did the minimum that passes its own
 * tests", and a number that could would be a judge.
 */
const dimensions: readonly Dimension[] = [
  comparing("testsCollected", (attempt) => attempt.testsCollected, more),
  comparing("assertions", (attempt) => attempt.assertions, more),
  comparing("tests", (attempt) => attempt.tests, more),
  comparing("skipMarkers", (attempt) => attempt.skipMarkers, fewer),
  comparing("changedLinesCovered", (attempt) => attempt.changedLinesCovered, more),
  comparing("uncoveredChangedLines", (attempt) => attempt.uncoveredChangedLines, fewer),
  comparing("erosions", (attempt) => attempt.erosions, fewer),
  comparing("changedFiles", (attempt) => attempt.changedFiles, fewer),
  comparing("addedLines", (attempt) => attempt.addedLines, fewer),
];

export function selectAttempt(taskId: string, attempts: readonly Attempt[]): AttemptSelection {
  const totals = totalsOverFixedUniverse(attempts.map((attempt) => attempt.measures));
  const ranked = attempts.map((attempt, index) =>
    rank(attempt, totals[index] ?? { tests: 0, assertions: 0, skips: 0 }),
  );

  const eligible = ranked.filter((one) => one.eligible).sort(byDimensions);
  const excluded = ranked.filter((one) => !one.eligible);
  const [winner, runnerUp] = eligible;

  return {
    taskId,
    baseCommit: attempts[0]?.baseCommit ?? "",
    attempts: [...eligible, ...excluded],
    order: eligible.map((one) => one.workerId),
    winner: winner?.workerId ?? null,
    decidedBy: winner === undefined || runnerUp === undefined ? null : separator(winner, runnerUp),
    abstentions: abstentions(eligible),
  };
}

function rank(attempt: Attempt, totals: UniverseTotals): RankedAttempt {
  const { changedLinesCovered, changedLinesMeasured } = attempt.measures;
  return {
    workerId: attempt.workerId,
    attemptIndex: attempt.attemptIndex,
    eligible: attempt.green && attempt.commit !== null,
    reason: exclusionReason(attempt),
    testsCollected: attempt.measures.testsCollected,
    assertions: totals.assertions,
    tests: totals.tests,
    skipMarkers: totals.skips,
    changedLinesCovered,
    uncoveredChangedLines:
      changedLinesCovered === null || changedLinesMeasured === null
        ? null
        : changedLinesMeasured - changedLinesCovered,
    erosions: attempt.erosions,
    changedFiles: attempt.changedFiles,
    addedLines: attempt.addedLines,
  };
}

function exclusionReason(attempt: Attempt): string | null {
  if (!attempt.green) {
    return "gates were not green";
  }
  if (attempt.commit === null) {
    return "the attempt proposed no commit";
  }
  return null;
}

/**
 * The earliest attempt wins a tie. Not the chain head, which hashes a timestamp and would
 * make the pick a coin flip that only reproduces under an injected clock.
 */
function byDimensions(a: RankedAttempt, b: RankedAttempt): number {
  const decided = dimensions.reduce(
    (verdict, dimension) => (verdict === 0 ? dimension.compare(a, b) : verdict),
    0,
  );
  return decided === 0 ? a.attemptIndex - b.attemptIndex : decided;
}

function separator(winner: RankedAttempt, runnerUp: RankedAttempt): string | null {
  return dimensions.find((dimension) => dimension.compare(winner, runnerUp) !== 0)?.name ?? null;
}

function abstentions(eligible: readonly RankedAttempt[]): readonly Abstention[] {
  if (eligible.length === 0) {
    return [];
  }
  return dimensions
    .filter((dimension) => eligible.every((attempt) => dimension.read(attempt) === null))
    .map((dimension) => ({ dimension: dimension.name, reason: "no attempt measured it" }));
}
