/**
 * The arms a run could actually reach.
 *
 * A calibration outlives the machine it was measured on. A local arm whose model is no longer
 * served can never be tried, and an arm with no samples is exactly the one UCB reaches for
 * first, so it won the routing every time and was swapped out again every time: the reader was
 * told about a model that is not on this machine, and the arm never earned the sample that
 * would have stopped it being picked again.
 *
 * Not knowing is not the same as knowing a model is absent, so an endpoint that would not say
 * what it serves filters nothing, and neither does a filter that would leave nothing to route
 * between.
 */
const localPrefix = "local:";

export function servableCandidates(
  candidates: readonly string[],
  served: ReadonlySet<string> | null,
): readonly string[] {
  if (served === null || served.size === 0) {
    return candidates;
  }
  const reachable = candidates.filter(
    (candidate) =>
      !candidate.startsWith(localPrefix) || served.has(candidate.slice(localPrefix.length)),
  );
  return reachable.length > 0 ? reachable : candidates;
}
