// Intake and review-packaging for complaint-mined candidates. The miner
// (mine-complaints.ts) writes agent-attributed complaint PRs with a dual-arbiter
// category verdict; this module enriches each with the metadata a maintainer
// review needs (head/base SHA, EG-viability, a content-addressed evidence id),
// renders the review package, and converts an approved record into a corpus
// entry. The review-then-fold contract is enforced downstream: nothing here
// folds; the fold is a separate, maintainer-driven command.
//
// The pure functions live here so they are unit-testable without a live GitHub
// call; the live enrichment (SHA + viability fetch) and the fold IO are the thin
// shells in intake-package.ts and fold-approved.ts.

import * as crypto from 'crypto';
import type { ViabilityRecord } from '../eg-viability-screen';
import type { WildCheatDataset, WildCheatEntry } from './wild-cheat-corpus';

/** One matched complaint signal, as the miner records it. */
export interface MinedComplaint {
  readonly category: string;
  readonly phrase: string;
  readonly source: string;
}

/** One arbiter's verdict on a candidate, as the miner records it. */
export interface MinedArbiterSide {
  readonly model: string;
  readonly verdict: string;
  readonly confidence: number;
}

/** The dual-arbiter block on a mined candidate. */
export interface MinedArbiter {
  readonly mode: 'dual' | 'off';
  readonly primary?: MinedArbiterSide;
  readonly secondary?: MinedArbiterSide;
  readonly agreed?: boolean;
  /** confirmed when both arbiters return true-cheat; null on a split or off. */
  readonly confirmed: boolean | null;
}

/** A candidate as written by mine-complaints.ts. */
export interface MinedCandidate {
  readonly id: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly url: string;
  readonly vendor: string;
  readonly vendorConfidence: string;
  readonly vendorSource: string;
  readonly complaintCategory: string;
  readonly complaints: readonly MinedComplaint[];
  readonly arbiter: MinedArbiter;
}

/** A candidate enriched with intake metadata, ready for maintainer review. */
export interface IntakeRecord {
  readonly id: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly url: string;
  readonly vendor: string;
  readonly vendorConfidence: string;
  readonly vendorSource: string;
  readonly state: 'merged' | 'closed' | 'open';
  readonly headSha: string;
  readonly baseSha: string;
  readonly complaintCategory: string;
  readonly complaints: readonly MinedComplaint[];
  readonly arbiter: MinedArbiter;
  readonly egViable: boolean;
  readonly egViabilityReason: string;
  readonly egEcosystem: ViabilityRecord['ecosystem'];
  /** Repository-outcome label where computable at intake, else 'unknown'. */
  readonly outcome: string;
  /** sha256 over the entry's stable identifying fields (its evidence id). */
  readonly evidenceSha256: string;
  /** Review triage bucket, derived from the arbiter block. */
  readonly reviewBucket: 'arbiter-confirmed' | 'arbiter-split' | 'arbiter-unevaluable' | 'arbiter-not-cheat';
  readonly holdout: true;
}

/** The review package: the enriched records plus the funnel that produced them. */
export interface ReviewPackage {
  readonly generatedBy: string;
  readonly minedFrom: string;
  readonly funnel: Record<string, number>;
  readonly counts: {
    readonly total: number;
    readonly arbiterConfirmed: number;
    readonly arbiterSplit: number;
    readonly arbiterUnevaluable: number;
    readonly arbiterNotCheat: number;
    readonly egViable: number;
  };
  readonly records: readonly IntakeRecord[];
}

/**
 * Content-address a candidate over its stable identifying fields, so an entry
 * has a reproducible evidence id independent of when it was mined.
 *
 * @param fields the repo, PR number, both SHAs, category, and complaint phrases.
 * @returns the lowercase-hex sha256 of the canonical field set.
 */
