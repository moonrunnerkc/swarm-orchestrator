// Outcome-grounded labels for the real-PR corpus. Ground truth comes from
// repository history alone, never from a model opinion or a human rating: for
// every corpus entry we ask git/GitHub whether the landed change was later
// reverted, hotfixed, or left standing.
//
// IMPORTANT — the corpus is commit-grounded, not PR-grounded. The entries are
// agent-attributed *commits* (the `headRef` is frequently `main`; the
// `pr.number` does not resolve to a merged upstream PR). The reliable anchor is
// `pr.headSha`, a real commit in the repo's history. So outcome detection keys
// on the commit sha, the form a `git revert` and a follow-up commit actually
// reference, not on a PR number.
//
//   - reverted: a later commit whose message is `This reverts commit <headSha>`.
//   - hotfixed: a follow-up commit within N days (default 30) of the landed
//     commit that modifies the same source lines the change touched
//     (line-range overlap on a shared file).
//   - survived: the commit is reachable from the default branch and none of the
//     above was found.
//   - indeterminate: the commit/repo history could not be read (deleted,
//     private, 404), or the commit is not reachable from the default branch
//     (never actually merged). Excluded from scoring and reported, never
//     silently treated as clean.
//
// Every non-survived label carries its evidence (the reverting/hotfixing commit
// sha and, for a hotfix, the overlapping file:line ranges) so a reviewer can
// re-derive it with `git log` alone.
//
// Reuse, not fork: the revert match is the shared `messageRevertsSha` helper in
// the real-prs github lib (the same module the block-eligibility miner uses),
// and the line-overlap math is `extractChangedLineRanges` from the diff walker.
//
// The run is resumable: each entry's resolved label is cached under
// `benchmarks/real-corpus/outcome-cache/`, so a re-run only re-queries entries
// not yet resolved (or all of them with --refresh). The summary
// (`outcome-labels.json`) is rebuilt from the cache every run.
//
// Usage:
//   node dist/scripts/labeling/outcome-labels.js [--refresh]
//     [--hotfix-window-days 30] [--limit N] [--only <id-substring>]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { SwarmError } from '../../src/errors';
import {
  makeOctokit,
  messageRevertsSha,
  parseRepo,
  resolveGithubToken,
} from '../real-prs/lib/github';
import {
  extractChangedLineRanges,
  type ChangedLineRanges,
  type LineRange,
} from '../../src/audit/cheat-detector/diff-walker';
import { loadPrCorpus, loadLabeledPrEntries } from '../../benchmarks/real-corpus/loader';
import type { PrCorpusEntry } from '../../benchmarks/real-corpus/schema';

const log = getLogger('labeling:outcome');

type Outcome = 'reverted' | 'hotfixed' | 'survived' | 'indeterminate';

export interface OutcomeEvidence {
  kind: 'revert-commit' | 'hotfix-commit';
  /** The reverting / hotfixing commit sha. */
  ref: string;
  /** Human-readable detail: the matching text, or the overlapping ranges. */
  detail: string;
}

interface OutcomeLabel {
  id: string;
  repo: string;
  headSha: string;
  outcome: Outcome;
  /** Set only when outcome === 'indeterminate'. */
  indeterminateReason?: string;
  landedAt: string | null;
  defaultBranch: string | null;
  /** The compare(default-branch...headSha) status, kept as evidence rather than
   *  a gate. `diverged`/`ahead` is the normal signature of a squash-merge (the
   *  vendored sha is the pre-merge branch tip; the change landed on the default
   *  branch under a different squashed sha), so it is NOT treated as unmerged —
   *  the corpus collector already filtered to merged PRs. `unverified` means the
   *  compare call 422'd (too-distant commit). */
  reachability: 'identical' | 'behind' | 'ahead' | 'diverged' | 'unverified';
  evidence: OutcomeEvidence[];
  /** Whether the bounded hotfix scan hit its cap (so a "survived" label is
   *  "survived as far as the bounded scan saw"). */
  scanLimited: boolean;
  /** The pre-existing AI label, kept verbatim for agreement reporting. */
  aiVerdict: 'clean' | 'broken' | 'ambiguous';
  aiCategories: string[];
  resolvedAt: string;
}

interface Args {
  refresh: boolean;
  hotfixWindowDays: number;
  limit: number | null;
  only: string | null;
}

