// Cheap structural features of a unified diff, for the ranker. These let the
// ranker score a PR on shape (how much it changes, whether it touches tests)
// in addition to the labeling-function votes, so it can rank a PR the
// detectors only partially fired on rather than keying solely on their exact
// patterns. Counts come from the raw diff text, which is enough and avoids a
// parser dependency in the hot path.
//
// Pure and deterministic, so the feature vector replays byte-identical.

export const STRUCTURAL_FEATURE_NAMES: readonly string[] = [
  'log1p_chars',
  'num_files',
  'num_hunks',
  'log1p_additions',
  'log1p_deletions',
  'touches_test',
];

const TEST_PATH = /(^|\/)[^/]*\.(test|spec)\.[a-z]+|(^|\/)(tests?|__tests__|spec)\//i;

/**
 * Extract the structural feature vector from a unified diff, in
 * STRUCTURAL_FEATURE_NAMES order.
 *
 * @param diff the unified diff text
 */
export function structuralFeatures(diff: string): number[] {
  let files = 0;
  let hunks = 0;
  let additions = 0;
  let deletions = 0;
  let touchesTest = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      files += 1;
      if (TEST_PATH.test(line.slice(4))) touchesTest = 1;
    } else if (line.startsWith('@@')) {
      hunks += 1;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  }
  return [Math.log1p(diff.length), files, hunks, Math.log1p(additions), Math.log1p(deletions), touchesTest];
}
