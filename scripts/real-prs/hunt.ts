// The wild hunt: point the shipped instruments at PRs we did not write.
//
// This extends the agent-incidence fetcher (it reuses its VENDOR_QUERIES, the
// shipped detectAgent fingerprinter, the EG viability screen, and the full
// execution-grounded proof tier) into one bounded end-to-end pass:
//
//   1. FETCH a target set of recent agent-attributed merged PRs from active
//      public repos (one global search per vendor, every candidate confirmed by
//      the fingerprinter, same as the corpus fetcher).
//   2. SCREEN each with the exact `screenPr` viability check the corpus uses, so
//      only Node + lockfile + runner + node-engine repos reach the sandbox.
//   3. PROVE: on the viable subset, run the structural-and-judge advisory audit
//      (runCheatDetectors) plus the six-engine execution-grounded proof tier
//      (test-tamper, mock-mutation, no-op-fix, type-suppression, fake-refactor,
//      dead-branch) and record every fully-controlled block trigger.
//
// Bounded by construction: a hard GitHub API budget, a total wall-clock cap, a
// per-PR EG wall-clock cap, and a cap on how many viable PRs get an EG run. Work
// dropped by any cap is recorded, never silently skipped. Single-target, local,
// concurrency 1 (no CI dispatch from this environment).
//
// A proven block from this pass is the project's first proven catch on a PR we
// did not author. A zero is an honest finding about the wild, recorded with the
// full funnel so it is diagnosable.
//
// Usage:
//   SWARM_EG_NODE_BIN=/path/to/node@22/bin \
//   node dist/scripts/real-prs/hunt.js \
//     [--target 200] [--per-vendor 30] [--months 12] \
//     [--min-lines 10] [--max-lines 8000] \
//     [--max-eg 25] [--api-budget 1500] \
//     [--wall-clock-ms 14400000] [--eg-wall-clock-ms 480000]
//
// Output:
//   benchmarks/real-prs/hunt/hunt-summary.json
//   benchmarks/real-prs/hunt/records/<id>.json      (one per EG-run PR)
//   benchmarks/real-prs/hunt/diffs/<id>.diff        (the PR diff under proof)

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { detectAgent } from '../../src/audit/pr-source';
import {
  fetchPrDiff,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  searchMergedPrsGlobal,
  type GlobalSearchPr,
} from './lib/github';
import { VENDOR_QUERIES, EXCLUDED_OWNERS } from './fetch-agent-prs';
import { screenPr, type OctokitContents } from './eg-viability-screen';
import { proveOne, writeRecord, type HuntPr, type ProofRecord } from './lib/proof-tier';

const log = getLogger('real-prs:hunt');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry a GitHub call through GitHub's secondary rate limit (burst-triggered,
 *  separate from the primary quota), honoring Retry-After. Assembling 200 PRs is
 *  ~1000 rapid core calls; without this the fetch stalls on a 403 without
 *  returning, the same failure mode the backward miner hit. */
async function withRetry<T>(fn: () => Promise<T>, label: string, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const status = (err as { status?: number }).status;
    const headers = (err as { response?: { headers?: Record<string, string> } }).response?.headers;
    const retryAfter = Number(headers?.['retry-after']);
    if ((status === 403 || status === 429) && attempt < 5) {
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2_000 * 2 ** attempt;
      log.warn(`${label} hit a secondary rate limit; waiting ${waitMs}ms (attempt ${attempt + 1})`);
      await sleep(waitMs);
      return withRetry(fn, label, attempt + 1);
    }
    throw err;
  }
}

const OUT_DIR = path.join('benchmarks', 'real-prs', 'hunt');
const RECORDS_DIR = path.join(OUT_DIR, 'records');
const DIFFS_DIR = path.join(OUT_DIR, 'diffs');
const SUMMARY_FILE = path.join(OUT_DIR, 'hunt-summary.json');

interface Args {
  target: number;
  perVendor: number;
  months: number;
  minLines: number;
  maxLines: number;
  maxEg: number;
  apiBudget: number;
  wallClockMs: number;
  egWallClockMs: number;
  /** Optional JSON file of explicit seed targets to prove in addition to (or,
   *  when --target 0, instead of) the global agent-PR search. A seed is an
   *  agent-attributed commit or PR a prior instrument surfaced as a lead (e.g.
   *  the backward miner's outcome-bad reverts), carried into the proof tier
   *  without re-discovering it. Shape: [{repo, sha?|prNumber?, title, body,
   *  vendor, outcome?}]. */
  seeds: string | null;
}

