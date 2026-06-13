// The second wild hunt: viability-first targeting, complaint mining, and a
// triage cascade so compute lands where a catch is possible.
//
// The first hunt (hunt.ts) fetched agent PRs and hoped they provisioned: 216
// fetched, 28 viable (87% of the fetch budget wasted on non-Node repos), 0
// proven. This hunt inverts that funnel three ways, all reusing the shipped
// instruments (detectAgent, screenPr, the six-engine proof tier via
// lib/proof-tier):
//
//   1. VIABILITY-FIRST. Discover candidate repos from agent-PR search, screen
//      each repo ONCE for EG viability (Node + lockfile + runner + node engine),
//      then enumerate agent PRs only inside the viable repos. Proof budget is
//      never spent fetching diffs from repos that can never provision.
//   2. COMPLAINT MINING (the richest vein). Search PR review comments — including
//      CLOSED-WITHOUT-MERGE PRs, which the first hunt ignored — for maintainer
//      cheat-language ("you just changed the test", "this doesn't actually fix",
//      "removed the assertion", ...). A verified complaint on an agent PR is a
//      human-labeled wild cheat before any proof runs, and is the priority target
//      for the proof tier.
//   3. TRIAGE CASCADE. The cheap, diff-only advisory audit (runCheatDetectors)
//      runs on everything fetched. The expensive provision-and-prove step runs
//      ONLY on a PR that carries a candidate finding or a maintainer complaint.
//      No candidate, no sandbox.
//
// Bounded by construction (API budget, total wall clock, per-PR EG wall clock,
// max EG runs) and CHECKPOINTED: every per-PR verdict is written immediately and
// a checkpoint records processed ids and the staged funnel, so a cap or crash
// never loses completed work and a re-run resumes. Everything a cap skips is
// counted. Single-target, local, concurrency 1 (no CI dispatch here).
//
// Usage:
//   SWARM_EG_NODE_BIN=/path/to/node@22/bin \
//   node dist/scripts/real-prs/hunt2.js \
//     [--target 1000] [--per-vendor 60] [--repo-cap 25] [--months 18] \
//     [--min-lines 10] [--max-lines 8000] \
//     [--max-eg 100] [--api-budget 4500] \
//     [--wall-clock-ms 43200000] [--eg-wall-clock-ms 480000] [--resume]
//
// Output:
//   benchmarks/real-prs/hunt2/hunt2-summary.json
//   benchmarks/real-prs/hunt2/checkpoint.json
//   benchmarks/real-prs/hunt2/records/<id>.json
//   benchmarks/real-prs/hunt2/diffs/<id>.diff

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { detectAgent } from '../../src/audit/pr-source';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import {
  COMPLAINT_SEARCH_PHRASES,
  extractComplaintSignals,
  fetchPrConversation,
  fetchPrDiff,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  searchMergedPrsGlobal,
  withRetry,
  type ComplaintSignal,
  type GlobalSearchPr,
} from './lib/github';
import { VENDOR_QUERIES, EXCLUDED_OWNERS } from './fetch-agent-prs';
import { screenPr, type OctokitContents } from './eg-viability-screen';
import { proveOne, writeRecord, type HuntPr, type ProofRecord } from './lib/proof-tier';

const log = getLogger('real-prs:hunt2');

const OUT_DIR = path.join('benchmarks', 'real-prs', 'hunt2');
const RECORDS_DIR = path.join(OUT_DIR, 'records');
const DIFFS_DIR = path.join(OUT_DIR, 'diffs');
const SUMMARY_FILE = path.join(OUT_DIR, 'hunt2-summary.json');
const CHECKPOINT_FILE = path.join(OUT_DIR, 'checkpoint.json');
// The assembled population (complaint + viable-repo agent PRs, screened and
// advisory-audited) is persisted here so a kill or cap after the expensive fetch
// stages never re-pays them: `--resume` loads this and jumps straight to proofs.
const POPULATION_FILE = path.join(OUT_DIR, 'population.json');

