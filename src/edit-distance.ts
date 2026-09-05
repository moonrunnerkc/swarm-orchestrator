/**
 * Levenshtein distance, and the nearest of a set of names within a bound.
 *
 * One home, because the command parser and the gate assembler both answer the same question:
 * this word is not one of the names I know, is it close enough to one that the author meant
 * that one? Two copies of that answer drift on the bound.
 */
export function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1);
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

/** The closest candidate within `maxDistance`, or null where the word is close to none of them. */
export function nearestName(
  word: string,
  candidates: readonly string[],
  maxDistance = 2,
): string | null {
  let best: { name: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = editDistance(word.toLowerCase(), candidate.toLowerCase());
    if (distance > 0 && distance <= maxDistance && (best === null || distance < best.distance)) {
      best = { name: candidate, distance };
    }
  }
  return best?.name ?? null;
}