interface Seed {
  repo: string;
  sha?: string;
  prNumber?: number;
  title?: string;
  body?: string;
  vendor?: string;
  outcome?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    target: 200,
    perVendor: 30,
    months: 12,
    minLines: 10,
    maxLines: 8_000,
    maxEg: 25,
    apiBudget: 1_500,
    wallClockMs: 4 * 60 * 60 * 1000,
    egWallClockMs: 8 * 60 * 1000,
    seeds: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (v === undefined) continue;
    if (k === '--target') (a.target = Number(v)), (i += 1);
    else if (k === '--per-vendor') (a.perVendor = Number(v)), (i += 1);
    else if (k === '--months') (a.months = Number(v)), (i += 1);
    else if (k === '--min-lines') (a.minLines = Number(v)), (i += 1);
    else if (k === '--max-lines') (a.maxLines = Number(v)), (i += 1);
    else if (k === '--max-eg') (a.maxEg = Number(v)), (i += 1);
    else if (k === '--api-budget') (a.apiBudget = Number(v)), (i += 1);
    else if (k === '--wall-clock-ms') (a.wallClockMs = Number(v)), (i += 1);
    else if (k === '--eg-wall-clock-ms') (a.egWallClockMs = Number(v)), (i += 1);
    else if (k === '--seeds') (a.seeds = v), (i += 1);
  }
  return a;
}

/** Pull explicit seed leads into HuntPrs: fetch each one's diff (the PR diff
 *  when prNumber is set, else the commit diff for a sha), so a lead the backward
 *  miner already surfaced reaches the proof tier without being re-discovered. */
async function fetchSeeds(
  octokit: ReturnType<typeof makeOctokit>,
  seeds: Seed[],
  spend: () => boolean,
): Promise<HuntPr[]> {
  const prs: HuntPr[] = [];
  fs.mkdirSync(DIFFS_DIR, { recursive: true });
  for (const s of seeds) {
    if (!spend()) break;
    const target = parseRepo(s.repo);
    let diff = '';
    let headSha = s.sha ?? '';
    let baseSha = '';
    try {
      if (s.prNumber !== undefined) {
        diff = await withRetry(() => fetchPrDiff(octokit, target, s.prNumber as number), `seed diff ${s.repo}#${s.prNumber}`);
        const detail = await withRetry(
          () => octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: s.prNumber as number }),
          `seed pulls.get ${s.repo}#${s.prNumber}`,
        );
        headSha = detail.data.head.sha;
        baseSha = detail.data.base.sha;
      } else if (s.sha !== undefined) {
        const res = await withRetry(
          () =>
            octokit.repos.getCommit({
              owner: target.owner,
              repo: target.repo,
              ref: s.sha as string,
              mediaType: { format: 'diff' },
            }),
          `seed commit diff ${s.repo}@${s.sha}`,
        );
        diff = res.data as unknown as string;
        const meta = await withRetry(
          () => octokit.repos.getCommit({ owner: target.owner, repo: target.repo, ref: s.sha as string }),
          `seed commit meta ${s.repo}@${s.sha}`,
        );
        // Resolve to the FULL 40-char sha: the sandbox does `git fetch origin
        // <sha>`, which needs the full sha (GitHub's allowReachableSHA1InWant),
        // so an abbreviated seed sha would fail the clone.
        headSha = meta.data.sha;
        baseSha = meta.data.parents?.[0]?.sha ?? '';
      } else {
        continue;
      }
    } catch (err) {
      log.warn(`seed fetch failed for ${s.repo} ${s.sha ?? s.prNumber}: ${(err as Error).message}`);
      continue;
    }
    if (diff.trim().length === 0) continue;
    const vendor = s.vendor ?? 'seed';
    const ref = s.prNumber !== undefined ? `pr${s.prNumber}` : `c${(s.sha ?? '').slice(0, 8)}`;
    const id = `${vendor}-${s.repo.replace(/[/]/g, '-')}-${ref}`;
    const diffRel = path.join('diffs', `${id}.diff`);
    fs.writeFileSync(path.join(OUT_DIR, diffRel), diff);
    prs.push({
      id,
      repo: s.repo,
      prNumber: s.prNumber ?? 0,
      headSha,
      baseSha,
      title: s.title ?? '',
      body: s.body ?? '',
      url: s.prNumber !== undefined
        ? `https://github.com/${s.repo}/pull/${s.prNumber}`
        : `https://github.com/${s.repo}/commit/${s.sha}`,
      vendor,
      vendorConfidence: 'seed',
      changedLines: diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^[+-]{3}/.test(l)).length,
      diffPath: diffRel,
      outcome: s.outcome ?? 'unknown',
    });
    log.info(`seed ${id} (${vendor}, outcome=${s.outcome ?? '?'})`);
  }
  return prs;
}