function parseArgs(argv: string[]): Args {
  let refresh = false;
  let hotfixWindowDays = 30;
  let limit: number | null = null;
  let only: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--refresh') refresh = true;
    else if (a === '--hotfix-window-days' && next !== undefined) (hotfixWindowDays = Number(next)), (i += 1);
    else if (a === '--limit' && next !== undefined) (limit = Number(next)), (i += 1);
    else if (a === '--only' && next !== undefined) (only = next), (i += 1);
  }
  return { refresh, hotfixWindowDays, limit, only };
}

const RAW_DIR = path.join('benchmarks', 'real-corpus', 'raw');
const LABELS_DIR = path.join('benchmarks', 'real-corpus', 'labels');
const CACHE_DIR = path.join('benchmarks', 'real-corpus', 'outcome-cache');
const OUT_FILE = path.join('benchmarks', 'real-corpus', 'outcome-labels.json');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// --- minimal octokit shapes (avoids depending on @octokit's deep types) ---

interface CommitData {
  sha: string;
  html_url: string;
  commit: { message: string; committer: { date?: string } | null; author: { date?: string } | null };
  stats?: { total?: number };
  files?: { filename: string; patch?: string }[];
}

export interface OctokitLike {
  repos: {
    get(p: { owner: string; repo: string }): Promise<{ data: { default_branch: string } }>;
    getCommit(p: { owner: string; repo: string; ref: string }): Promise<{ data: CommitData }>;
    listCommits(p: {
      owner: string;
      repo: string;
      sha?: string;
      path?: string;
      since?: string;
      until?: string;
      per_page: number;
    }): Promise<{ data: { sha: string }[] }>;
    compareCommits(p: { owner: string; repo: string; base: string; head: string }): Promise<{
      data: { status: string };
    }>;
  };
  search: {
    commits(p: { q: string; per_page: number; page: number }): Promise<{
      data: { items: { sha: string; html_url: string; commit: { message: string } }[] };
    }>;
  };
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number }).status;
}

function isStatus(err: unknown, ...codes: number[]): boolean {
  const s = statusOf(err);
  return s !== undefined && codes.includes(s);
}

/** Run a search.commits call with backoff on the 30/min secondary limit. */
async function searchCommitsRetry(
  octokit: OctokitLike,
  q: string,
  attempt = 0,
): Promise<{ sha: string; html_url: string; commit: { message: string } }[]> {
  try {
    const res = await octokit.search.commits({ q, per_page: 20, page: 1 });
    return res.data.items;
  } catch (err) {
    if (isStatus(err, 403, 429) && attempt < 5) {
      const waitMs = 3_000 * 2 ** attempt;
      log.warn(`commit search rate-limited; backing off ${waitMs}ms`);
      await sleep(waitMs);
      return searchCommitsRetry(octokit, q, attempt + 1);
    }
    // 422 Validation Failed is the search API's response for a renamed/deleted
    // repo; 404 is gone. No revert is findable, which is the correct answer.
    if (isStatus(err, 422, 404)) return [];
    throw err;
  }
}

const repoDefaultBranchCache = new Map<string, string | null>();

/** The repo's default branch, cached. null when the repo is inaccessible. */
export async function defaultBranchOf(octokit: OctokitLike, repo: string): Promise<string | null> {
  if (repoDefaultBranchCache.has(repo)) return repoDefaultBranchCache.get(repo) ?? null;
  const target = parseRepo(repo);
  let branch: string | null;
  try {
    const res = await octokit.repos.get({ owner: target.owner, repo: target.repo });
    branch = res.data.default_branch;
  } catch (err) {
    if (isStatus(err, 404, 451, 403, 410)) branch = null;
    else throw err;
  }
  repoDefaultBranchCache.set(repo, branch);
  return branch;
}

function rangesOverlap(a: LineRange[], b: LineRange[]): boolean {
  for (const r1 of a) {
    for (const r2 of b) {
      if (r1.start <= r2.end && r2.start <= r1.end) return true;
    }
  }
  return false;
}

/** Reconstruct a single-file unified diff from a GitHub commit-file patch so
 *  the diff walker can extract its post-image line ranges. */
function patchToRanges(filename: string, patch: string): LineRange[] {
  const synthetic =
    `diff --git a/${filename} b/${filename}\n` + `--- a/${filename}\n+++ b/${filename}\n${patch}\n`;
  const ranges = extractChangedLineRanges(synthetic);
  return ranges[filename] ?? [];
}

function fmtRanges(ranges: LineRange[]): string {
  return ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(',');
}