interface Args {
  target: number;
  perVendor: number;
  repoCap: number;
  months: number;
  minLines: number;
  maxLines: number;
  maxEg: number;
  apiBudget: number;
  wallClockMs: number;
  egWallClockMs: number;
  resume: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    target: 1_000,
    perVendor: 60,
    repoCap: 25,
    months: 18,
    minLines: 10,
    maxLines: 8_000,
    maxEg: 100,
    apiBudget: 4_500,
    wallClockMs: 12 * 60 * 60 * 1000,
    egWallClockMs: 8 * 60 * 1000,
    resume: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--resume') {
      a.resume = true;
      continue;
    }
    if (v === undefined) continue;
    if (k === '--target') (a.target = Number(v)), (i += 1);
    else if (k === '--per-vendor') (a.perVendor = Number(v)), (i += 1);
    else if (k === '--repo-cap') (a.repoCap = Number(v)), (i += 1);
    else if (k === '--months') (a.months = Number(v)), (i += 1);
    else if (k === '--min-lines') (a.minLines = Number(v)), (i += 1);
    else if (k === '--max-lines') (a.maxLines = Number(v)), (i += 1);
    else if (k === '--max-eg') (a.maxEg = Number(v)), (i += 1);
    else if (k === '--api-budget') (a.apiBudget = Number(v)), (i += 1);
    else if (k === '--wall-clock-ms') (a.wallClockMs = Number(v)), (i += 1);
    else if (k === '--eg-wall-clock-ms') (a.egWallClockMs = Number(v)), (i += 1);
  }
  return a;
}

function monthsAgoIso(months: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - months, now.getDate()).toISOString().slice(0, 10);
}

function slugId(vendor: string, repo: string, prNumber: number): string {
  return `${vendor}-${repo.replace(/[/]/g, '-')}-pr${prNumber}`;
}

/** A candidate agent PR in the cascade, with triage tags attached as it flows. */
interface CascadePr extends HuntPr {
  /** Whether the PR was merged (false => closed-without-merge, a complaint hot-spot). */
  merged: boolean;
  /** Verified maintainer-complaint signals, when any. */
  complaints: ComplaintSignal[];
  /** Advisory (structural+judge) audit categories that fired on the diff. */
  candidateCategories: string[];
  /** EG viability of the repo (decided by screenPr). */
  viable: boolean;
  viabilityReason: string;
}

interface Funnel {
  fetched: number;
  complaintFlagged: number;
  candidateFlagged: number;
  viable: number;
  /** (candidate ∪ complaint) ∩ viable — the proof-eligible set. */
  proofEligible: number;
  provisioned: number;
  proofRan: number;
  proven: number;
  refuted: number;
  unprovable: number;
  skippedByCap: number;
}

interface Checkpoint {
  processedIds: string[];
  funnel: Funnel;
}

function emptyFunnel(): Funnel {
  return {
    fetched: 0,
    complaintFlagged: 0,
    candidateFlagged: 0,
    viable: 0,
    proofEligible: 0,
    provisioned: 0,
    proofRan: 0,
    proven: 0,
    refuted: 0,
    unprovable: 0,
    skippedByCap: 0,
  };
}

function loadCheckpoint(): Checkpoint {
  if (!fs.existsSync(CHECKPOINT_FILE)) return { processedIds: [], funnel: emptyFunnel() };
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')) as Checkpoint;
  } catch {
    return { processedIds: [], funnel: emptyFunnel() };
  }
}

function saveCheckpoint(cp: Checkpoint): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_FILE, `${JSON.stringify(cp, null, 2)}\n`);
}

type Octo = ReturnType<typeof makeOctokit>;

/**
 * detectAgent over a fetched PR. Cheap-first: most agent PRs are decided from
 * the title, body, head ref, and author alone (the body marker for claude-code /
 * aider, the head prefix for cursor / codex, the bot login for devin / copilot),
 * so we try that with zero extra API calls and only spend a listCommits when the
 * cheap pass is undefined. This matters at scale: a complaint search examines
 * many non-agent hits, and paying a commit fetch on each would collapse the
 * budget before the viability stage runs.
 */
