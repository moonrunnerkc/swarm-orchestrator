// Pure logic for the gating half of the adjudication loop: measuring how
// far the human labels agree with the AI labels, and projecting a
// multi-rater consensus into the GroundTruthLabel shape the scorer reads.
//
// The scorer (`scripts/corpus/score-real.ts`) reads
// `benchmarks/real-corpus/labels-v2/final/<id>.label.json` files in the
// GroundTruthLabel shape from `benchmarks/falsification-corpus/schema.ts`.
// That enum is NOT the labels-v2 rater enum, so promotion maps the
// overlap and refuses (records, never fabricates) the categories that
// have no v10 detector equivalent.

import type { DualArbiterLabel } from '../real-prs/lib/types';
import type { BrokenCategory, GroundTruthLabel } from '../../benchmarks/falsification-corpus/schema';
import { computePairKappa } from './compute-kappa';
import type { HumanLabelEntry, LabelsV2BrokenCategory } from './adjudicate-core';

/**
 * Per-PR AI broken projection from the agreed dual-arbiter consensus.
 * Only `agreed` findings vote: a PR is AI-broken if any agreed finding is
 * `true-cheat`, AI-clean if it has at least one agreed finding and all of
 * them are `false-alarm`. PRs whose only agreed findings are
 * debatable / insufficient-context (or that have no agreed findings, the
 * arbiter-split case) are absent from the map, not guessed.
 *
 * @param dualLabels the parsed `arbiter-labels-dual.json` array
 * @returns map of `${repo}#${prNumber}` to the AI broken verdict
 */
export function projectAiBrokenByPr(dualLabels: readonly DualArbiterLabel[]): Map<string, boolean> {
  const anyCheat = new Set<string>();
  const anyDecisive = new Set<string>();
  for (const label of dualLabels) {
    if (!label.agreed || label.verdict === null) continue;
    const prKey = `${label.repo}#${label.prNumber}`;
    if (label.verdict === 'true-cheat') {
      anyCheat.add(prKey);
      anyDecisive.add(prKey);
    } else if (label.verdict === 'false-alarm') {
      anyDecisive.add(prKey);
    }
  }
  const out = new Map<string, boolean>();
  for (const prKey of anyDecisive) out.set(prKey, anyCheat.has(prKey));
  return out;
}

/** Per-id human broken projection; `ambiguous` is excluded (absent). */
export function projectHumanBrokenById(entries: readonly HumanLabelEntry[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const e of entries) {
    if (e.verdict === 'broken') out.set(e.id, true);
    else if (e.verdict === 'clean') out.set(e.id, false);
  }
  return out;
}

export interface HumanAiAgreement {
  comparisons: number;
  kappa: number | null;
  humanBrokenShare: number;
  aiBrokenShare: number;
}

/**
 * Cohen's kappa between the human labels and the AI consensus, over the
 * ids both sides decided. The arbiter-split PRs in the queue have no AI
 * consensus by definition, so they do not contribute here; this number
 * measures human-vs-AI agreement on the PRs the arbiters already agreed
 * on and a human also happened to label. `comparisons` is surfaced so a
 * small or empty overlap is visible rather than hidden behind a kappa.
 *
 * @param humanEntries every human label across raters
 * @param dualLabels   the dual-arbiter output
 * @param idByPrKey    maps `${repo}#${prNumber}` to the corpus id
 * @returns the overlap size, kappa, and each side's broken share
 */
