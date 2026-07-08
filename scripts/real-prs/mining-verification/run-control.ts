// Instrument-verification control runner. Takes a fixed input list of PRs and
// walks each one through the real complaint-mining stages (pattern -> attribution
// -> dual arbiter), recording the per-stage outcome. Used for both the positive
// control (the 27 Hunt-2 cheats: the mining pipeline found them once, it must find
// them again) and the negative control (agent PRs whose complaints are not cheat
// complaints: it must confirm none). The stages are the shipped instruments via
// lib.ts; the arbiter is the exact dual gate mine-complaints.ts runs (Opus prompt
// v2 primary + Opus prompt v1 secondary), reproducible and bounded by a cost
// ceiling. Committed verdicts from a prior mine are reused to avoid re-paying.
//
// Usage:
//   node dist/scripts/real-prs/mining-verification/run-control.js \
//     --input benchmarks/real-prs/mining-verification/hunt2-catalog-27.json \
//     --out benchmarks/real-prs/mining-verification/positive-control.json \
//     --label positive [--arbiter on|off] [--max-cost-usd 0.5] \
//     [--reuse benchmarks/real-prs/wild-cheat-corpus/mined-candidates.json]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../../src/env-loader';
import { getLogger } from '../../../src/logger';
import {
  fetchPrConversation,
  fetchPrDiff,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  withRetry,
  type ConversationEntry,
} from '../lib/github';
import { createArbiter, type Arbiter } from '../lib/arbiter';
import { CostLedger } from '../lib/cost';
import { classifyArbiterAgreement } from '../mine-complaints';
import { attributionModes, patternStage, summarizeControl, type ArbiterRecord, type PrMeta } from './lib';

const log = getLogger('real-prs:mining-verification');

interface Args {
  input: string;
  out: string;
  label: string;
  arbiter: boolean;
  maxCostUsd: number;
  reuse: string | undefined;
  primaryPrompt: string;
  secondaryPrompt: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    input: '',
    out: '',
    label: 'control',
    arbiter: true,
    maxCostUsd: 0.5,
    reuse: undefined,
    primaryPrompt: 'v2',
    secondaryPrompt: 'v1',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' && next !== undefined) (a.input = next), (i += 1);
    else if (arg === '--out' && next !== undefined) (a.out = next), (i += 1);
    else if (arg === '--label' && next !== undefined) (a.label = next), (i += 1);
    else if (arg === '--arbiter' && next !== undefined) (a.arbiter = next !== 'off'), (i += 1);
    else if (arg === '--max-cost-usd' && next !== undefined) (a.maxCostUsd = Number(next)), (i += 1);
    else if (arg === '--reuse' && next !== undefined) (a.reuse = next), (i += 1);
    else if (arg === '--primary-prompt' && next !== undefined) (a.primaryPrompt = next), (i += 1);
    else if (arg === '--secondary-prompt' && next !== undefined) (a.secondaryPrompt = next), (i += 1);
  }
  if (a.input === '' || a.out === '') {
    throw new Error('run-control requires --input <list.json> and --out <result.json>');
  }
  return a;
}

interface InputEntry {
  repo: string;
  prNumber: number;
  url?: string;
  vendor?: string;
  primaryCategory?: string;
  note?: string;
}

function minerId(repo: string, prNumber: number): string {
  return `${repo.replace(/[^\w.-]+/g, '-')}-pr${prNumber}`;
}

/** Committed arbiter verdicts from a prior mine, keyed by miner id, so the 9-of-27
 *  overlap is not re-paid. */
function loadReuseMap(file: string | undefined): Map<string, ArbiterRecord> {
  const map = new Map<string, ArbiterRecord>();
  if (file === undefined || !fs.existsSync(file)) return map;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    candidates?: Array<{ id: string; arbiter: { mode: string; primary?: { model: string; verdict: string; confidence: number }; secondary?: { model: string; verdict: string; confidence: number }; agreed?: boolean; confirmed: boolean | null } }>;
  };
  for (const c of parsed.candidates ?? []) {
    if (c.arbiter.mode === 'dual' && c.arbiter.primary !== undefined && c.arbiter.secondary !== undefined) {
      map.set(c.id, {
        source: 'reused-committed',
        primary: c.arbiter.primary,
        secondary: c.arbiter.secondary,
        agreed: c.arbiter.agreed ?? false,
        confirmed: c.arbiter.confirmed,
      });
    }
  }
  return map;
}

