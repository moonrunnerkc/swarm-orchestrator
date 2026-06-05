// Pure logic for the human-label adjudication loop. The CLI in
// `adjudicate.ts` does the filesystem I/O; everything decision-shaped
// lives here so it is testable without a corpus on disk.
//
// The loop has one purpose: take the findings where the two arbiter
// model families disagreed (`agreed === false` in the dual-arbiter
// output) and route them to a human, because those carry the most
// information per human minute. A human verdict on an arbiter-split PR
// is worth more than a human verdict on a PR the arbiters already
// agreed on.

import type { ArbiterVerdict, DualArbiterLabel } from '../real-prs/lib/types';

export type LabelVerdict = 'clean' | 'broken' | 'ambiguous';
export type LabelConfidence = 'high' | 'medium' | 'low';

/**
 * The broken-category vocabulary the labels-v2 schema accepts. Note this
 * is deliberately *not* the same enum as the scorer's GroundTruthLabel
 * (`benchmarks/falsification-corpus/schema.ts`): labels-v2 carries
 * rater-facing categories like `security-defect` that no v10 detector
 * keys on. The promote path in this module maps the overlap and reports
 * the rest, rather than pretending the two enums are identical.
 */
export type LabelsV2BrokenCategory =
  | 'goal-not-fixed'
  | 'regression'
  | 'cheat-hardcoded-answer'
  | 'cheat-test-modification'
  | 'cheat-exception-swallowing'
  | 'cheat-mock-of-hallucination'
  | 'concurrency-defect'
  | 'resource-leak'
  | 'security-defect'
  | 'documentation-only'
  | 'style-only';

export const LABELS_V2_BROKEN_CATEGORIES: readonly LabelsV2BrokenCategory[] = [
  'goal-not-fixed',
  'regression',
  'cheat-hardcoded-answer',
  'cheat-test-modification',
  'cheat-exception-swallowing',
  'cheat-mock-of-hallucination',
  'concurrency-defect',
  'resource-leak',
  'security-defect',
  'documentation-only',
  'style-only',
];

/** One rater's verdict on one PR; the labels-v2/<rater>/labels.jsonl line shape. */
export interface HumanLabelEntry {
  id: string;
  raterId: string;
  verdict: LabelVerdict;
  confidence: LabelConfidence;
  brokenCategories?: LabelsV2BrokenCategory[];
  rationale?: string;
  minutesSpent?: number;
  disputeNotes?: string;
}

/** A human decision before it is normalized into a HumanLabelEntry. */
export interface AdjudicationDecision {
  id: string;
  raterId: string;
  verdict: LabelVerdict;
  confidence: LabelConfidence;
  brokenCategories?: string[];
  rationale?: string;
  minutesSpent?: number;
  disputeNotes?: string;
}

/** The two whole-PR detectors fire high-volume at low precision; their
 * disagreements are worth less of a human's minute than a sharp
 * detector's. Mirrors `LOW_PRIORITY_CATEGORIES` in run-arbiter-dual. */
const LOW_PRIORITY_CATEGORIES: ReadonlySet<string> = new Set(['coverage-erosion', 'no-op-fix']);

export interface SplitFindingSummary {
  key: string;
  category: string;
  judgePath: string;
  primaryVerdict: ArbiterVerdict;
  secondaryVerdict: ArbiterVerdict;
}

export interface AdjudicationQueueRow {
  prKey: string;
  repo: string;
  prNumber: number;
  /** Resolved corpus id (`<vendor>-<owner>-<repo>-pr<n>`), or null when
   * the raw corpus is not on disk to resolve it. */
  id: string | null;
  splitFindings: SplitFindingSummary[];
  sharpSplitCount: number;
  infoScore: number;
}

export interface AdjudicationQueue {
  totalSplitFindings: number;
  rows: AdjudicationQueueRow[];
  /** PR keys whose corpus id could not be resolved (corpus absent). */
  unresolvedPrKeys: string[];
}

/** Resolves a `(repo, prNumber)` pair to a corpus entry id, or null. */
export type IdResolver = (repo: string, prNumber: number) => string | null;