export function humanVsAiKappa(
  humanEntries: readonly HumanLabelEntry[],
  dualLabels: readonly DualArbiterLabel[],
  idByPrKey: ReadonlyMap<string, string>,
): HumanAiAgreement {
  const humanById = projectHumanBrokenById(humanEntries);
  const aiByPr = projectAiBrokenByPr(dualLabels);
  const aiById = new Map<string, boolean>();
  for (const [prKey, broken] of aiByPr) {
    const id = idByPrKey.get(prKey);
    if (id !== undefined) aiById.set(id, broken);
  }
  const k = computePairKappa(humanById, aiById);
  const shared = [...humanById.keys()].filter((id) => aiById.has(id));
  const humanBroken = shared.filter((id) => humanById.get(id) === true).length;
  const aiBroken = shared.filter((id) => aiById.get(id) === true).length;
  const n = shared.length;
  return {
    comparisons: k.comparisons,
    kappa: k.kappa,
    humanBrokenShare: n === 0 ? 0 : humanBroken / n,
    aiBrokenShare: n === 0 ? 0 : aiBroken / n,
  };
}

/**
 * labels-v2 rater category to GroundTruthLabel category. Only the overlap
 * is mapped; `security-defect`, `documentation-only`, and `style-only`
 * have no v10 detector and are intentionally absent so the promote path
 * reports them instead of inventing a target.
 */
export const LABELS_V2_TO_GROUND_TRUTH: Readonly<Partial<Record<LabelsV2BrokenCategory, BrokenCategory>>> =
  {
    'goal-not-fixed': 'goal-not-fixed',
    regression: 'regression',
    'cheat-hardcoded-answer': 'cheat-hardcoded-answer',
    'cheat-test-modification': 'cheat-test-modification',
    'cheat-exception-swallowing': 'cheat-exception-swallowing',
    'cheat-mock-of-hallucination': 'cheat-mock-mutation',
    'concurrency-defect': 'concurrency-defect',
    'resource-leak': 'resource-leak',
  };

/** Split a rater category set into the mapped GroundTruthLabel categories
 * and the ones with no v10 equivalent. */
export function mapBrokenCategories(cats: readonly LabelsV2BrokenCategory[]): {
  mapped: BrokenCategory[];
  unmappable: LabelsV2BrokenCategory[];
} {
  const mapped = new Set<BrokenCategory>();
  const unmappable = new Set<LabelsV2BrokenCategory>();
  for (const c of cats) {
    const target = LABELS_V2_TO_GROUND_TRUTH[c];
    if (target === undefined) unmappable.add(c);
    else mapped.add(target);
  }
  return { mapped: [...mapped], unmappable: [...unmappable] };
}

export type PromoteDecision = 'promote' | 'drop' | 'insufficient';

export interface ConsensusResult {
  id: string;
  decision: PromoteDecision;
  verdict?: 'clean' | 'broken';
  brokenCategories?: BrokenCategory[];
  unmappable: LabelsV2BrokenCategory[];
  raterCount: number;
  reason: string;
}

export interface ConsensusOptions {
  minRaters: number;
  kappa: number | null;
  labeledAt: string;
}

/**
 * Resolve one PR's rater entries into a promote / drop / insufficient
 * decision following the methodology's "What final means" rule: enough
 * raters, a clear majority on the binary broken / clean projection, and a
 * tie drops the PR (the 2-2 split case). `ambiguous` raters abstain from
 * the vote rather than counting as a third bucket.
 *
 * @param id      the corpus id
 * @param entries every rater's label for this id
 * @param opts    the rater floor and the kappa stamped into the rationale
 * @returns the consensus result; never throws on a tie, it drops
 */
