// Phase 2 denoise policy. The judge (gemma4:31b) reads each instance's diff
// and answers whether it contains a genuine cheat. Those verdicts are used to
// denoise the weak distant-supervision anchors: a revert-weak positive the
// judge says is NOT a cheat is a tangled or ghost-commit false positive (the
// known SZZ failure mode), so it is demoted to unlabeled. Ground-truth tiers
// (oracle, proven restoration) are never overridden by the judge; the clean
// pool stays unlabeled. The same verdicts serve as the judge labeling
// function for the label model, so this module only owns the label edit.
//
// Pure: it takes a dataset and a verdict map and returns a new dataset, so the
// policy is unit-testable without a model.

import { buildDataset } from './dataset';
import type { TriageDataset, TriageInstance } from './types';

export type JudgeVerdict = 'yes' | 'no' | 'unavailable';

/** One judge answer keyed to a triage instance id. */
export interface InstanceVerdict {
  readonly id: string;
  readonly verdict: JudgeVerdict;
  readonly reason?: string;
}

export interface DenoiseSummary {
  /** revert-weak positives the judge refuted and we demoted to unlabeled. */
  readonly demoted: number;
  /** revert-weak positives the judge confirmed as cheats. */
  readonly confirmed: number;
  /** revert-weak positives the judge could not answer (kept as weak positive). */
  readonly abstained: number;
}

export interface DenoiseResult {
  readonly dataset: TriageDataset;
  readonly summary: DenoiseSummary;
}

/**
 * Apply the denoise policy. Only revert-weak positives are eligible for
 * demotion; every other tier is returned unchanged. A demoted instance keeps
 * its revert-weak tier (provenance is preserved) but flips to label unlabeled.
 *
 * @param dataset the mined PU dataset
 * @param verdicts the judge verdicts, by instance id
 * @returns the denoised dataset and a summary of what changed
 */
export function applyDenoise(
  dataset: TriageDataset,
  verdicts: readonly InstanceVerdict[],
): DenoiseResult {
  const byId = new Map<string, JudgeVerdict>();
  for (const v of verdicts) byId.set(v.id, v.verdict);

  let demoted = 0;
  let confirmed = 0;
  let abstained = 0;

  const next: TriageInstance[] = dataset.instances.map((inst) => {
    if (inst.tier !== 'revert-weak' || inst.label !== 'positive') return inst;
    const verdict = byId.get(inst.id) ?? 'unavailable';
    if (verdict === 'no') {
      demoted += 1;
      return { ...inst, label: 'unlabeled' };
    }
    if (verdict === 'yes') confirmed += 1;
    else abstained += 1;
    return inst;
  });

  return {
    dataset: buildDataset(next),
    summary: { demoted, confirmed, abstained },
  };
}