// A hotfix has to be a fix to *code*. Docs, config, lockfiles, and generated
// or vendored output overlap by coordinate coincidence and tell us nothing
// about whether the change was wrong, so they are excluded from the hotfix
// signal (language-agnostic exclusion, since the corpus spans py/rs/go/ts/...).
const NON_CODE_FILE =
  /(\.(md|mdx|mdc|markdown|txt|rst|json|ya?ml|toml|lock|cfg|ini|csv|svg|png|jpe?g|gif|lockb|j2|jinja2?|tpl|template|hbs|ejs|mustache|env)$)|((^|\/)(docs?|\.github|\.cursor|build|dist|out|node_modules|vendor|third_party|generated|__generated__|fixtures?)\/)|((^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock|go\.sum)$)/i;

function isCodeFile(filename: string): boolean {
  return !NON_CODE_FILE.test(filename);
}

// A merge commit is the change landing, not a fix of it. Excluding merge
// commits keeps a PR's own merge (and unrelated branch merges) out of the
// hotfix signal; the individual fix commits a merge brings in are still
// scanned as their own listCommits entries.
const MERGE_COMMIT = /^Merge (pull request|branch|remote-tracking|commit|tag)\b/i;

// A genuine hotfix commit usually says so. Requiring fix-shaped language makes
// the signal squash-robust and cuts the coincidental same-line overlap a random
// small edit would otherwise produce. Missing a silently-fixed change is the
// conservative error (it lands in "survived"), which is the safe direction for
// ground truth: it never inflates the broken count.
// Strong fix-intent markers only. Weak substring matchers (error, fail, wrong,
// incorrect, repair) are deliberately excluded: they fire on feature commits
// ("improve error messaging", "fail-safe defaults") and would admit non-fix
// follow-ups. A genuine hotfix names itself fix / bug / regression / revert.
const FIX_LANGUAGE =
  /\b(fix(es|ed)?|bug|hotfix|regression|revert(s|ed)?|broke|broken|patch(es|ed)?|defect|crash(es|ed)?)\b/i;

function readVendoredDiff(entry: PrCorpusEntry): string | null {
  const file = path.join(RAW_DIR, entry.vendoredDiffPath);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

const HOTFIX_FILE_CAP = 8;
const HOTFIX_COMMIT_CAP = 15;
// A hotfix is a small, surgical follow-up. A later commit that rewrites or
// extends a whole file trivially "overlaps" the change's lines by coordinate
// coincidence (worsened by squash-merge line drift), so a follow-up larger than
// this many changed lines is not accepted as a hotfix — only as a possible
// revert (which is matched on the commit message, not on line overlap).
const HOTFIX_MAX_COMMIT_LINES = 60;

interface HotfixScan {
  revert?: OutcomeEvidence;
  hotfix?: OutcomeEvidence;
  limited: boolean;
}

/** Scan follow-up commits in the window that touch the change's files. Reports
 *  the first same-line overlap (a hotfix) and, if any candidate's message
 *  reverts the landed sha, that revert too. Bounded by file and commit caps. */
async function scanFollowups(
  octokit: OctokitLike,
  repo: string,
  defaultBranch: string,
  headSha: string,
  prRanges: ChangedLineRanges,
  landedAt: string,
  windowDays: number,
): Promise<HotfixScan> {
  const target = parseRepo(repo);
  const since = new Date(new Date(landedAt).getTime() + 1_000).toISOString();
  const until = new Date(new Date(landedAt).getTime() + windowDays * 86_400_000).toISOString();
  const files = Object.keys(prRanges).slice(0, HOTFIX_FILE_CAP);
  let limited = Object.keys(prRanges).length > HOTFIX_FILE_CAP;
  const candidateShas: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    let commits;
    try {
      commits = await octokit.repos.listCommits({
        owner: target.owner,
        repo: target.repo,
        sha: defaultBranch,
        path: file,
        since,
        until,
        per_page: 30,
      });
    } catch (err) {
      if (isStatus(err, 404, 409, 451)) continue;
      throw err;
    }
    for (const c of commits.data) {
      if (c.sha === headSha || seen.has(c.sha)) continue;
      seen.add(c.sha);
      candidateShas.push(c.sha);
    }
  }
  const result: HotfixScan = { limited };
  let fetched = 0;
  for (const sha of candidateShas) {
    if (fetched >= HOTFIX_COMMIT_CAP) {
      result.limited = true;
      break;
    }
    fetched += 1;
    let detail;
    try {
      detail = await octokit.repos.getCommit({ owner: target.owner, repo: target.repo, ref: sha });
    } catch (err) {
      if (isStatus(err, 404, 422, 451)) continue;
      throw err;
    }
    if (result.revert === undefined && messageRevertsSha(detail.data.commit.message, headSha)) {
      result.revert = {
        kind: 'revert-commit',
        ref: sha,
        detail: `reverts ${headSha.slice(0, 12)}: ${detail.data.html_url}`,
      };
    }
    const commitSize = detail.data.stats?.total ?? Number.POSITIVE_INFINITY;
    const message = detail.data.commit.message;
    const subjectLine = message.split('\n')[0] ?? '';
    const isMerge = MERGE_COMMIT.test(subjectLine);
    const fixShaped = FIX_LANGUAGE.test(subjectLine) || FIX_LANGUAGE.test(message);
    if (result.hotfix === undefined && !isMerge && commitSize <= HOTFIX_MAX_COMMIT_LINES && fixShaped) {
      for (const f of detail.data.files ?? []) {
        const prFileRanges = prRanges[f.filename];
        if (prFileRanges === undefined || f.patch === undefined || !isCodeFile(f.filename)) continue;
        const commitRanges = patchToRanges(f.filename, f.patch);
        if (commitRanges.length > 0 && rangesOverlap(prFileRanges, commitRanges)) {
          const subject = (message.split('\n')[0] ?? '').slice(0, 80);
          result.hotfix = {
            kind: 'hotfix-commit',
            ref: sha,
            detail:
              `${f.filename}: change lines ${fmtRanges(prFileRanges)} overlap commit lines ` +
              `${fmtRanges(commitRanges)} in a ${commitSize}-line fix-shaped follow-up ` +
              `("${subject}") (${detail.data.html_url})`,
          };
          break;
        }
      }
    }
    if (result.revert !== undefined && result.hotfix !== undefined) break;
  }
  return result;
}