function monthsAgoIso(months: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - months, now.getDate()).toISOString().slice(0, 10);
}

interface FetchFunnel {
  searchCandidates: number;
  excludedOwner: number;
  outsideLineBand: number;
  notAgentConfirmed: number;
  detailFetchFailed: number;
  kept: number;
}

function slugId(vendor: string, repo: string, prNumber: number): string {
  return `${vendor}-${repo.replace(/[/]/g, '-')}-pr${prNumber}`;
}

async function fetchTargetSet(
  octokit: ReturnType<typeof makeOctokit>,
  args: Args,
  spend: () => boolean,
): Promise<{ prs: HuntPr[]; funnel: FetchFunnel; vendorCounts: Record<string, number> }> {
  const since = monthsAgoIso(args.months);
  const prs: HuntPr[] = [];
  const seen = new Set<string>();
  const funnel: FetchFunnel = {
    searchCandidates: 0,
    excludedOwner: 0,
    outsideLineBand: 0,
    notAgentConfirmed: 0,
    detailFetchFailed: 0,
    kept: 0,
  };
  const vendorCounts: Record<string, number> = {};
  fs.mkdirSync(DIFFS_DIR, { recursive: true });

  for (const { vendor, q } of VENDOR_QUERIES) {
    if (prs.length >= args.target) break;
    const query = `${q} merged:>=${since}`;
    let candidates: GlobalSearchPr[];
    if (!spend()) break;
    try {
      candidates = await searchMergedPrsGlobal(octokit, query, args.perVendor * 4);
    } catch (err) {
      log.warn(`search failed for ${vendor}: ${(err as Error).message}`);
      continue;
    }
    funnel.searchCandidates += candidates.length;
    log.info(`${vendor}: ${candidates.length} search candidates`);
    let keptForVendor = 0;
    for (const c of candidates) {
      if (prs.length >= args.target || keptForVendor >= args.perVendor) break;
      const owner = c.repo.split('/')[0] ?? '';
      if (EXCLUDED_OWNERS.has(owner.toLowerCase())) {
        funnel.excludedOwner += 1;
        continue;
      }
      const dedupeKey = `${c.repo}#${c.number}`;
      if (seen.has(dedupeKey)) continue;
      if (!spend()) break;
      const target = parseRepo(c.repo);
      let detail;
      let commits;
      try {
        detail = await withRetry(
          () => octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: c.number }),
          `pulls.get ${c.repo}#${c.number}`,
        );
        commits = await withRetry(
          () => octokit.pulls.listCommits({ owner: target.owner, repo: target.repo, pull_number: c.number, per_page: 100 }),
          `listCommits ${c.repo}#${c.number}`,
        );
      } catch (err) {
        log.debug(`detail fetch failed for ${dedupeKey}: ${(err as Error).message}`);
        funnel.detailFetchFailed += 1;
        continue;
      }
      const changed = detail.data.additions + detail.data.deletions;
      if (changed < args.minLines || changed > args.maxLines) {
        funnel.outsideLineBand += 1;
        continue;
      }
      const attribution = detectAgent({
        prTitle: c.title,
        prBody: c.body,
        headRef: detail.data.head.ref,
        commitMessages: commits.data.map((m) => m.commit.message),
        authors: [
          detail.data.user?.login ?? '',
          ...commits.data.map((m) => m.author?.login ?? m.commit.author?.name ?? ''),
        ].filter((s) => s.length > 0),
      });
      if (attribution === undefined || attribution.confidence === 'low') {
        funnel.notAgentConfirmed += 1;
        continue;
      }
      let diff: string;
      try {
        if (!spend()) break;
        diff = await withRetry(() => fetchPrDiff(octokit, target, c.number), `diff ${c.repo}#${c.number}`);
      } catch (err) {
        log.debug(`diff fetch failed for ${dedupeKey}: ${(err as Error).message}`);
        funnel.detailFetchFailed += 1;
        continue;
      }
      const id = slugId(attribution.vendor, c.repo, c.number);
      const diffRel = path.join('diffs', `${id}.diff`);
      fs.writeFileSync(path.join(OUT_DIR, diffRel), diff);
      seen.add(dedupeKey);
      keptForVendor += 1;
      funnel.kept += 1;
      vendorCounts[attribution.vendor] = (vendorCounts[attribution.vendor] ?? 0) + 1;
      prs.push({
        id,
        repo: c.repo,
        prNumber: c.number,
        headSha: detail.data.head.sha,
        baseSha: detail.data.base.sha,
        title: c.title,
        body: c.body.slice(0, 4_000),
        url: c.url,
        vendor: attribution.vendor,
        vendorConfidence: attribution.confidence,
        changedLines: changed,
        diffPath: diffRel,
        outcome: 'unknown',
      });
      log.info(`kept ${id} (${attribution.vendor}/${attribution.confidence}, ${changed} lines)`);
    }
  }
  return { prs, funnel, vendorCounts };
}


