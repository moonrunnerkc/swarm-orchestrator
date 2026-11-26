/**
 * The runtime floor: Node 22.13, the floor of swarm-verify, which this program loads to verify
 * every run. Kept free of side effects so tests can read it.
 */
export const nodeFloor = { major: 22, minor: 13 } as const;

/** The one line to print and stop on, or null where the runtime is new enough to run at all. */
export function nodeFloorShortfall(version: string): string | null {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  const readable =
    major !== undefined && Number.isFinite(major) && minor !== undefined && Number.isFinite(minor);
  if (
    readable &&
    (major > nodeFloor.major || (major === nodeFloor.major && minor >= nodeFloor.minor))
  )
    return null;
  return `swarm needs Node ${nodeFloor.major}.${nodeFloor.minor} or newer and found ${version}.`;
}
