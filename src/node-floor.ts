/**
 * The runtime floor, checked before anything else runs. It is one line rather than a stack
 * trace because the failure on an older Node used to arrive an hour in, from the coverage
 * cycle, as a bad-option error nobody could connect to their Node version.
 */
export const requiredNodeMajor = 24;

/** The one line to print and stop on, or null where the runtime is new enough. */
export function nodeFloorShortfall(version: string): string | null {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  if (Number.isFinite(major) && major >= requiredNodeMajor) {
    return null;
  }
  return (
    `swarm needs Node ${requiredNodeMajor} or newer and found ${version}: the coverage cycle ` +
    "spawns node's test runner with --test-isolation=process, which older versions reject."
  );
}

const shortfall = nodeFloorShortfall(process.version);
if (shortfall !== null) {
  process.stderr.write(`${shortfall}\n`);
  process.exit(1);
}
