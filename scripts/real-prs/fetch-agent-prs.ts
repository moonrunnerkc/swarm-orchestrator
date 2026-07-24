// Build the agent corpus: merged PRs that the shipped pr-source
// fingerprinter attributes to an AI coding agent at high confidence.
// Selection runs two arms (pre-registration amendment 3): the unchanged
// per-vendor control sample, and a thin-review tier that pushes
// review-thinness qualifiers into the same vendor queries server-side.
// Every candidate is confirmed by running detectAgent on the PR's real
// metadata (title, body, branch, commits, authors), so the corpus is
// exactly "PRs the shipped fingerprinter would attribute". Writes
// sources.json plus the raw diffs, in the same shape the clean corpus
// uses, so the audit and arbiter stages run unchanged. The two arms are
// interleaved in the output order so every bounded batch slice samples
// both.
//
// Usage:
//   node dist/scripts/real-prs/fetch-agent-prs.js \
//     [--per-vendor 12] [--min-lines 10] [--max-lines 8000] [--months 12]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { detectAgent } from '../../src/audit/pr-source';
import {
  countPrReviews,
  countRepoContributors,
  fetchPrDiff,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  searchMergedPrsGlobal,
  type GlobalSearchPr,
  type RepoTarget,
} from './lib/github';
import { agentCorpusDir, agentDiffsDir, agentSourcesFile, repoSlug } from './lib/paths';
import type {
  AgentSourcePr,
  AgentSourcesFile,
  FetchArm,
  PrContextFeatures,
} from './lib/agent-types';

const log = getLogger('real-prs:fetch-agent');

/** One global search query per vendor. Author queries are exact; marker
 *  queries are the strongest body marker the fingerprinter keys on. The
 *  fingerprinter confirmation pass drops anything the search over-matched. */
export const VENDOR_QUERIES: ReadonlyArray<{ vendor: string; q: string }> = [
  { vendor: 'devin', q: 'is:pr is:merged author:devin-ai-integration[bot]' },
  { vendor: 'claude-code', q: 'is:pr is:merged "Generated with Claude Code" in:body' },
  { vendor: 'cursor', q: 'is:pr is:merged head:cursor/' },
  { vendor: 'codex-cli', q: 'is:pr is:merged head:codex/' },
  { vendor: 'copilot-workspace', q: 'is:pr is:merged author:copilot-swe-agent[bot]' },
  { vendor: 'openhands', q: 'is:pr is:merged author:openhands-agent[bot]' },
  { vendor: 'aider', q: 'is:pr is:merged "aider.chat" in:body' },
  { vendor: 'replit-agent', q: 'is:pr is:merged author:replit-agent[bot]' },
];

/** Server-side review-thinness qualifiers (amendment 3): no submitted
 *  reviews, zero issue comments. Review-comment count and author-merge
 *  have no search qualifier and are confirmed locally from the PR detail. */
export const THIN_REVIEW_QUALIFIERS = 'review:none comments:0';

/** The thin-review tier: every vendor query with the thinness qualifiers
 *  appended. Derived, so the control queries stay byte-identical to the
 *  pre-amendment sample. */
export const THIN_REVIEW_QUERIES: ReadonlyArray<{ vendor: string; q: string }> =
  VENDOR_QUERIES.map(({ vendor, q }) => ({ vendor, q: `${q} ${THIN_REVIEW_QUALIFIERS}` }));

// Skip our own repos (dogfooding would bias the sample) and forks of this
// project. Anthropic-org repos are skipped for the same arbiter-independence
// reason the clean corpus documents.
export const EXCLUDED_OWNERS = new Set(['moonrunnerkc', 'anthropics', 'anthropic-experimental']);

/** Dependency-update bots (amendment 3). The thin-review qualifiers select
 *  for unattended merges, which is also where automated version bumps live;
 *  both arms exclude these authors so the sample stays agent-authored code
 *  changes, not bump noise. */