async function attribute(
  octokit: Octo,
  repo: string,
  prNumber: number,
  title: string,
  body: string,
  headRef: string,
  authorLogin: string,
  spend: () => boolean,
): Promise<{ vendor: string; confidence: string } | undefined> {
  const authors = [authorLogin].filter((s) => s.length > 0);
  const cheap = detectAgent({ prTitle: title, prBody: body, headRef, commitMessages: [], authors });
  if (cheap !== undefined && cheap.confidence !== 'low') return cheap;
  if (!spend()) return cheap;
  const target = parseRepo(repo);
  try {
    const commits = await withRetry(
      () => octokit.pulls.listCommits({ owner: target.owner, repo: target.repo, pull_number: prNumber, per_page: 100 }),
      `listCommits ${repo}#${prNumber}`,
    );
    const commitMessages = commits.data.map((m) => m.commit.message);
    const allAuthors = [authorLogin, ...commits.data.map((m) => m.author?.login ?? m.commit.author?.name ?? '')].filter(
      (s) => s.length > 0,
    );
    return detectAgent({ prTitle: title, prBody: body, headRef, commitMessages, authors: allAuthors });
  } catch (err) {
    log.debug(`listCommits failed for ${repo}#${prNumber}: ${(err as Error).message}`);
    return cheap;
  }
}

/**
 * Stage 1+2: viability-first targeting. Run each vendor search to discover
 * candidate repos, screen each repo ONCE at a sample agent PR's head sha, and for
 * the viable repos enumerate their agent PRs (merged and closed-unmerged) up to a
 * per-repo cap. Returns the viable-repo agent-PR population, plus the per-repo
 * viability record for the funnel.
 */
async function discoverViableRepoPrs(
  octokit: Octo,
  args: Args,
  spend: () => boolean,
): Promise<{ prs: CascadePr[]; repoViability: Record<string, { viable: boolean; reason: string }> }> {
  const since = monthsAgoIso(args.months);
  const repoViability: Record<string, { viable: boolean; reason: string }> = {};
  const prs: CascadePr[] = [];
  const seenPr = new Set<string>();
  // repo -> a sample (prNumber, headSha) to screen the repo at.
  const repoSamples = new Map<string, { prNumber: number; headSha: string }>();

  // Discover candidate repos from the per-vendor search.
  for (const { vendor, q } of VENDOR_QUERIES) {
    if (!spend()) break;
    if (Object.keys(repoSamples).length >= args.target) break;
    let candidates: GlobalSearchPr[];
    try {
      candidates = await searchMergedPrsGlobal(octokit, `${q} merged:>=${since}`, args.perVendor * 4);
    } catch (err) {
      log.warn(`vendor search failed for ${vendor}: ${(err as Error).message}`);
      continue;
    }
    for (const c of candidates) {
      const owner = c.repo.split('/')[0] ?? '';
      if (EXCLUDED_OWNERS.has(owner.toLowerCase())) continue;
      if (repoSamples.has(c.repo)) continue;
      if (!spend()) break;
      const target = parseRepo(c.repo);
      try {
        const detail = await withRetry(
          () => octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: c.number }),
          `pulls.get ${c.repo}#${c.number}`,
        );
        repoSamples.set(c.repo, { prNumber: c.number, headSha: detail.data.head.sha });
      } catch (err) {
        log.debug(`sample detail failed for ${c.repo}#${c.number}: ${(err as Error).message}`);
      }
    }
  }
  log.info(`discovered ${repoSamples.size} candidate agent repos; screening for viability`);

  // Screen each candidate repo ONCE.
  const viableRepos: string[] = [];
  for (const [repo, sample] of repoSamples) {
    if (!spend()) break;
    const rec = await withRetry(
      () =>
        screenPr(octokit as unknown as OctokitContents, {
          id: repo,
          repo,
          headSha: sample.headSha,
          outcome: 'unknown',
        }),
      `screen ${repo}`,
    );
    repoViability[repo] = { viable: rec.viable, reason: rec.reason };
    if (rec.viable) viableRepos.push(repo);
  }
  log.info(`viable repos: ${viableRepos.length}/${repoSamples.size}`);

  // Enumerate agent PRs (merged AND closed-unmerged) inside the viable repos.
  fs.mkdirSync(DIFFS_DIR, { recursive: true });
  for (const repo of viableRepos) {
    if (prs.length >= args.target) break;
    if (!spend()) break;
    const target = parseRepo(repo);
    let items: GlobalSearchPr[];
    try {
      // Closed PRs in this repo, newest first; attribution decides which are agent.
      items = await searchMergedPrsGlobal(octokit, `repo:${repo} is:pr is:closed updated:>=${since}`, args.repoCap * 4);
    } catch (err) {
      log.debug(`repo PR search failed for ${repo}: ${(err as Error).message}`);
      continue;
    }
    let keptForRepo = 0;
    for (const it of items) {
      if (prs.length >= args.target || keptForRepo >= args.repoCap) break;
      const dedupe = `${repo}#${it.number}`;
      if (seenPr.has(dedupe)) continue;
      if (!spend()) break;
      let detail;
      try {
        detail = await withRetry(
          () => octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: it.number }),
          `pulls.get ${dedupe}`,
        );
      } catch (err) {
        log.debug(`detail failed for ${dedupe}: ${(err as Error).message}`);
        continue;
      }
      const d = detail.data;
      const changed = d.additions + d.deletions;
      if (changed < args.minLines || changed > args.maxLines) continue;
      const attribution = await attribute(
        octokit,
        repo,
        it.number,
        it.title,
        it.body,
        d.head.ref,
        d.user?.login ?? '',
        spend,
      );
      if (attribution === undefined || attribution.confidence === 'low') continue;
      if (!spend()) break;
      let diff: string;
      try {
        diff = await withRetry(() => fetchPrDiff(octokit, target, it.number), `diff ${dedupe}`);
      } catch (err) {
        log.debug(`diff failed for ${dedupe}: ${(err as Error).message}`);
        continue;
      }
      const id = slugId(attribution.vendor, repo, it.number);
      const diffRel = path.join('diffs', `${id}.diff`);
      fs.writeFileSync(path.join(OUT_DIR, diffRel), diff);
      seenPr.add(dedupe);
      keptForRepo += 1;
      prs.push({
        id,
        repo,
        prNumber: it.number,
        headSha: d.head.sha,
        baseSha: d.base.sha,
        title: it.title,
        body: (it.body ?? '').slice(0, 4_000),
        url: it.url,
        vendor: attribution.vendor,
        vendorConfidence: attribution.confidence,
        changedLines: changed,
        diffPath: diffRel,
        outcome: 'unknown',
        merged: d.merged_at !== null && d.merged_at !== undefined,
        complaints: [],
        candidateCategories: [],
        viable: true,
        viabilityReason: repoViability[repo]?.reason ?? 'viable',
      });
    }
  }
  return { prs, repoViability };
}