interface OctokitLike {
  pulls: {
    get(p: { owner: string; repo: string; pull_number: number }): Promise<{ data: { title: string; body: string | null; user: { login: string } | null; head: { ref: string } } }>;
    listCommits: unknown;
  };
  paginate(fn: unknown, p: unknown): Promise<Array<{ commit: { message: string } }>>;
}

async function fetchMeta(octokit: OctokitLike, repo: string, prNumber: number): Promise<PrMeta> {
  const target = parseRepo(repo);
  const pr = await withRetry(
    () => octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: prNumber }),
    `pr ${repo}#${prNumber}`,
  );
  let commitMessages: string[] = [];
  try {
    const commits = await withRetry(
      () => octokit.paginate(octokit.pulls.listCommits, { owner: target.owner, repo: target.repo, pull_number: prNumber, per_page: 100 }),
      `commits ${repo}#${prNumber}`,
    );
    commitMessages = commits.map((c) => c.commit.message);
  } catch (err) {
    log.debug(`listCommits failed for ${repo}#${prNumber}: ${String(err)}`);
  }
  return {
    title: pr.data.title ?? '',
    body: pr.data.body ?? '',
    authorLogin: pr.data.user?.login ?? '',
    headRef: pr.data.head?.ref ?? '',
    commitMessages,
  };
}

async function runArbiter(
  primary: Arbiter,
  secondary: Arbiter,
  category: string,
  meta: PrMeta,
  phrase: string,
  diff: string,
): Promise<ArbiterRecord> {
  const input = {
    prTitle: meta.title,
    prBodyExcerpt: meta.body.slice(0, 1500),
    category,
    findingMessage: `A maintainer complaint names this PR as ${category}: "${phrase}"`,
    findingEvidence: phrase,
    findingRationale: 'A human reviewer flagged this PR with cheat language naming the category.',
    diffSlice: diff.slice(0, 6000),
  };
  const [p, s] = await Promise.all([primary.classify(input), secondary.classify(input)]);
  const { agreed, confirmed } = classifyArbiterAgreement(p.verdict, s.verdict);
  return {
    source: 'fresh',
    primary: { model: primary.modelId, verdict: p.verdict, confidence: p.confidence },
    secondary: { model: secondary.modelId, verdict: s.verdict, confidence: s.confidence },
    agreed,
    confirmed,
  };
}

interface ResultEntry {
  id: string;
  repo: string;
  prNumber: number;
  url: string;
  vendor?: string;
  note?: string;
  fetchError?: string;
  pattern: { hit: boolean; category?: string; phrase?: string; source?: string; signals: unknown[] };
  attribution: {
    minerMode: { vendor: string; confidence: string; source: string } | null;
    fullMode: { vendor: string; confidence: string; source: string } | null;
    minerAttributed: boolean;
    fullAttributed: boolean;
  };
  arbiter?: ArbiterRecord | undefined;
  reachedArbiterInPipeline: boolean;
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const octokit = makeOctokit(resolveGithubToken()) as unknown as OctokitLike;
  const list = JSON.parse(fs.readFileSync(args.input, 'utf8')) as { entries: InputEntry[] };
  const reuse = loadReuseMap(args.reuse);
  const ledger = new CostLedger(args.maxCostUsd);

  let primary: Arbiter | undefined;
  let secondary: Arbiter | undefined;
  if (args.arbiter) {
    primary = await createArbiter({ provider: 'anthropic', ledger, promptVersion: args.primaryPrompt });
    secondary = await createArbiter({ provider: 'anthropic', ledger, promptVersion: args.secondaryPrompt });
    log.info(`dual arbiter: ${primary.modelId}/${args.primaryPrompt} + ${secondary.modelId}/${args.secondaryPrompt}, ceiling $${args.maxCostUsd}`);
  }

