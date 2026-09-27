/**
 * Two runtime floors, kept apart because they gate different things.
 *
 * The tool runs on Node 22. The changed-line coverage measurement needs one thing more: it
 * spawns node's test runner with process isolation named on the command line, so the parent
 * captures each test's output and nothing a test prints reaches the reporter's stream at
 * column zero (invariant 7). Node 24 spells that flag `--test-isolation=process`. Node 22.8
 * through 23 spell it `--experimental-test-isolation=process`, and reject the other spelling
 * as a bad option; below 22.8 there is no spelling at all. The harness picks the spelling the
 * runtime accepts, confirms it on the vector it built, and below 22.8 the coverage arm reports
 * unmeasured with the reason named, which the ratchet cannot compare and never renders as a
 * pass. Each spelling was checked against the runtime that takes it, in
 * docs/verifier-first/node-22.md.
 */
export const requiredNodeMajor = 22;

/** The first release that lets the harness name process isolation on the command line. */
export const isolatedCoverageFloor = { major: 22, minor: 8 } as const;

/** The stable spelling, taken by Node 24 and newer. */
export const stableProcessIsolation = "--test-isolation=process";

/** The spelling Node 22.8 through 23 take, under which process isolation is also the default. */
export const experimentalProcessIsolation = "--experimental-test-isolation=process";

/** The words a reader searches for when a run says coverage was not measured. */
export const isolatedCoverageFloorReason = "node version below the floor for isolated coverage";

function parts(version: string): { readonly major: number; readonly minor: number } | null {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major !== undefined &&
    Number.isFinite(major) &&
    minor !== undefined &&
    Number.isFinite(minor)
    ? { major, minor }
    : null;
}

/** The one line to print and stop on, or null where the runtime is new enough to run at all. */
export function nodeFloorShortfall(version: string): string | null {
  const read = parts(version);
  if (read !== null && read.major >= requiredNodeMajor) {
    return null;
  }
  return `swarm needs Node ${requiredNodeMajor} or newer and found ${version}.`;
}

/**
 * The isolation flag this runtime accepts, or null below the floor. A version that cannot be
 * read is below the floor: an arm that guessed it was above would spawn the runner and read
 * the bad-option failure as a run.
 */
export function processIsolationFlag(version: string): string | null {
  const read = parts(version);
  if (read === null) return null;
  if (read.major >= 24) return stableProcessIsolation;
  if (
    read.major > isolatedCoverageFloor.major ||
    (read.major === isolatedCoverageFloor.major && read.minor >= isolatedCoverageFloor.minor)
  )
    return experimentalProcessIsolation;
  return null;
}

/**
 * Why the process-isolated coverage measurement cannot be asked for on this runtime, or null
 * where it can.
 */
export function isolatedCoverageShortfall(version: string): string | null {
  if (processIsolationFlag(version) !== null) {
    return null;
  }
  return (
    `${isolatedCoverageFloorReason}: found ${version}, and the coverage arm spawns node's test ` +
    `runner with process isolation named on the command line, which needs Node ` +
    `${isolatedCoverageFloor.major}.${isolatedCoverageFloor.minor} or newer`
  );
}