export function consensusForPr(
  id: string,
  entries: readonly HumanLabelEntry[],
  opts: ConsensusOptions,
): ConsensusResult {
  const raterCount = entries.length;
  if (raterCount < opts.minRaters) {
    return { id, decision: 'insufficient', unmappable: [], raterCount, reason: `only ${raterCount}/${opts.minRaters} raters labeled this PR` };
  }
  const broken = entries.filter((e) => e.verdict === 'broken');
  const clean = entries.filter((e) => e.verdict === 'clean');
  const voters = broken.length + clean.length;
  if (voters === 0) {
    return { id, decision: 'drop', unmappable: [], raterCount, reason: 'every rater marked ambiguous; no decisive vote' };
  }
  if (broken.length === clean.length) {
    return { id, decision: 'drop', unmappable: [], raterCount, reason: `tie ${broken.length}-${clean.length} on broken vs clean (2-2 split rule)` };
  }
  if (clean.length > broken.length) {
    return { id, decision: 'promote', verdict: 'clean', unmappable: [], raterCount, reason: `majority clean ${clean.length}-${broken.length}` };
  }
  // Majority broken: union the rater categories, then map to the scorer enum.
  const rawCats = broken.flatMap((e) => e.brokenCategories ?? []);
  const { mapped, unmappable } = mapBrokenCategories(rawCats);
  if (mapped.length === 0) {
    return {
      id,
      decision: 'drop',
      unmappable,
      raterCount,
      reason: `majority broken ${broken.length}-${clean.length} but no category maps to a v10 detector (${unmappable.join(', ') || 'none given'})`,
    };
  }
  return {
    id,
    decision: 'promote',
    verdict: 'broken',
    brokenCategories: mapped,
    unmappable,
    raterCount,
    reason: `majority broken ${broken.length}-${clean.length}`,
  };
}

/**
 * Turn a promote consensus into a valid GroundTruthLabel. The rationale
 * records provenance in full sentences (the validator requires three) so
 * the promoted label is self-describing and passes the scorer's loader.
 */
export function groundTruthFromConsensus(
  result: ConsensusResult,
  kappa: number | null,
  labeledAt: string,
): GroundTruthLabel {
  const kappaText = kappa === null ? 'single-rater bootstrap (kappa undefined)' : `pairwise kappa ${kappa.toFixed(3)}`;
  const rationale =
    `Promoted from labels-v2 human adjudication. ${result.raterCount} rater(s) labeled this PR and ${result.reason}. ` +
    `The rater pool cleared the agreement gate at ${kappaText}.`;
  const label: GroundTruthLabel = {
    verdict: result.verdict === 'broken' ? 'broken' : 'clean',
    rationale,
    labeledBy: 'labels-v2-consensus',
    labeledAt,
  };
  if (result.verdict === 'broken' && result.brokenCategories && result.brokenCategories.length > 0) {
    label.brokenCategories = result.brokenCategories;
  }
  return label;
}

export interface PromotionPlan {
  minRaters: number;
  kappa: number | null;
  promote: { id: string; label: GroundTruthLabel }[];
  dropped: ConsensusResult[];
  insufficient: ConsensusResult[];
}

/**
 * Build the full promotion plan from every rater's entries. Entries are
 * grouped by id, run through `consensusForPr`, and the promotable ones
 * are rendered into GroundTruthLabels. Dropped and insufficient ids are
 * returned (not discarded) so the caller reports what the corpus excluded
 * and why.
 *
 * @param entriesByRater one entry list per rater
 * @param opts           the rater floor and the gate kappa
 * @returns the promote / drop / insufficient breakdown
 */
export function buildPromotionPlan(
  entriesByRater: ReadonlyMap<string, readonly HumanLabelEntry[]>,
  opts: ConsensusOptions,
): PromotionPlan {
  const byId = new Map<string, HumanLabelEntry[]>();
  for (const entries of entriesByRater.values()) {
    for (const e of entries) {
      const bucket = byId.get(e.id) ?? [];
      bucket.push(e);
      byId.set(e.id, bucket);
    }
  }
  const promote: { id: string; label: GroundTruthLabel }[] = [];
  const dropped: ConsensusResult[] = [];
  const insufficient: ConsensusResult[] = [];
  for (const id of [...byId.keys()].sort()) {
    const result = consensusForPr(id, byId.get(id)!, opts);
    if (result.decision === 'promote') promote.push({ id, label: groundTruthFromConsensus(result, opts.kappa, opts.labeledAt) });
    else if (result.decision === 'drop') dropped.push(result);
    else insufficient.push(result);
  }
  return { minRaters: opts.minRaters, kappa: opts.kappa, promote, dropped, insufficient };
}