async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const octokit = makeOctokit(resolveGithubToken());
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const startedAt = Date.now();
  let apiCalls = 0;
  const spend = (): boolean => {
    if (apiCalls >= args.apiBudget) return false;
    if (Date.now() - startedAt >= args.wallClockMs) return false;
    apiCalls += 1;
    return true;
  };

  // Seed leads (e.g. the backward miner's outcome-bad reverts) are proven first.
  let seedPrs: HuntPr[] = [];
  if (args.seeds !== null) {
    const seeds = JSON.parse(fs.readFileSync(args.seeds, 'utf8')) as Seed[];
    log.info(`loading ${seeds.length} seed lead(s) from ${args.seeds}`);
    seedPrs = await fetchSeeds(octokit, seeds, spend);
    log.info(`fetched ${seedPrs.length} seed diff(s)`);
  }

  let globalPrs: HuntPr[] = [];
  let fetchFunnel: FetchFunnel = { searchCandidates: 0, excludedOwner: 0, outsideLineBand: 0, notAgentConfirmed: 0, detailFetchFailed: 0, kept: 0 };
  let vendorCounts: Record<string, number> = {};
  if (args.target > 0) {
    log.info(`hunt: fetching up to ${args.target} agent PRs (per-vendor ${args.perVendor}, ${args.months}mo)`);
    const fetched = await fetchTargetSet(octokit, args, spend);
    globalPrs = fetched.prs;
    fetchFunnel = fetched.funnel;
    vendorCounts = fetched.vendorCounts;
    log.info(`fetched ${globalPrs.length} agent PRs (${Object.entries(vendorCounts).map(([v, n]) => `${v}:${n}`).join(', ')})`);
  }

  // Seeds first (highest-value leads), then the global sample; dedupe by id.
  const byId = new Map<string, HuntPr>();
  for (const p of [...seedPrs, ...globalPrs]) if (!byId.has(p.id)) byId.set(p.id, p);
  const prs = [...byId.values()];

  // Screen every fetched PR with the exact corpus viability check.
  log.info(`screening ${prs.length} PRs for EG viability`);
  const viability: { id: string; viable: boolean; reason: string; testRunner: string | null }[] = [];
  const viablePrs: HuntPr[] = [];
  for (const pr of prs) {
    if (!spend()) {
      viability.push({ id: pr.id, viable: false, reason: 'skipped-by-cap (api/wall-clock)', testRunner: null });
      continue;
    }
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
    viability.push({ id: pr.id, viable: rec.viable, reason: rec.reason, testRunner: rec.testRunner });
    if (rec.viable) viablePrs.push(pr);
  }
  log.info(`viable: ${viablePrs.length}/${prs.length}`);

  // Run the proof tier on the viable subset, bounded by max-eg and wall clock.
  const records: ProofRecord[] = [];
  const skippedByCap: string[] = [];
  let egRuns = 0;
  for (const pr of viablePrs) {
    const overWall = Date.now() - startedAt >= args.wallClockMs;
    if (egRuns >= args.maxEg || overWall) {
      skippedByCap.push(pr.id);
      const r: ProofRecord = {
        id: pr.id, repo: pr.repo, prNumber: pr.prNumber, url: pr.url, headSha: pr.headSha,
        vendor: pr.vendor, outcome: pr.outcome, outcomeBad: pr.outcome === 'reverted' || pr.outcome === 'hotfixed',
        status: 'skipped-by-cap', provenTriggers: [], proofFunnel: {},
        advisoryFindings: [], mutationRan: false, coverageRan: false, skipped: [],
        note: overWall ? 'not reached within the wall-clock cap' : `not reached within the --max-eg ${args.maxEg} cap`,
      };
      records.push(r);
      writeRecord(RECORDS_DIR, r);
      continue;
    }
    log.info(`proving ${pr.id} (${pr.repo}#${pr.prNumber})`);
    const r = await proveOne(pr, { diffsBaseDir: OUT_DIR, egWallClockMs: args.egWallClockMs });
    egRuns += 1;
    records.push(r);
    writeRecord(RECORDS_DIR, r);
    log.info(`  ${pr.id}: status=${r.status} proven=${r.provenTriggers.length} advisory=${r.advisoryFindings.length}`);
  }

  const proven = records.filter((r) => r.status === 'proven-block');
  const engineFires: Record<string, number> = {};
  for (const r of records) {
    for (const [k, v] of Object.entries(r.proofFunnel)) {
      if (k.endsWith(':proven')) engineFires[k] = (engineFires[k] ?? 0) + v;
    }
  }
  const advisoryByCategory: Record<string, number> = {};
  for (const r of records) for (const f of r.advisoryFindings) advisoryByCategory[f.category] = (advisoryByCategory[f.category] ?? 0) + 1;

  const summary = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/hunt.ts',
    args,
    apiCalls,
    wallClockMs: Date.now() - startedAt,
    fetch: { funnel: fetchFunnel, vendorCounts, seeds: seedPrs.length, globalFetched: globalPrs.length, total: prs.length },
    viability: {
      screened: viability.length,
      viable: viablePrs.length,
      nonViableReasons: viability.filter((v) => !v.viable).reduce<Record<string, number>>((acc, v) => {
        acc[v.reason] = (acc[v.reason] ?? 0) + 1;
        return acc;
      }, {}),
    },
    proof: {
      egRuns,
      provisioned: records.filter((r) => r.status === 'proven-block' || r.status === 'ran-no-proof').length,
      ranNoProof: records.filter((r) => r.status === 'ran-no-proof').length,
      notProvisioned: records.filter((r) => r.status === 'not-provisioned').length,
      errored: records.filter((r) => r.status === 'error').length,
      skippedByCap,
      provenBlocks: proven.length,
      engineFires,
      advisoryByCategory,
    },
    provenCatches: proven.map((r) => ({
      id: r.id, repo: r.repo, prNumber: r.prNumber, url: r.url, headSha: r.headSha,
      triggers: r.provenTriggers,
    })),
    records,
  };
  fs.writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  log.info(
    `hunt done: fetched ${prs.length}, viable ${viablePrs.length}, EG-ran ${egRuns}, ` +
      `proven ${proven.length}; ${apiCalls} API calls, ${Math.round((Date.now() - startedAt) / 1000)}s. -> ${SUMMARY_FILE}`,
  );
  if (proven.length > 0) {
    for (const r of proven) {
      log.warn(`PROVEN CATCH: ${r.repo}#${r.prNumber} (${r.url})`);
      for (const t of r.provenTriggers) log.warn(`  ${t.kind} @ ${t.file} :: reproduce: ${t.reproduce}`);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    log.error(`hunt failed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exitCode = 1;
  });
}