const DEPENDENCY_BOT_AUTHOR =
  /^(dependabot|dependabot-preview|renovate|renovate-bot|mend|greenkeeper|snyk-bot|depfu|pyup|pyup-bot|scala-steward)(\[bot\])?$/i;

/**
 * Whether a PR author is a dependency-update bot. Narrower than the
 * general bot check on purpose: the vendor queries target agent bot
 * accounts, so only the named dependency bots are excluded here.
 *
 * @param login the PR author's login.
 * @returns true when the author is a dependency-update bot.
 */
export function isDependencyBot(login: string): boolean {
  return DEPENDENCY_BOT_AUTHOR.test(login);
}

/** The raw fields the context features derive from. Everything comes from
 *  the detail fetch the corpus already does, plus the two one-call counts. */
export interface ContextFeatureInputs {
  repoStars: number;
  contributorCount: number | null;
  reviewCount: number | null;
  reviewCommentCount: number;
  createdAt: string;
  mergedAt: string | null;
  mergedByLogin: string | null;
  authorLogin: string;
}

/**
 * Derive the per-PR context features recorded in every funnel record
 * (amendment 3). Pure so the derivation is unit-tested without a network.
 *
 * @param inputs the raw fields from the PR detail and the count calls.
 * @returns the features; duration and merged-by are null when the source
 *   field is missing.
 */
export function buildContextFeatures(inputs: ContextFeatureInputs): PrContextFeatures {
  const created = Date.parse(inputs.createdAt);
  const merged = inputs.mergedAt === null ? Number.NaN : Date.parse(inputs.mergedAt);
  const openToMergeHours =
    Number.isFinite(created) && Number.isFinite(merged)
      ? Math.round(((merged - created) / 3_600_000) * 10) / 10
      : null;
  const mergedByAuthor =
    inputs.mergedByLogin === null || inputs.authorLogin.length === 0
      ? null
      : inputs.mergedByLogin.toLowerCase() === inputs.authorLogin.toLowerCase();
  return {
    repoStars: inputs.repoStars,
    contributorCount: inputs.contributorCount,
    reviewCount: inputs.reviewCount,
    reviewCommentCount: inputs.reviewCommentCount,
    openToMergeHours,
    mergedByAuthor,
  };
}

/**
 * The thin-review arm's local confirmation (amendment 3): zero submitted
 * reviews, zero review comments, and the author merged their own PR. The
 * search qualifiers cannot express the last two, so a thin candidate that
 * fails here is dropped and counted, never kept mislabeled.
 *
 * @param context the derived context features.
 * @returns true when the PR is confirmed thin-review.
 */
export function confirmsThinReview(context: PrContextFeatures): boolean {
  return (
    context.reviewCount === 0 &&
    context.reviewCommentCount === 0 &&
    context.mergedByAuthor === true
  );
}

/**
 * Interleave the two arms' entries so any contiguous batch slice of the
 * output samples both. Alternates control/thin, then appends whichever
 * arm ran longer.
 *
 * @param control the control-arm entries, fetch order preserved.
 * @param thin the thin-review entries, fetch order preserved.
 * @returns one array alternating between the arms.
 */
export function interleaveArms(
  control: AgentSourcePr[],
  thin: AgentSourcePr[],
): AgentSourcePr[] {
  const out: AgentSourcePr[] = [];
  const longest = Math.max(control.length, thin.length);
  for (let i = 0; i < longest; i += 1) {
    const c = control[i];
    const t = thin[i];
    if (c !== undefined) out.push(c);
    if (t !== undefined) out.push(t);
  }
  return out;
}

interface Args {
  perVendor: number;
  minLines: number;
  maxLines: number;
  months: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { perVendor: 12, minLines: 10, maxLines: 8_000, months: 12 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--per-vendor' && next !== undefined) (args.perVendor = Number(next)), (i += 1);
    else if (a === '--min-lines' && next !== undefined) (args.minLines = Number(next)), (i += 1);
    else if (a === '--max-lines' && next !== undefined) (args.maxLines = Number(next)), (i += 1);
    else if (a === '--months' && next !== undefined) (args.months = Number(next)), (i += 1);
  }
  return args;
}