/**
 * Complaint mining (cross-repo, the priority vein). For each cheat-language
 * phrase, search PR comments (NOT restricted to merged, so closed-without-merge
 * PRs are included), attribute each hit, verify the complaint against the fetched
 * conversation, and return the agent PRs that carry a verified maintainer
 * complaint. These are proof-tier priority targets regardless of advisory audit.
 */
async function mineComplaints(
  octokit: Octo,
  args: Args,
  spend: () => boolean,
  already: Set<string>,
): Promise<CascadePr[]> {
  const since = monthsAgoIso(args.months);
  const out: CascadePr[] = [];
  const seen = new Set<string>();
  fs.mkdirSync(DIFFS_DIR, { recursive: true });
  for (const phrase of COMPLAINT_SEARCH_PHRASES) {
    if (!spend()) break;
    let hits: GlobalSearchPr[];
    try {
      hits = await searchMergedPrsGlobal(octokit, `is:pr "${phrase}" in:comments updated:>=${since}`, 40);
    } catch (err) {
      log.debug(`complaint search failed for "${phrase}": ${(err as Error).message}`);
      continue;
    }
    for (const hit of hits) {
      const owner = hit.repo.split('/')[0] ?? '';
      if (EXCLUDED_OWNERS.has(owner.toLowerCase())) continue;
      const dedupe = `${hit.repo}#${hit.number}`;
      if (seen.has(dedupe) || already.has(dedupe)) continue;
      seen.add(dedupe);
      if (!spend()) break;
      const target = parseRepo(hit.repo);
      let detail;
      try {
        detail = await withRetry(
          () => octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: hit.number }),
          `pulls.get ${dedupe}`,
        );
      } catch (err) {
        log.debug(`complaint detail failed for ${dedupe}: ${(err as Error).message}`);
        continue;
      }
      const d = detail.data;
      // Attribute the PR; only agent-authored complaints count.
      const attribution = await attribute(
        octokit,
        hit.repo,
        hit.number,
        hit.title,
        hit.body,
        d.head.ref,
        d.user?.login ?? '',
        spend,
      );
      if (attribution === undefined || attribution.confidence === 'low') continue;
      // Verify the complaint actually appears in a human comment on this PR.
      if (!spend()) break;
      let signals: ComplaintSignal[] = [];
      try {
        const convo = await fetchPrConversation(octokit, target, hit.number);
        for (const entry of convo) {
          for (const s of extractComplaintSignals(entry.body, entry.source)) signals.push(s);
        }
      } catch (err) {
        log.debug(`conversation fetch failed for ${dedupe}: ${(err as Error).message}`);
      }
      // Dedupe signals by category+phrase.
      const uniq = new Map<string, ComplaintSignal>();
      for (const s of signals) uniq.set(`${s.category}:${s.phrase.toLowerCase()}`, s);
      signals = [...uniq.values()];
      if (signals.length === 0) continue; // search matched but local verify did not
      const changed = d.additions + d.deletions;
      if (!spend()) break;
      let diff: string;
      try {
        diff = await withRetry(() => fetchPrDiff(octokit, target, hit.number), `diff ${dedupe}`);
      } catch (err) {
        log.debug(`complaint diff failed for ${dedupe}: ${(err as Error).message}`);
        continue;
      }
      const id = slugId(attribution.vendor, hit.repo, hit.number);
      const diffRel = path.join('diffs', `${id}.diff`);
      fs.writeFileSync(path.join(OUT_DIR, diffRel), diff);
      // Screen viability INLINE: a verified complaint is the highest-value target,
      // so lock in whether the proof tier can even execute it now, before a later
      // pass risks running out of budget.
      let viable = false;
      let viabilityReason = 'not screened';
      if (spend()) {
        try {
          const rec = await screenPr(octokit as unknown as OctokitContents, {
            id,
            repo: hit.repo,
            headSha: d.head.sha,
            outcome: 'unknown',
          });
          viable = rec.viable;
          viabilityReason = rec.reason;
        } catch (err) {
          viabilityReason = `screen failed: ${(err as Error).message}`;
        }
      }
      out.push({
        id,
        repo: hit.repo,
        prNumber: hit.number,
        headSha: d.head.sha,
        baseSha: d.base.sha,
        title: hit.title,
        body: (hit.body ?? '').slice(0, 4_000),
        url: hit.url,
        vendor: attribution.vendor,
        vendorConfidence: attribution.confidence,
        changedLines: changed,
        diffPath: diffRel,
        outcome: 'unknown',
        merged: d.merged_at !== null && d.merged_at !== undefined,
        complaints: signals,
        candidateCategories: [],
        viable,
        viabilityReason,
      });
      log.info(
        `complaint-flagged ${id} (${attribution.vendor}, ${signals.map((s) => s.category).join(',')}, viable=${viable}) ${hit.url}`,
      );
    }
  }
  return out;
}