async function resolveOutcome(
  octokit: OctokitLike,
  entry: PrCorpusEntry,
  args: Args,
): Promise<OutcomeLabel> {
  const repo = entry.pr.repository;
  const headSha = entry.pr.headSha;
  const target = parseRepo(repo);
  const base: Omit<OutcomeLabel, 'outcome' | 'evidence' | 'scanLimited' | 'reachability'> = {
    id: entry.id,
    repo,
    headSha,
    landedAt: null,
    defaultBranch: null,
    aiVerdict: entry.groundTruth.verdict,
    aiCategories: entry.groundTruth.brokenCategories ?? [],
    resolvedAt: new Date().toISOString(),
  };

  // 1. The landed commit must exist in the repo. A 404/422/451 here means the
  //    history is unreadable -> indeterminate, never assumed clean.
  let commit: CommitData;
  try {
    const res = await octokit.repos.getCommit({ owner: target.owner, repo: target.repo, ref: headSha });
    commit = res.data;
  } catch (err) {
    return {
      ...base,
      outcome: 'indeterminate',
      indeterminateReason: `head commit ${headSha.slice(0, 12)} unreadable (HTTP ${statusOf(err) ?? '?'})`,
      reachability: 'unverified',
      evidence: [],
      scanLimited: false,
    };
  }
  const landedAt = commit.commit.committer?.date ?? commit.commit.author?.date ?? null;
  base.landedAt = landedAt;

  const defaultBranch = await defaultBranchOf(octokit, repo);
  base.defaultBranch = defaultBranch;
  if (defaultBranch === null || landedAt === null) {
    return {
      ...base,
      outcome: 'indeterminate',
      indeterminateReason: 'repo default branch or commit date unavailable',
      reachability: 'unverified',
      evidence: [],
      scanLimited: false,
    };
  }

  // 2. Reachability is recorded as evidence, not a gate: a squash-merge leaves
  //    the vendored branch sha "diverged" from the default branch even though
  //    the change landed under a squashed sha. The collector already filtered
  //    to merged PRs, so outcome detection below works off the change's files
  //    and the revert-message search, both squash-agnostic.
  let reachability: OutcomeLabel['reachability'] = 'unverified';
  try {
    const cmp = await octokit.repos.compareCommits({
      owner: target.owner,
      repo: target.repo,
      base: defaultBranch,
      head: headSha,
    });
    const status = cmp.data.status;
    if (status === 'identical' || status === 'behind' || status === 'ahead' || status === 'diverged') {
      reachability = status;
    }
  } catch (err) {
    if (!isStatus(err, 404, 422, 451)) throw err;
  }

  // 3 + 4. Revert search + follow-up scan, shared with the Part B miner.
  const diff = readVendoredDiff(entry);
  const prRanges = diff !== null ? extractChangedLineRanges(diff) : {};
  const found = await findOutcomeEvidence(octokit, {
    repo,
    headSha,
    defaultBranch,
    landedAt,
    prRanges,
    hotfixWindowDays: args.hotfixWindowDays,
  });

  return {
    ...base,
    outcome: found.outcome,
    evidence: dedupeEvidence(found.evidence),
    scanLimited: found.scanLimited,
    reachability,
  };
}

