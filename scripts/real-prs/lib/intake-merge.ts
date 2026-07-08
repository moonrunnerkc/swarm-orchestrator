// Merge and dedup mined-candidate files for the review package. Pure so it is
// unit-tested without a live run: multiple miner outputs (the endgame pass plus a
// re-mine) are unioned by id, deduped against each other, and deduped against the
// ids already frozen in the corpus so the package never re-offers an entry the
// maintainer already folded. Existence, not any arbiter verdict, decides entry.

import type { MinedCandidate } from './intake';

/** A miner output file: its funnel and its candidates. */
export interface MinedFile {
  readonly funnel: Record<string, number>;
  readonly candidates: readonly MinedCandidate[];
}

/** The merged candidate set plus the drop accounting the package reports. */
export interface MergeResult {
  readonly candidates: MinedCandidate[];
  readonly funnel: Record<string, number>;
  readonly droppedInCorpus: number;
  readonly droppedDuplicate: number;
}

/**
 * The identity key for dedup: the true PR (repo + number), not the miner id. Corpus
 * ids are vendor-prefixed (`claude-code-owner-repo-pr7`) while miner ids are not
 * (`owner-repo-pr7`), so keying on the id would miss the overlap. Keying on
 * repo#number matches an entry to its corpus twin regardless of id format.
 *
 * @param repo the owner/repo slug.
 * @param prNumber the PR number.
 * @returns the canonical `repo#number` dedup key.
 */
export function candidateKey(repo: string, prNumber: number): string {
  return `${repo}#${prNumber}`;
}

/**
 * Union the candidates across miner files, dedup by PR identity, and drop any PR
 * already in the frozen corpus. The first occurrence wins; funnel numbers are
 * summed field-wise across the files.
 *
 * @param files the miner outputs, in priority order (first occurrence wins).
 * @param corpusKeys the `repo#number` keys already folded into the corpus.
 * @returns the merged candidates, summed funnel, and the two drop counts.
 */
export function mergeMinedCandidates(
  files: readonly MinedFile[],
  corpusKeys: ReadonlySet<string>,
): MergeResult {
  const seen = new Set<string>();
  const candidates: MinedCandidate[] = [];
  const funnel: Record<string, number> = {};
  let droppedInCorpus = 0;
  let droppedDuplicate = 0;
  for (const f of files) {
    for (const [k, v] of Object.entries(f.funnel ?? {})) {
      if (typeof v === 'number') funnel[k] = (funnel[k] ?? 0) + v;
    }
    for (const c of f.candidates) {
      const key = candidateKey(c.repo, c.prNumber);
      if (corpusKeys.has(key)) {
        droppedInCorpus += 1;
        continue;
      }
      if (seen.has(key)) {
        droppedDuplicate += 1;
        continue;
      }
      seen.add(key);
      candidates.push(c);
    }
  }
  return { candidates, funnel, droppedInCorpus, droppedDuplicate };
}