export function canonicalEvidenceSha(fields: {
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  complaintCategory: string;
  complaints: readonly MinedComplaint[];
}): string {
  const canonical = JSON.stringify({
    repo: fields.repo,
    prNumber: fields.prNumber,
    headSha: fields.headSha,
    baseSha: fields.baseSha,
    complaintCategory: fields.complaintCategory,
    complaints: fields.complaints.map((c) => ({ category: c.category, phrase: c.phrase, source: c.source })),
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** The review triage bucket implied by a candidate's arbiter block. */
export function reviewBucketOf(arbiter: MinedArbiter): IntakeRecord['reviewBucket'] {
  if (arbiter.mode === 'off') return 'arbiter-unevaluable';
  if (arbiter.agreed === false) return 'arbiter-split';
  if (arbiter.confirmed === true) return 'arbiter-confirmed';
  return 'arbiter-not-cheat';
}

/**
 * Enrich a mined candidate into an intake record.
 *
 * @param candidate the mined candidate.
 * @param prState the PR's merged/closed/open state at intake.
 * @param sha the resolved head and base SHAs.
 * @param viability the static EG-viability screen result for the head SHA.
 * @returns the intake record with a content-addressed evidence id.
 */
export function buildIntakeRecord(
  candidate: MinedCandidate,
  prState: 'merged' | 'closed' | 'open',
  sha: { headSha: string; baseSha: string },
  viability: ViabilityRecord,
): IntakeRecord {
  return {
    id: candidate.id,
    repo: candidate.repo,
    prNumber: candidate.prNumber,
    url: candidate.url,
    vendor: candidate.vendor,
    vendorConfidence: candidate.vendorConfidence,
    vendorSource: candidate.vendorSource,
    state: prState,
    headSha: sha.headSha,
    baseSha: sha.baseSha,
    complaintCategory: candidate.complaintCategory,
    complaints: candidate.complaints,
    arbiter: candidate.arbiter,
    egViable: viability.viable,
    egViabilityReason: viability.reason,
    egEcosystem: viability.ecosystem,
    outcome: 'unknown',
    evidenceSha256: canonicalEvidenceSha({
      repo: candidate.repo,
      prNumber: candidate.prNumber,
      headSha: sha.headSha,
      baseSha: sha.baseSha,
      complaintCategory: candidate.complaintCategory,
      complaints: candidate.complaints,
    }),
    reviewBucket: reviewBucketOf(candidate.arbiter),
    holdout: true,
  };
}

/** Roll the intake records up into review counts, keyed by triage bucket. */
export function summarizeReview(records: readonly IntakeRecord[]): ReviewPackage['counts'] {
  const byBucket = (b: IntakeRecord['reviewBucket']): number =>
    records.filter((r) => r.reviewBucket === b).length;
  return {
    total: records.length,
    arbiterConfirmed: byBucket('arbiter-confirmed'),
    arbiterSplit: byBucket('arbiter-split'),
    arbiterUnevaluable: byBucket('arbiter-unevaluable'),
    arbiterNotCheat: byBucket('arbiter-not-cheat'),
    egViable: records.filter((r) => r.egViable).length,
  };
}

/** Review priority: confirmed first, then the cases that need a human call
 *  (split, unevaluable), then the arbiter-cleared remainder. */
const BUCKET_ORDER: Record<IntakeRecord['reviewBucket'], number> = {
  'arbiter-confirmed': 0,
  'arbiter-split': 1,
  'arbiter-unevaluable': 2,
  'arbiter-not-cheat': 3,
};

function arbiterVerdictLine(arbiter: MinedArbiter): string {
  if (arbiter.mode === 'off') return 'arbiter: unevaluable (diff not fetched)';
  const side = (s: MinedArbiterSide | undefined): string =>
    s === undefined ? 'n/a' : `${s.verdict} (${s.model}, conf ${s.confidence.toFixed(2)})`;
  const call =
    arbiter.confirmed === true
      ? 'CONFIRMED cheat'
      : arbiter.agreed === false
        ? 'SPLIT (disagreement)'
        : 'not a cheat';
  return `arbiter: ${call} — primary ${side(arbiter.primary)}; secondary ${side(arbiter.secondary)}`;
}

/**
 * Render the maintainer review package as Markdown: a funnel summary, the fold
 * command, and one section per candidate ordered by review priority.
 *
 * @param pkg the review package.
 * @param foldCommand the exact fold command a maintainer runs on approved ids.
 * @returns the Markdown document.
 */
export function renderReviewMarkdown(pkg: ReviewPackage, foldCommand: string): string {
  const c = pkg.counts;
  const ordered = [...pkg.records].sort(
    (a, b) =>
      BUCKET_ORDER[a.reviewBucket] - BUCKET_ORDER[b.reviewBucket] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const lines: string[] = [
    '# Complaint-mine review package',
    '',
    'Agent-attributed PRs a maintainer flagged with cheat-language, each verified',
    'against the fetched conversation and given a dual-arbiter category verdict.',
    'Nothing here is folded automatically: approve ids explicitly, then run the fold',
    'command. This corpus is the held-out set for the next pre-registered hunt, so',
    'do not diagnose entries before the pre-registration freezes them.',
    '',
    `Mined from \`${pkg.minedFrom}\` by \`${pkg.generatedBy}\`.`,
    '',
    '## Funnel',
    '',
    `Examined ${pkg.funnel.examined ?? 0}; agent-attributed complaint PRs confirmed ` +
      `${c.total}; dual-arbiter CONFIRMED **${c.arbiterConfirmed}**; splits ${c.arbiterSplit}; ` +
      `unevaluable ${c.arbiterUnevaluable}; arbiter-cleared (not a cheat) ${c.arbiterNotCheat}. ` +
      `EG-viable ${c.egViable}/${c.total}.`,
    '',
    '## Fold the ones you approve',
    '',
    'Review the sections below (confirmed and split first). Then fold exactly the',
    'ids you judge to be real cheats:',
    '',
    '```sh',
    foldCommand,
    '```',
    '',
    'An empty approval folds nothing and leaves the corpus version unchanged.',
    '',
    '## Candidates',
    '',
  ];
  for (const r of ordered) {
    const complaint = r.complaints[0];
    lines.push(
      `### ${r.id}`,
      '',
      `- PR: ${r.url} (${r.state})`,
      `- category (maintainer-named): **${r.complaintCategory}**`,
      `- agent: ${r.vendor} (${r.vendorConfidence}, via ${r.vendorSource})`,
      `- complaint: "${complaint?.phrase ?? '(none)'}" (${complaint?.source ?? 'n/a'})`,
      `- ${arbiterVerdictLine(r.arbiter)}`,
      `- EG-viability: ${r.egViable ? 'viable' : 'not viable'} — ${r.egViabilityReason}`,
      `- evidence sha256: \`${r.evidenceSha256}\``,
      `- SHAs: base \`${r.baseSha.slice(0, 12)}\` head \`${r.headSha.slice(0, 12)}\``,
      '',
    );
  }
  return lines.join('\n');
}

/**
 * Convert an approved intake record into a wild-cheat corpus entry. Fresh
 * entries carry no `diagnosed` marker and are always held out.
 *
 * @param r the approved intake record.
 * @returns the corpus entry for the fold.
 */
export function intakeToWildCheatEntry(r: IntakeRecord): WildCheatEntry {
  const state: 'merged' | 'closed' = r.state === 'merged' ? 'merged' : 'closed';
  return {
    id: r.id,
    repo: r.repo,
    prNumber: r.prNumber,
    url: r.url,
    state,
    vendor: r.vendor,
    vendorConfidence: r.vendorConfidence,
    headSha: r.headSha,
    baseSha: r.baseSha,
    complaintCategory: r.complaintCategory,
    complaints: r.complaints.map((c) => ({ category: c.category, phrase: c.phrase, source: c.source })),
    outcome: r.outcome,
    egViable: r.egViable,
    crossTaxonomy: 'unmapped (mined; bind on fold review)',
    holdout: true,
  };
}

/**
 * The next dataset version tag after the highest present one. Versions are
 * `v<N>`; the next is `v<N+1>`.
 *
 * @param versions the existing version dir names (e.g. ['v1']).
 * @returns the next version tag (e.g. 'v2').
 */
export function nextVersion(versions: readonly string[]): string {
  const majors = versions
    .map((v) => /^v(\d+)$/.exec(v))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  const next = (majors.length === 0 ? 0 : Math.max(...majors)) + 1;
  return `v${next}`;
}

/**
 * Build the folded dataset: the prior version's entries plus the approved
 * mined entries, deduplicated by id (an approved entry never shadows an existing
 * one; a duplicate id is dropped and the existing entry kept).
 *
 * @param existing the prior version's entries.
 * @param approved the approved mined entries to fold in.
 * @param version the new version tag.
 * @returns the new dataset with recomputed counts.
 */
export function buildFoldedDataset(
  existing: readonly WildCheatEntry[],
  approved: readonly WildCheatEntry[],
  version: string,
): WildCheatDataset {
  const seen = new Set(existing.map((e) => e.id));
  const fresh = approved.filter((e) => !seen.has(e.id));
  const entries = [...existing, ...fresh];
  return {
    version,
    generatedBy: 'scripts/real-prs/fold-approved.ts',
    note:
      `Wild cheat corpus ${version}: the prior version plus ${fresh.length} maintainer-approved ` +
      'complaint-mined entries. Fresh entries are held out; do not diagnose before the next ' +
      'hunt pre-registration freezes them.',
    counts: {
      entries: entries.length,
      merged: entries.filter((e) => e.state === 'merged').length,
      closed: entries.filter((e) => e.state === 'closed').length,
      egViable: entries.filter((e) => e.egViable).length,
      foldedThisVersion: fresh.length,
    },
    entries,
  };
}