function mergedAfterIso(months: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - months, now.getDate()).toISOString().slice(0, 10);
}

interface FetchState {
  octokit: ReturnType<typeof makeOctokit>;
  args: Args;
  since: string;
  seen: Set<string>;
  skipped: Array<{ vendor: string; reason: string; count: number }>;
  /** Contributor counts cached per repo so one repo's PRs cost one call. */
  contributorCache: Map<string, number | null>;
}

async function contributorCount(state: FetchState, repo: string, target: RepoTarget): Promise<number | null> {
  const cached = state.contributorCache.get(repo);
  if (cached !== undefined) return cached;
  const count = await countRepoContributors(state.octokit, target);
  state.contributorCache.set(repo, count);
  return count;
}

/** Run one arm's queries. The control arm runs first, so a PR matching
 *  both arms keeps its control label and the control sample's composition
 *  stays what it was before amendment 3 (the amendment's assignment rule). */
async function fetchArm(
  state: FetchState,
  arm: FetchArm,
  queries: ReadonlyArray<{ vendor: string; q: string }>,
): Promise<AgentSourcePr[]> {
  const { octokit, args, since, seen, skipped } = state;
  const prs: AgentSourcePr[] = [];
  for (const { vendor, q } of queries) {
    const query = `${q} merged:>=${since}`;
    let candidates: GlobalSearchPr[];
    try {
      // Over-fetch 4x the cap; the band and fingerprinter filters are strict.
      candidates = await searchMergedPrsGlobal(octokit, query, args.perVendor * 4);
    } catch (err) {
      log.warn(`search failed for ${arm}/${vendor}: ${(err as Error).message}`);
      skipped.push({ vendor, reason: `${arm}: search failed: ${(err as Error).message}`, count: 0 });
      continue;
    }
    log.info(`${arm}/${vendor}: ${candidates.length} search candidates`);
    let kept = 0;
    let dropped = 0;
    let notThin = 0;
    for (const c of candidates) {
      if (kept >= args.perVendor) break;
      const owner = c.repo.split('/')[0] ?? '';
      if (EXCLUDED_OWNERS.has(owner.toLowerCase())) continue;
      const dedupeKey = `${c.repo}#${c.number}`;
      if (seen.has(dedupeKey)) continue;

      const target = parseRepo(c.repo);
      let detail;
      let commits;
      try {
        detail = await octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: c.number });
        commits = await octokit.pulls.listCommits({ owner: target.owner, repo: target.repo, pull_number: c.number, per_page: 100 });
      } catch (err) {
        log.debug(`detail fetch failed for ${dedupeKey}: ${(err as Error).message}`);
        continue;
      }
      const authorLogin = detail.data.user?.login ?? c.author;
      if (isDependencyBot(authorLogin)) {
        dropped += 1;
        continue;
      }
      const changed = detail.data.additions + detail.data.deletions;
      if (changed < args.minLines || changed > args.maxLines) {
        dropped += 1;
        continue;
      }
      const attribution = detectAgent({
        prTitle: c.title,
        prBody: c.body,
        headRef: detail.data.head.ref,
        commitMessages: commits.data.map((m) => m.commit.message),
        authors: [
          authorLogin,
          ...commits.data.map((m) => m.author?.login ?? m.commit.author?.name ?? ''),
        ].filter((a) => a.length > 0),
      });
      if (attribution === undefined || attribution.confidence === 'low') {
        dropped += 1;
        continue;
      }
      const context = buildContextFeatures({
        repoStars: detail.data.base.repo.stargazers_count,
        contributorCount: await contributorCount(state, c.repo, target),
        reviewCount: await countPrReviews(octokit, target, c.number),
        reviewCommentCount: detail.data.review_comments,
        createdAt: detail.data.created_at,
        mergedAt: detail.data.merged_at,
        mergedByLogin: detail.data.merged_by?.login ?? null,
        authorLogin,
      });
      if (arm === 'thin-review' && !confirmsThinReview(context)) {
        notThin += 1;
        continue;
      }
      let diff: string;
      try {
        diff = await fetchPrDiff(octokit, target, c.number);
      } catch (err) {
        log.debug(`diff fetch failed for ${dedupeKey}: ${(err as Error).message}`);
        continue;
      }
      const slug = repoSlug(c.repo);
      const diffRel = path.join('diffs', slug, `${c.number}.diff`);
      fs.mkdirSync(path.join(agentDiffsDir(), slug), { recursive: true });
      fs.writeFileSync(path.join(agentCorpusDir(), diffRel), diff);
      seen.add(dedupeKey);
      kept += 1;
      prs.push({
        repo: c.repo,
        prNumber: c.number,
        headSha: detail.data.head.sha,
        title: c.title,
        bodyExcerpt: c.body.slice(0, 2_000),
        url: c.url,
        mergedAt: detail.data.merged_at ?? '',
        additions: detail.data.additions,
        deletions: detail.data.deletions,
        files: detail.data.changed_files,
        diffPath: diffRel,
        agent: attribution,
        searchVendor: vendor,
        arm,
        context,
      });
      log.info(
        `kept ${dedupeKey} [${arm}] (${attribution.vendor}/${attribution.confidence} via ${attribution.source}, ${changed} lines, ` +
          `stars ${context.repoStars}, reviews ${context.reviewCount ?? '?'})`,
      );
    }
    if (dropped > 0) {
      skipped.push({
        vendor,
        reason: `${arm}: dependency bot, outside line band, or fingerprinter did not confirm`,
        count: dropped,
      });
    }
    if (notThin > 0) {
      skipped.push({ vendor, reason: 'thin-review: failed local thinness confirmation', count: notThin });
    }
  }
  return prs;
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const since = mergedAfterIso(args.months);
  const state: FetchState = {
    octokit: makeOctokit(resolveGithubToken()),
    args,
    since,
    seen: new Set<string>(),
    skipped: [],
    contributorCache: new Map<string, number | null>(),
  };
  fs.mkdirSync(agentDiffsDir(), { recursive: true });

  const control = await fetchArm(state, 'per-vendor-control', VENDOR_QUERIES);
  const thin = await fetchArm(state, 'thin-review', THIN_REVIEW_QUERIES);
  const prs = interleaveArms(control, thin);

  const out: AgentSourcesFile = {
    fetchedAt: new Date().toISOString(),
    queries: [
      ...VENDOR_QUERIES.map((v) => `${v.q} merged:>=${since}`),
      ...THIN_REVIEW_QUERIES.map((v) => `${v.q} merged:>=${since}`),
    ],
    perVendorCap: args.perVendor,
    lineBand: { min: args.minLines, max: args.maxLines },
    skipped: state.skipped,
    prs,
  };
  fs.mkdirSync(agentCorpusDir(), { recursive: true });
  fs.writeFileSync(agentSourcesFile(), JSON.stringify(out, null, 2) + '\n');
  const byVendor = new Map<string, number>();
  for (const p of prs) byVendor.set(p.agent.vendor, (byVendor.get(p.agent.vendor) ?? 0) + 1);
  log.info(
    `agent corpus: ${prs.length} PRs, control ${control.length} / thin-review ${thin.length} ` +
      `(${[...byVendor.entries()].map(([v, n]) => `${v}:${n}`).join(', ')})`,
  );
}

// Guard the entry point so importing this module for its exported constants
// (VENDOR_QUERIES, EXCLUDED_OWNERS) does not trigger a live fetch as a side
// effect, the same guard outcome-labels.ts documents.
if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