export interface OutcomeEvidenceResult {
  outcome: 'reverted' | 'hotfixed' | 'survived';
  evidence: OutcomeEvidence[];
  scanLimited: boolean;
}

/**
 * The shared revert/hotfix evidence core: given a landed commit and the lines
 * its change touched, search for a revert of the sha and scan the follow-up
 * window for a surgical fix-shaped commit re-touching the same source lines.
 * Used by both the corpus labeler and the Part B confirmed-bad miner so the two
 * derive "bad" identically.
 *
 * @returns the outcome (reverted | hotfixed | survived) and its evidence
 */
export async function findOutcomeEvidence(
  octokit: OctokitLike,
  input: {
    repo: string;
    headSha: string;
    defaultBranch: string;
    landedAt: string;
    prRanges: ChangedLineRanges;
    hotfixWindowDays: number;
  },
): Promise<OutcomeEvidenceResult> {
  const { repo, headSha, defaultBranch, landedAt, prRanges, hotfixWindowDays } = input;
  const evidence: OutcomeEvidence[] = [];

  const short = headSha.slice(0, 12);
  const items = await searchCommitsRetry(octokit, `repo:${repo} "This reverts commit ${short}"`);
  const revertHit = items.find((it) => messageRevertsSha(it.commit.message, headSha));
  if (revertHit !== undefined) {
    evidence.push({ kind: 'revert-commit', ref: revertHit.sha, detail: `reverts ${short}: ${revertHit.html_url}` });
  }

  let scanLimited = false;
  if (evidence.length === 0 && Object.keys(prRanges).length > 0) {
    const scan = await scanFollowups(octokit, repo, defaultBranch, headSha, prRanges, landedAt, hotfixWindowDays);
    scanLimited = scan.limited;
    if (scan.revert !== undefined) evidence.push(scan.revert);
    if (scan.hotfix !== undefined) evidence.push(scan.hotfix);
  }

  const reverted = evidence.some((e) => e.kind === 'revert-commit');
  const hotfixed = evidence.some((e) => e.kind === 'hotfix-commit');
  const outcome = reverted ? 'reverted' : hotfixed ? 'hotfixed' : 'survived';
  return { outcome, evidence: dedupeEvidence(evidence), scanLimited };
}