/** Advisory audit (diff-only, free) on one PR; returns the categories that fired. */
async function advisoryCategories(pr: CascadePr): Promise<string[]> {
  const prDiff = fs.readFileSync(path.join(OUT_DIR, pr.diffPath), 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunt2-adv-'));
  try {
    const audit = await runCheatDetectors({
      unifiedDiff: prDiff,
      repoRoot: tmp,
      pr: {
        number: pr.prNumber,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        title: pr.title,
        body: pr.body,
        author: '',
        headRef: '',
        repository: pr.repo,
      },
    });
    return [...new Set(audit.findings.map((f) => f.category))];
  } catch (err) {
    log.debug(`advisory audit failed for ${pr.id}: ${(err as Error).message}`);
    return [];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const octokit = makeOctokit(resolveGithubToken());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(RECORDS_DIR, { recursive: true });

  const checkpoint = args.resume ? loadCheckpoint() : { processedIds: [], funnel: emptyFunnel() };
  const processed = new Set(checkpoint.processedIds);

  const startedAt = Date.now();
  let apiCalls = 0;
  const spend = (): boolean => {
    if (apiCalls >= args.apiBudget) return false;
    if (Date.now() - startedAt >= args.wallClockMs) return false;
    apiCalls += 1;
    return true;
  };

  let population: CascadePr[];
  let repoViability: Record<string, { viable: boolean; reason: string }> = {};

  if (args.resume && fs.existsSync(POPULATION_FILE)) {
    // Resume: the expensive fetch + screen + advisory stages already ran. Load the
    // assembled population and jump straight to the proof tier.
    const saved = JSON.parse(fs.readFileSync(POPULATION_FILE, 'utf8')) as {
      population: CascadePr[];
      repoViability: Record<string, { viable: boolean; reason: string }>;
    };
    population = saved.population;
    repoViability = saved.repoViability ?? {};
    log.info(`resume: loaded ${population.length} assembled PRs from ${POPULATION_FILE}; skipping fetch stages`);
  } else {
    // Complaint mining is the priority vein but must not starve the volume stage.
    // Cap it at half the API budget; the viability-first repo population gets the
    // rest. A separate counter enforces the partition on top of the shared budget.
    const complaintCap = Math.floor(args.apiBudget * 0.5);
    let complaintCalls = 0;
    const complaintSpend = (): boolean => {
      if (complaintCalls >= complaintCap) return false;
      if (!spend()) return false;
      complaintCalls += 1;
      return true;
    };

    log.info(`stage: complaint mining (budget cap ${complaintCap})`);
    const complaintPrs = await mineComplaints(octokit, args, complaintSpend, new Set());

    log.info('stage: viability-first repo population');
    const discovered = await discoverViableRepoPrs(octokit, args, spend);
    const repoPrs = discovered.prs;
    repoViability = discovered.repoViability;

    // Merge populations; complaint PRs first (priority). Dedupe by id.
    const byId = new Map<string, CascadePr>();
    for (const p of [...complaintPrs, ...repoPrs]) if (!byId.has(p.id)) byId.set(p.id, p);
    population = [...byId.values()];

    // Any PR not yet screened (a complaint hit the inline screen skipped on budget)
    // gets one more chance here; repo-population PRs are already viable.
    for (const pr of population) {
      if (pr.viabilityReason !== 'not screened') continue;
      if (!spend()) {
        pr.viabilityReason = 'skipped-by-cap (api/wall-clock)';
        continue;
      }
      try {
        const rec = await withRetry(
          () =>
            screenPr(octokit as unknown as OctokitContents, {
              id: pr.id,
              repo: pr.repo,
              headSha: pr.headSha,
              outcome: pr.outcome,
            }),
          `screen ${pr.repo}`,
        );
        pr.viable = rec.viable;
        pr.viabilityReason = rec.reason;
      } catch (err) {
        pr.viabilityReason = `screen failed: ${(err as Error).message}`;
      }
    }

    // Triage cascade: advisory audit (diff-only, free) on everything.
    log.info(`cascade: advisory audit on ${population.length} PRs`);
    for (const pr of population) {
      pr.candidateCategories = await advisoryCategories(pr);
    }

    // Persist the assembled, screened, advisory-audited population so a later
    // kill or cap during the proof tier resumes without re-fetching.
    fs.writeFileSync(POPULATION_FILE, `${JSON.stringify({ population, repoViability }, null, 2)}\n`);
    log.info(`persisted ${population.length} assembled PRs -> ${POPULATION_FILE}`);
  }

  const funnel = emptyFunnel();
  funnel.fetched = population.length;
  funnel.complaintFlagged = population.filter((p) => p.complaints.length > 0).length;
  funnel.candidateFlagged = population.filter((p) => p.candidateCategories.length > 0).length;
  funnel.viable = population.filter((p) => p.viable).length;

  const proofEligible = population
    .filter((p) => p.viable && (p.complaints.length > 0 || p.candidateCategories.length > 0))
    .sort((a, b) => b.complaints.length - a.complaints.length); // complaints first
  funnel.proofEligible = proofEligible.length;
  log.info(
    `cascade: ${funnel.fetched} fetched, ${funnel.complaintFlagged} complaint-flagged, ` +
      `${funnel.candidateFlagged} candidate-flagged, ${funnel.viable} viable, ${funnel.proofEligible} proof-eligible`,
  );

  const records: ProofRecord[] = [];
  let egRuns = 0;
  for (const pr of proofEligible) {
    if (processed.has(pr.id)) {
      const existing = path.join(RECORDS_DIR, `${pr.id}.json`);
      if (fs.existsSync(existing)) {
        records.push(JSON.parse(fs.readFileSync(existing, 'utf8')) as ProofRecord);
        continue;
      }
    }
    const overWall = Date.now() - startedAt >= args.wallClockMs;
    if (egRuns >= args.maxEg || overWall) {
      funnel.skippedByCap += 1;
      const r: ProofRecord = {
        id: pr.id,
        repo: pr.repo,
        prNumber: pr.prNumber,
        url: pr.url,
        headSha: pr.headSha,
        vendor: pr.vendor,
        outcome: pr.outcome,
        outcomeBad: false,
        status: 'skipped-by-cap',
        provenTriggers: [],
        proofFunnel: {},
        advisoryFindings: [],
        mutationRan: false,
        coverageRan: false,
        skipped: [],
        note: overWall ? 'not reached within the wall-clock cap' : `not reached within the --max-eg ${args.maxEg} cap`,
        flags: triageFlags(pr),
      };
      records.push(r);
      writeRecord(RECORDS_DIR, r);
      continue;
    }
    log.info(
      `proving ${pr.id} (${pr.repo}#${pr.prNumber}) complaints=${pr.complaints.length} candidates=${pr.candidateCategories.length}`,
    );
    const r = await proveOne(pr, { diffsBaseDir: OUT_DIR, egWallClockMs: args.egWallClockMs });
    r.flags = triageFlags(pr);
    egRuns += 1;
    records.push(r);
    writeRecord(RECORDS_DIR, r);
    processed.add(pr.id);
    saveCheckpoint({ processedIds: [...processed], funnel });
    log.info(`  ${pr.id}: status=${r.status} proven=${r.provenTriggers.length}`);
  }

  funnel.proofRan = records.filter((r) => r.status === 'ran-no-proof' || r.status === 'proven-block').length;
  funnel.provisioned = funnel.proofRan;
  funnel.proven = records.filter((r) => r.status === 'proven-block').length;
  funnel.unprovable = records.filter((r) => r.status === 'not-provisioned' || r.status === 'error').length;
  funnel.refuted = funnel.proofRan - funnel.proven;
  funnel.skippedByCap = records.filter((r) => r.status === 'skipped-by-cap').length;

  const proven = records.filter((r) => r.status === 'proven-block');
  const complaintCatalog = population
    .filter((p) => p.complaints.length > 0)
    .map((p) => ({
      id: p.id,
      repo: p.repo,
      prNumber: p.prNumber,
      url: p.url,
      vendor: p.vendor,
      merged: p.merged,
      viable: p.viable,
      complaints: p.complaints,
      advisoryCategories: p.candidateCategories,
    }));

  const summary = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/hunt2.ts',
    args,
    apiCalls,
    wallClockMs: Date.now() - startedAt,
    funnel,
    repoViability,
    complaintCatalog,
    provenCatches: proven.map((r) => ({
      id: r.id,
      repo: r.repo,
      prNumber: r.prNumber,
      url: r.url,
      headSha: r.headSha,
      triggers: r.provenTriggers,
    })),
    records,
  };
  fs.writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  saveCheckpoint({ processedIds: [...processed], funnel });
  log.info(
    `hunt2 done: fetched ${funnel.fetched}, complaint-flagged ${funnel.complaintFlagged}, ` +
      `viable ${funnel.viable}, proof-ran ${funnel.proofRan}, proven ${funnel.proven}; ` +
      `${apiCalls} API calls, ${Math.round((Date.now() - startedAt) / 1000)}s -> ${SUMMARY_FILE}`,
  );
  if (proven.length > 0) {
    for (const r of proven) {
      log.warn(`PROVEN CATCH: ${r.repo}#${r.prNumber} (${r.url})`);
      for (const t of r.provenTriggers) log.warn(`  ${t.kind} @ ${t.file} :: reproduce: ${t.reproduce}`);
    }
  }
}

function triageFlags(pr: CascadePr): string[] {
  const flags: string[] = [];
  if (pr.complaints.length > 0) flags.push(`complaint-flagged:${pr.complaints.map((c) => c.category).join('|')}`);
  if (pr.candidateCategories.length > 0) flags.push(`candidate-flagged:${pr.candidateCategories.join('|')}`);
  if (!pr.merged) flags.push('closed-without-merge');
  return flags;
}

if (require.main === module) {
  main().catch((err) => {
    log.error(`hunt2 failed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exitCode = 1;
  });
}