  const results: ResultEntry[] = [];
  for (const e of list.entries) {
    const id = minerId(e.repo, e.prNumber);
    const url = e.url ?? `https://github.com/${e.repo}/pull/${e.prNumber}`;
    const base: ResultEntry = {
      id,
      repo: e.repo,
      prNumber: e.prNumber,
      url,
      ...(e.vendor !== undefined ? { vendor: e.vendor } : {}),
      ...(e.note !== undefined ? { note: e.note } : {}),
      pattern: { hit: false, signals: [] },
      attribution: { minerMode: null, fullMode: null, minerAttributed: false, fullAttributed: false },
      reachedArbiterInPipeline: false,
    };
    let meta: PrMeta;
    let conversation: ConversationEntry[];
    let diff: string;
    try {
      meta = await fetchMeta(octokit, e.repo, e.prNumber);
      conversation = await withRetry(() => fetchPrConversation(octokit as never, parseRepo(e.repo), e.prNumber), `conv ${id}`);
      diff = await withRetry(() => fetchPrDiff(octokit as never, parseRepo(e.repo), e.prNumber), `diff ${id}`);
    } catch (err) {
      base.fetchError = String(err);
      results.push(base);
      log.warn(`fetch failed for ${id}: ${String(err)}`);
      continue;
    }

    const ps = patternStage(conversation);
    const am = attributionModes(meta);
    base.pattern = {
      hit: ps.hit,
      ...(ps.signals[0] !== undefined ? { category: ps.signals[0].category, phrase: ps.signals[0].phrase, source: ps.signals[0].source } : {}),
      signals: ps.signals,
    };
    base.attribution = {
      minerMode: am.minerMode ? { vendor: am.minerMode.vendor, confidence: am.minerMode.confidence, source: am.minerMode.source } : null,
      fullMode: am.fullMode ? { vendor: am.fullMode.vendor, confidence: am.fullMode.confidence, source: am.fullMode.source } : null,
      minerAttributed: am.minerMode !== undefined,
      fullAttributed: am.fullMode !== undefined,
    };

    // The mine reaches the arbiter only on a pattern hit for a miner-attributed PR.
    base.reachedArbiterInPipeline = ps.hit && am.minerMode !== undefined;

    if (args.arbiter && ps.hit) {
      const category = ps.signals[0]!.category;
      const phrase = ps.signals[0]!.phrase;
      const reused = reuse.get(id);
      if (reused !== undefined) {
        base.arbiter = reused;
      } else if (primary !== undefined && secondary !== undefined && ledger.remainingUsd() > 0.1) {
        try {
          base.arbiter = await runArbiter(primary, secondary, category, meta, phrase, diff);
        } catch (err) {
          log.warn(`arbiter skipped for ${id} (budget/error): ${String(err)}`);
        }
      }
    }
    results.push(base);
    log.info(
      `${id}: pattern=${ps.hit ? (ps.signals[0]?.category ?? 'hit') : 'miss'} miner=${base.attribution.minerAttributed} full=${base.attribution.fullAttributed} arbiter=${base.arbiter ? base.arbiter.confirmed : 'n/a'}`,
    );
  }

  const summary = summarizeControl(
    results.map((r) => ({
      pattern: { hit: r.pattern.hit },
      attribution: { minerAttributed: r.attribution.minerAttributed, fullAttributed: r.attribution.fullAttributed },
      ...(r.arbiter !== undefined ? { arbiter: { confirmed: r.arbiter.confirmed, agreed: r.arbiter.agreed } } : {}),
    })),
  );

  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/mining-verification/run-control.ts',
    label: args.label,
    input: args.input,
    arbiterConfig: args.arbiter ? { primary: `anthropic/${args.primaryPrompt}`, secondary: `anthropic/${args.secondaryPrompt}` } : null,
    reuse: args.reuse ?? null,
    cost: ledger.summary(),
    summary,
    entries: results,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(out, null, 2)}\n`);
  log.info(`${args.label}: ${JSON.stringify(summary)}; $${ledger.spentUsd().toFixed(2)} -> ${args.out}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