function dedupeEvidence(evidence: OutcomeEvidence[]): OutcomeEvidence[] {
  const seen = new Set<string>();
  const out: OutcomeEvidence[] = [];
  for (const e of evidence) {
    const key = `${e.kind}:${e.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.ref.localeCompare(b.ref) : a.kind.localeCompare(b.kind)));
}

// --- agreement between outcome and the prior AI labels ---------------------

function cohensKappa(a: number, b: number, c: number, d: number): number {
  // 2x2: a=both broken, d=both clean, b/c=disagreements.
  const n = a + b + c + d;
  if (n === 0) return 0;
  const po = (a + d) / n;
  const pBrokenOutcome = (a + c) / n;
  const pBrokenAi = (a + b) / n;
  const pe = pBrokenOutcome * pBrokenAi + (1 - pBrokenOutcome) * (1 - pBrokenAi);
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

interface AgreementReport {
  comparedPrs: number;
  bothBroken: number;
  bothClean: number;
  outcomeBrokenAiClean: number;
  outcomeCleanAiBroken: number;
  rawAgreement: number;
  cohensKappa: number;
  note: string;
}

function buildAgreement(labels: OutcomeLabel[]): AgreementReport {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (const l of labels) {
    if (l.outcome === 'indeterminate' || l.aiVerdict === 'ambiguous') continue;
    const outcomeBroken = l.outcome === 'reverted' || l.outcome === 'hotfixed';
    const aiBroken = l.aiVerdict === 'broken';
    if (outcomeBroken && aiBroken) a += 1;
    else if (!outcomeBroken && aiBroken) c += 1;
    else if (outcomeBroken && !aiBroken) b += 1;
    else d += 1;
  }
  const n = a + b + c + d;
  return {
    comparedPrs: n,
    bothBroken: a,
    bothClean: d,
    outcomeBrokenAiClean: b,
    outcomeCleanAiBroken: c,
    rawAgreement: n === 0 ? 0 : (a + d) / n,
    cohensKappa: cohensKappa(a, b, c, d),
    note:
      'Binary projection broken-vs-clean over PRs where both sources decided ' +
      '(outcome != indeterminate and AI != ambiguous). outcome broken = reverted|hotfixed.',
  };
}

function distribution(labels: OutcomeLabel[]): Record<Outcome, number> {
  const dist: Record<Outcome, number> = { reverted: 0, hotfixed: 0, survived: 0, indeterminate: 0 };
  for (const l of labels) dist[l.outcome] += 1;
  return dist;
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const token = resolveGithubToken();
  const octokit = makeOctokit(token) as unknown as OctokitLike;

  const unlabeled = await loadPrCorpus(RAW_DIR);
  const loaded = await loadLabeledPrEntries(unlabeled, LABELS_DIR);
  let entries = loaded.labeled;
  if (args.only !== null) entries = entries.filter((e) => e.id.includes(args.only as string));
  if (args.limit !== null) entries = entries.slice(0, args.limit);
  log.info(`resolving outcomes for ${entries.length} commit-grounded corpus entries`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let resolved = 0;
  let queried = 0;
  for (const entry of entries) {
    const cacheFile = path.join(CACHE_DIR, `${entry.id}.json`);
    if (!args.refresh) {
      const cached = readJson<OutcomeLabel>(cacheFile);
      if (cached !== null) {
        resolved += 1;
        continue;
      }
    }
    const label = await resolveOutcome(octokit, entry, args);
    writeJson(cacheFile, label);
    resolved += 1;
    queried += 1;
    if (queried % 10 === 0) log.info(`resolved ${resolved}/${entries.length} (${queried} live this run)`);
  }

  // Aggregate from cache (every run rebuilds the summary deterministically).
  const labels: OutcomeLabel[] = [];
  for (const e of entries) {
    const cached = readJson<OutcomeLabel>(path.join(CACHE_DIR, `${e.id}.json`));
    if (cached !== null) labels.push(cached);
  }
  labels.sort((a, b) => a.id.localeCompare(b.id));

  const dist = distribution(labels);
  const summary = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/labeling/outcome-labels.ts',
    groundTruth: 'repository-history-only, commit-grounded (revert / hotfix / survived); no model or human opinion',
    hotfixWindowDays: args.hotfixWindowDays,
    corpusSize: labels.length,
    usableForScoring: dist.reverted + dist.hotfixed + dist.survived,
    outcomeBroken: dist.reverted + dist.hotfixed,
    outcomeClean: dist.survived,
    excludedIndeterminate: dist.indeterminate,
    distribution: dist,
    agreementWithAiLabels: buildAgreement(labels),
    labels,
  };
  writeJson(OUT_FILE, summary);

  log.info(
    `outcome labels: reverted=${dist.reverted} hotfixed=${dist.hotfixed} ` +
      `survived=${dist.survived} indeterminate=${dist.indeterminate} ` +
      `(usable ${summary.usableForScoring}/${labels.length}); wrote ${OUT_FILE}`,
  );
  const agr = summary.agreementWithAiLabels;
  log.info(
    `AI-vs-outcome agreement on ${agr.comparedPrs} PRs: raw=${agr.rawAgreement.toFixed(3)} ` +
      `kappa=${agr.cohensKappa.toFixed(3)} ` +
      `(both-broken=${agr.bothBroken}, outcome-broken/AI-clean=${agr.outcomeBrokenAiClean}, ` +
      `outcome-clean/AI-broken=${agr.outcomeCleanAiBroken})`,
  );
}

// Guard the entry point so importing this module for its reusable core
// (findOutcomeEvidence, defaultBranchOf) does not trigger a live labeling run
// as a side effect. Without this, any module that imports the shared core (the
// confirmed-bad miners) would kick off a full GitHub API labeling pass at import
// time and rewrite the committed outcome-labels.json.
if (require.main === module) {
  main().catch((err: unknown) => {
    if (err instanceof SwarmError) {
      log.error(`${err.message}${err.remediation ? ` — ${err.remediation}` : ''}`);
    } else {
      log.error(err instanceof Error ? err.stack ?? err.message : String(err));
    }
    process.exit(1);
  });
}
