/**
 * Two runtime floors, kept apart because they gate different things.
 *
 * The tool runs on Node 22. The changed-line coverage measurement does not: it spawns node's
 * test runner with `--test-isolation=process`, which Node 22 rejects as a bad option, and that
 * failure used to arrive an hour into a run as an error nobody could connect to their Node
 * version. So the whole tool was held to 24. Now only the measurement is, and below its floor
 * the coverage arm reports unmeasured with the reason named, which the ratchet cannot compare
 * and never renders as a pass (invariant 7).
 */
export const requiredNodeMajor = 22;
export const isolatedCoverageNodeMajor = 24;

/** The words a reader searches for when a run says coverage was not measured. */
export const isolatedCoverageFloorReason = "node version below the floor for isolated coverage";

function nodeMajorOf(version: string): number | null {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  return Number.isFinite(major) ? major : null;
}

/** The one line to print and stop on, or null where the runtime is new enough to run at all. */
export function nodeFloorShortfall(version: string): string | null {
  const major = nodeMajorOf(version);
  if (major !== null && major >= requiredNodeMajor) {
    return null;
  }
  return `swarm needs Node ${requiredNodeMajor} or newer and found ${version}.`;
}

/**
 * Why the process-isolated coverage measurement cannot be asked for on this runtime, or null
 * where it can. A version that cannot be read is below the floor: an arm that guessed it was
 * above would spawn the runner and read the bad-option failure as a run.
 */
export function isolatedCoverageShortfall(version: string): string | null {
  const major = nodeMajorOf(version);
  if (major !== null && major >= isolatedCoverageNodeMajor) {
    return null;
  }
  return (
    `${isolatedCoverageFloorReason}: found ${version}, and the coverage arm spawns node's test ` +
    `runner with --test-isolation=process, which needs Node ${isolatedCoverageNodeMajor} or newer`
  );
}