/**
 * Build the adjudication queue from the dual-arbiter output. Only
 * `agreed === false` findings are surfaced (the arbiters disagreed, so a
 * human carries real information). Findings are grouped by PR, and PRs
 * are ordered highest-information-first: a PR with more sharp-detector
 * splits sorts ahead of one with a single coverage-erosion split.
 *
 * @param dualLabels the parsed `arbiter-labels-dual.json` array
 * @param resolveId  maps `(repo, prNumber)` to a corpus id, or null when
 *                   the raw corpus is not available to resolve it
 * @returns the queue, sorted by descending info score then PR key
 */
export function buildAdjudicationQueue(
  dualLabels: readonly DualArbiterLabel[],
  resolveId: IdResolver,
): AdjudicationQueue {
  const byPr = new Map<string, AdjudicationQueueRow>();
  let totalSplit = 0;
  for (const label of dualLabels) {
    if (label.agreed) continue;
    totalSplit += 1;
    const prKey = `${label.repo}#${label.prNumber}`;
    let row = byPr.get(prKey);
    if (row === undefined) {
      row = {
        prKey,
        repo: label.repo,
        prNumber: label.prNumber,
        id: resolveId(label.repo, label.prNumber),
        splitFindings: [],
        sharpSplitCount: 0,
        infoScore: 0,
      };
      byPr.set(prKey, row);
    }
    row.splitFindings.push({
      key: label.key,
      category: label.category,
      judgePath: label.judgePath,
      primaryVerdict: label.primary.verdict,
      secondaryVerdict: label.secondary.verdict,
    });
    if (!LOW_PRIORITY_CATEGORIES.has(label.category)) row.sharpSplitCount += 1;
  }
  const rows = [...byPr.values()];
  for (const row of rows) {
    row.infoScore = row.sharpSplitCount * 2 + row.splitFindings.length;
  }
  rows.sort((a, b) => b.infoScore - a.infoScore || a.prKey.localeCompare(b.prKey));
  const unresolvedPrKeys = rows.filter((r) => r.id === null).map((r) => r.prKey).sort();
  return { totalSplitFindings: totalSplit, rows, unresolvedPrKeys };
}

/**
 * Render a fill-in worksheet from the queue, one block per PR with the
 * arbiter split shown so a human sees what the two model families
 * disagreed on. Pure: the CLI writes the returned string to disk.
 *
 * @param queue the built adjudication queue
 * @returns the Markdown worksheet text
 */
export function renderWorksheet(queue: AdjudicationQueue): string {
  const lines: string[] = [];
  lines.push('# Adjudication worksheet (arbiter-split findings)');
  lines.push('');
  lines.push(
    `${queue.rows.length} PRs, ${queue.totalSplitFindings} split findings. ` +
      'Mark each PR clean / broken / ambiguous. Copy your verdicts into a ' +
      'decisions.json array and run `adjudicate apply`.',
  );
  if (queue.unresolvedPrKeys.length > 0) {
    lines.push('');
    lines.push(
      `> ${queue.unresolvedPrKeys.length} PR(s) had no corpus id (raw corpus absent); ` +
        'their `id` is blank below and must be filled before apply.',
    );
  }
  for (const row of queue.rows) {
    lines.push('');
    lines.push(`## ${row.prKey} (info ${row.infoScore}, sharp splits ${row.sharpSplitCount})`);
    lines.push(`- id: ${row.id ?? '(unresolved, fill in)'}`);
    for (const f of row.splitFindings) {
      lines.push(
        `- split [${f.category}/${f.judgePath}] primary=${f.primaryVerdict} ` +
          `secondary=${f.secondaryVerdict}`,
      );
    }
    lines.push('- verdict: ');
    lines.push('- confidence: ');
    lines.push('- brokenCategories: ');
    lines.push('- rationale: ');
  }
  return lines.join('\n') + '\n';
}

/**
 * Validate a human decision against the labels-v2 rubric. Returns the
 * list of human-readable violations; an empty list means the decision is
 * writable. Mirrors `benchmarks/real-corpus/labels-v2/schema.json`.
 *
 * @param decision the raw decision a rater entered
 * @returns the violations, empty when valid
 */
