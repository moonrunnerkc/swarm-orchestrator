// Ranking metrics for the triage evaluation. The triage system is scored as a
// ranker, not an exact-match classifier: PR-AUC (average precision, the right
// summary when positives are rare) and recall at a fixed review budget (what
// fraction of cheats a reviewer who reads the top k% riskiest PRs would see).
//
// Pure and dependency-free. Ties are broken deterministically by descending
// score then ascending index, so a metric replays byte-identical.

/** A scored, labeled instance for evaluation. label is 1 (cheat) or 0 (clean). */
export interface ScoredInstance {
  readonly score: number;
  readonly label: 0 | 1;
}

/** Sort indices by descending score, ties broken by ascending original index. */
function rankOrder(items: readonly ScoredInstance[]): number[] {
  return items
    .map((_, i) => i)
    .sort((a, b) => (items[b].score - items[a].score) || a - b);
}

/**
 * Average precision (area under the precision-recall curve, the interpolation-
 * free step sum). Equals the mean of the precision values at each true
 * positive's rank. Returns 0 when there are no positives.
 */
export function averagePrecision(items: readonly ScoredInstance[]): number {
  const order = rankOrder(items);
  const totalPos = items.reduce((a, b) => a + b.label, 0);
  if (totalPos === 0) return 0;
  let tp = 0;
  let seen = 0;
  let sum = 0;
  for (const idx of order) {
    seen += 1;
    if (items[idx].label === 1) {
      tp += 1;
      sum += tp / seen; // precision at this positive's rank
    }
  }
  return sum / totalPos;
}

/**
 * Recall among the top `budgetFraction` of instances by score. A reviewer who
 * reads the riskiest budgetFraction of PRs catches this fraction of all cheats.
 *
 * @param items scored, labeled instances
 * @param budgetFraction the review budget in (0, 1], e.g. 0.1 for the top 10%
 */
export function recallAtBudget(items: readonly ScoredInstance[], budgetFraction: number): number {
  const totalPos = items.reduce((a, b) => a + b.label, 0);
  if (totalPos === 0) return 0;
  const k = Math.max(1, Math.round(items.length * budgetFraction));
  const order = rankOrder(items);
  let caught = 0;
  for (let i = 0; i < k && i < order.length; i += 1) {
    if (items[order[i]].label === 1) caught += 1;
  }
  return caught / totalPos;
}

/** Precision among the top `budgetFraction` of instances by score. */
export function precisionAtBudget(items: readonly ScoredInstance[], budgetFraction: number): number {
  const k = Math.max(1, Math.round(items.length * budgetFraction));
  const order = rankOrder(items);
  let tp = 0;
  let n = 0;
  for (let i = 0; i < k && i < order.length; i += 1) {
    n += 1;
    if (items[order[i]].label === 1) tp += 1;
  }
  return n === 0 ? 0 : tp / n;
}

/** The base rate of positives, the precision a random ranker would achieve. */
export function baseRate(items: readonly ScoredInstance[]): number {
  if (items.length === 0) return 0;
  return items.reduce((a, b) => a + b.label, 0) / items.length;
}