export function validateDecision(decision: AdjudicationDecision): string[] {
  const errors: string[] = [];
  if (!/^[A-Za-z0-9._-]+$/.test(decision.id ?? '')) {
    errors.push('id must match ^[A-Za-z0-9._-]+$ and be non-empty');
  }
  if (!/^rater-[0-9]{3,}$/.test(decision.raterId ?? '')) {
    errors.push('raterId must match ^rater-[0-9]{3,}$ (e.g. rater-001)');
  }
  if (!['clean', 'broken', 'ambiguous'].includes(decision.verdict)) {
    errors.push('verdict must be one of clean, broken, ambiguous');
  }
  if (!['high', 'medium', 'low'].includes(decision.confidence)) {
    errors.push('confidence must be one of high, medium, low');
  }
  const cats = decision.brokenCategories ?? [];
  const allowed = new Set<string>(LABELS_V2_BROKEN_CATEGORIES);
  const unknown = cats.filter((c) => !allowed.has(c));
  if (unknown.length > 0) {
    errors.push(`unknown brokenCategories: ${unknown.join(', ')}`);
  }
  if (decision.verdict === 'broken' && cats.length === 0) {
    errors.push('broken verdict requires at least one brokenCategory');
  }
  if (decision.verdict !== 'broken' && cats.length > 0) {
    errors.push('brokenCategories may only be set when verdict is broken');
  }
  if (
    (decision.verdict === 'broken' || decision.verdict === 'ambiguous') &&
    (decision.rationale ?? '').trim().length === 0
  ) {
    errors.push('rationale is required on broken and ambiguous verdicts');
  }
  if (decision.minutesSpent !== undefined && !Number.isInteger(decision.minutesSpent)) {
    errors.push('minutesSpent must be an integer when present');
  }
  return errors;
}

/**
 * Normalize a validated decision into the labels.jsonl entry shape,
 * dropping empty optional fields so the JSONL stays clean.
 *
 * @param decision a decision that already passed validateDecision
 * @returns the entry to append to a rater's labels.jsonl
 */
export function entryFromDecision(decision: AdjudicationDecision): HumanLabelEntry {
  const entry: HumanLabelEntry = {
    id: decision.id,
    raterId: decision.raterId,
    verdict: decision.verdict,
    confidence: decision.confidence,
  };
  if (decision.verdict === 'broken' && decision.brokenCategories && decision.brokenCategories.length > 0) {
    entry.brokenCategories = decision.brokenCategories as LabelsV2BrokenCategory[];
  }
  if ((decision.rationale ?? '').trim().length > 0) entry.rationale = decision.rationale!.trim();
  if (decision.minutesSpent !== undefined) entry.minutesSpent = decision.minutesSpent;
  if ((decision.disputeNotes ?? '').trim().length > 0) entry.disputeNotes = decision.disputeNotes!.trim();
  return entry;
}

/**
 * Merge new entries into a rater's existing labels.jsonl set. Existing
 * ids are kept unless `replace` is set, in which case the new entry wins.
 * Returns the merged list plus which ids were added vs. skipped so the
 * caller can report honestly.
 *
 * @param existing the rater's current entries
 * @param incoming the validated entries to merge in
 * @param replace  when true, an incoming entry overwrites a same-id entry
 * @returns the merged entries and the add/skip/replace breakdown
 */
export function mergeRaterEntries(
  existing: readonly HumanLabelEntry[],
  incoming: readonly HumanLabelEntry[],
  replace: boolean,
): { merged: HumanLabelEntry[]; added: string[]; skipped: string[]; replaced: string[] } {
  const byId = new Map<string, HumanLabelEntry>(existing.map((e) => [e.id, e]));
  const added: string[] = [];
  const skipped: string[] = [];
  const replaced: string[] = [];
  for (const entry of incoming) {
    if (byId.has(entry.id)) {
      if (replace) {
        byId.set(entry.id, entry);
        replaced.push(entry.id);
      } else {
        skipped.push(entry.id);
      }
    } else {
      byId.set(entry.id, entry);
      added.push(entry.id);
    }
  }
  const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { merged, added, skipped, replaced };
}
