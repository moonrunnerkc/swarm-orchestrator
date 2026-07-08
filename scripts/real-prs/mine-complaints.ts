// Continuous complaint mining: search GitHub PR conversations for maintainer
// cheat-language, verify each hit against the fetched conversation, attribute the
// PR to an agent, and (optionally) confirm the category with a dual arbiter. The
// grown corpus is written for MAINTAINER REVIEW and never folded automatically:
// the complaint-mine workflow uploads it as an artifact, the same review-then-fold
// contract backward-mine.yml uses. Bounded (API budget, wall clock, arbiter cost)
// and checkpointed (--resume) so a cap or crash never loses completed work.
//
// Reuses the shipped instruments: COMPLAINT_SEARCH_PHRASES / extractComplaintSignals
// / fetchPrConversation (lib/github, with the process-wide pacer), detectAgent
// (src/audit/pr-source), and the dual arbiter (lib/arbiter). The arbiter default
// is two Anthropic model tiers because this environment has no local model; the
// shipped agent-incidence default (ollama primary, anthropic secondary) is
// available via --primary-provider / --secondary-provider where a local model runs.
//
// Usage:
//   node dist/scripts/real-prs/mine-complaints.js --limit 20 --api-budget 300 \
//     --wall-clock-ms 1200000 --max-cost-usd 5 [--arbiter off] [--resume]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { detectAgent } from '../../src/audit/pr-source';
import {
  COMPLAINT_SEARCH_PHRASES,
  extractComplaintSignals,
  isMaintainerComplaintEntry,
  fetchPrAgentSignals,
  fetchPrConversation,
  fetchPrDiff,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  searchMergedPrsGlobal,
  withRetry,
  type ComplaintSignal,
} from './lib/github';
import { createArbiter, type Arbiter, type ArbiterProvider } from './lib/arbiter';
import { CostLedger } from './lib/cost';

const log = getLogger('real-prs:mine-complaints');

const OUT_DIR = path.join('benchmarks', 'real-prs', 'wild-cheat-corpus');
const DEFAULT_OUT = path.join(OUT_DIR, 'mined-candidates.json');
const CHECKPOINT = path.join(OUT_DIR, 'mine-checkpoint.json');

interface Args {
  limit: number;
  apiBudget: number;
  wallClockMs: number;
  maxCostUsd: number;
  perPhrase: number;
  arbiter: boolean;
  primaryProvider: ArbiterProvider;
  secondaryProvider: ArbiterProvider;
  primaryModel: string | undefined;
  secondaryModel: string | undefined;
  resume: boolean;
  deepAttribution: boolean;
  out: string;
}

function isProvider(v: string | undefined): v is ArbiterProvider {
  return v === 'anthropic' || v === 'local' || v === 'ollama';
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    limit: 20,
    apiBudget: 400,
    wallClockMs: 20 * 60 * 1000,
    maxCostUsd: 5,
    perPhrase: 8,
    arbiter: true,
    primaryProvider: 'anthropic',
    secondaryProvider: 'anthropic',
    primaryModel: undefined,
    secondaryModel: undefined,
    resume: false,
    deepAttribution: false,
    out: DEFAULT_OUT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--limit' && next !== undefined) (a.limit = Number(next)), (i += 1);
    else if (arg === '--api-budget' && next !== undefined) (a.apiBudget = Number(next)), (i += 1);
    else if (arg === '--wall-clock-ms' && next !== undefined) (a.wallClockMs = Number(next)), (i += 1);
    else if (arg === '--max-cost-usd' && next !== undefined) (a.maxCostUsd = Number(next)), (i += 1);
    else if (arg === '--per-phrase' && next !== undefined) (a.perPhrase = Number(next)), (i += 1);
    else if (arg === '--arbiter' && next !== undefined) (a.arbiter = next !== 'off'), (i += 1);
    else if (arg === '--primary-provider' && isProvider(next)) (a.primaryProvider = next), (i += 1);
    else if (arg === '--secondary-provider' && isProvider(next)) (a.secondaryProvider = next), (i += 1);
    else if (arg === '--primary-model' && next !== undefined) (a.primaryModel = next), (i += 1);
    else if (arg === '--secondary-model' && next !== undefined) (a.secondaryModel = next), (i += 1);
    else if (arg === '--out' && next !== undefined) (a.out = next), (i += 1);
    else if (arg === '--resume') a.resume = true;
    else if (arg === '--deep-attribution') a.deepAttribution = true;
  }
  return a;
}

interface MinedCandidate {
  id: string;
  repo: string;
  prNumber: number;
  url: string;
  vendor: string;
  vendorConfidence: string;
  vendorSource: string;
  /** Whether attribution came from the free title/body/author gate ('cheap') or
   *  the on-demand branch+commit fetch ('deep', only under --deep-attribution). */
  attributionDepth: 'cheap' | 'deep';
  complaintCategory: string;
  complaints: ComplaintSignal[];
  arbiter: {
    mode: 'dual' | 'off';
    primary?: { model: string; verdict: string; confidence: number };
    secondary?: { model: string; verdict: string; confidence: number };
    agreed?: boolean;
    /** confirmed when both arbiters return true-cheat; null on a split. */
    confirmed: boolean | null;
  };
}

interface Checkpoint {
  processedIds: string[];
  candidates: MinedCandidate[];
  funnel: Record<string, number>;
}

function readCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT)) {
    try {
      return JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')) as Checkpoint;
    } catch (err) {
      log.warn(`checkpoint unreadable, starting fresh: ${String(err)}`);
    }
  }
  return { processedIds: [], candidates: [], funnel: {} };
}

function saveCheckpoint(cp: Checkpoint): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT, `${JSON.stringify(cp, null, 2)}\n`);
}

/**
 * Reduce two arbiter verdicts to the agreement gate: confirmed only when both
 * independently return `true-cheat`; a split (disagreement) is confirmed=null so
 * it is excluded from the confirmed count and counted separately, matching the
 * agent-incidence dual-arbiter contract.
 *
 * @param primaryVerdict the primary arbiter's verdict.
 * @param secondaryVerdict the secondary arbiter's verdict.
 * @returns whether the two agreed and whether the candidate is confirmed.
 */
export function classifyArbiterAgreement(
  primaryVerdict: string,
  secondaryVerdict: string,
): { agreed: boolean; confirmed: boolean | null } {
  const agreed = primaryVerdict === secondaryVerdict;
  return { agreed, confirmed: agreed ? primaryVerdict === 'true-cheat' : null };
}

export function dedupeSignals(signals: readonly ComplaintSignal[]): ComplaintSignal[] {
  const seen = new Set<string>();
  const out: ComplaintSignal[] = [];
  for (const s of signals) {
    const key = `${s.category}:${s.phrase.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

async function runArbiterPair(
  primary: Arbiter,
  secondary: Arbiter,
  category: string,
  title: string,
  body: string,
  phrase: string,
  diffSlice: string,
): Promise<MinedCandidate['arbiter']> {
  const input = {
    prTitle: title,
    prBodyExcerpt: body.slice(0, 1500),
    category,
    findingMessage: `A maintainer complaint names this PR as ${category}: "${phrase}"`,
    findingEvidence: phrase,
    findingRationale: 'A human reviewer flagged this PR with cheat language naming the category.',
    diffSlice,
  };
  const [p, s] = await Promise.all([primary.classify(input), secondary.classify(input)]);
  const { agreed, confirmed } = classifyArbiterAgreement(p.verdict, s.verdict);
  return {
    mode: 'dual',
    primary: { model: primary.modelId, verdict: p.verdict, confidence: p.confidence },
    secondary: { model: secondary.modelId, verdict: s.verdict, confidence: s.confidence },
    agreed,
    confirmed,
  };
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const octokit = makeOctokit(resolveGithubToken());
  const started = Date.now();
  let apiCalls = 0;
  const spend = (): boolean => {
    apiCalls += 1;
    return apiCalls <= args.apiBudget && Date.now() - started < args.wallClockMs;
  };

  const cp = args.resume ? readCheckpoint() : { processedIds: [], candidates: [], funnel: {} };
  const processed = new Set(cp.processedIds);
  const bump = (k: string): void => {
    cp.funnel[k] = (cp.funnel[k] ?? 0) + 1;
  };

  const ledger = new CostLedger(args.maxCostUsd);
  let primary: Arbiter | undefined;
  let secondary: Arbiter | undefined;
  if (args.arbiter) {
    primary = await createArbiter({
      provider: args.primaryProvider,
      ledger,
      promptVersion: 'v2',
      ...(args.primaryModel !== undefined ? { anthropicModel: args.primaryModel } : {}),
    });
    secondary = await createArbiter({
      provider: args.secondaryProvider,
      ledger,
      promptVersion: 'v1',
      ...(args.secondaryModel !== undefined ? { anthropicModel: args.secondaryModel } : {}),
    });
    log.info(`dual arbiter: ${primary.modelId} (primary) + ${secondary.modelId} (secondary)`);
  } else {
    log.info('arbiter disabled (--arbiter off); candidates are pattern+attribution only');
  }

  outer: for (const phrase of COMPLAINT_SEARCH_PHRASES) {
    if (cp.candidates.length >= args.limit || !spend()) break;
    let hits;
    try {
      hits = await withRetry(
        () => searchMergedPrsGlobal(octokit, `"${phrase}" in:comments type:pr`, args.perPhrase),
        `search "${phrase}"`,
      );
    } catch (err) {
      log.warn(`search for "${phrase}" failed: ${String(err)}`);
      continue;
    }
    bump('searchHits');
    for (const hit of hits) {
      if (cp.candidates.length >= args.limit) break outer;
      const id = `${hit.repo.replace(/[^\w.-]+/g, '-')}-pr${hit.number}`;
      if (processed.has(id)) continue;
      processed.add(id);
      cp.processedIds.push(id);
      bump('examined');

      const authors = hit.author.length > 0 ? [hit.author] : [];
      let attribution = detectAgent({ prTitle: hit.title, prBody: hit.body, authors });
      let attributionDepth: 'cheap' | 'deep' = 'cheap';
      // A PR whose only agent tell is its head branch or a commit trailer is
      // invisible to the title/body/author gate. Under --deep-attribution, spend
      // one extra fetch to recover it; this is the narrowing the instrument
      // regression set proved (the miner re-detected 9 of 27, the fingerprinter 26).
      if (attribution === undefined && args.deepAttribution && spend()) {
        const sig = await withRetry(
          () => fetchPrAgentSignals(octokit, parseRepo(hit.repo), hit.number),
          `agent-signals ${id}`,
        ).catch(() => ({ headRef: '', commitMessages: [] }));
        attribution = detectAgent({ prTitle: hit.title, prBody: hit.body, authors, headRef: sig.headRef, commitMessages: sig.commitMessages });
        attributionDepth = 'deep';
        if (attribution !== undefined) bump('attribution-deep-recovered');
      }
      if (attribution === undefined) {
        bump('not-agent-attributed');
        continue;
      }
      if (!spend()) break outer;
      let conversation;
      try {
        conversation = await withRetry(
          () => fetchPrConversation(octokit, parseRepo(hit.repo), hit.number),
          `conversation ${id}`,
        );
      } catch (err) {
        log.warn(`conversation fetch for ${id} failed: ${String(err)}`);
        continue;
      }
      // Definitional restoration: a maintainer complaint comes from a human other
      // than the PR author. Drop self-comments (the author describing their own
      // change) and any bot that slipped past the fetch filter before matching, so
      // "someone typed the word cheat" cannot pass as "a maintainer called it one".
      const maintainerEntries = conversation.filter((c) => isMaintainerComplaintEntry(c, hit.author));
      const signals = dedupeSignals(
        maintainerEntries.flatMap((c) => extractComplaintSignals(c.body, c.source)),
      );
      if (signals.length === 0) {
        // Distinguish "no cheat phrase at all" from "a cheat phrase, but only from
        // the PR author or a bot" so the funnel shows the tightening's effect.
        const selfOrBotSignals = dedupeSignals(
          conversation.flatMap((c) => extractComplaintSignals(c.body, c.source)),
        );
        bump(selfOrBotSignals.length > 0 ? 'complaint-self-or-bot-only' : 'complaint-not-confirmed-in-conversation');
        continue;
      }
      bump('complaint-confirmed');

      let arbiter: MinedCandidate['arbiter'] = { mode: 'off', confirmed: null };
      if (primary !== undefined && secondary !== undefined && spend()) {
        try {
          const diff = await withRetry(() => fetchPrDiff(octokit, parseRepo(hit.repo), hit.number), `diff ${id}`);
          arbiter = await runArbiterPair(primary, secondary, signals[0]!.category, hit.title, hit.body, signals[0]!.phrase, diff.slice(0, 6000));
          if (arbiter.agreed === false) bump('arbiter-split');
          else if (arbiter.confirmed === true) bump('arbiter-confirmed');
          else bump('arbiter-not-cheat');
        } catch (err) {
          log.warn(`arbiter for ${id} failed (recording pattern-only): ${String(err)}`);
        }
      }

      cp.candidates.push({
        id,
        repo: hit.repo,
        prNumber: hit.number,
        url: hit.url,
        vendor: attribution.vendor,
        vendorConfidence: attribution.confidence,
        vendorSource: attribution.source,
        attributionDepth,
        complaintCategory: signals[0]!.category,
        complaints: signals,
        arbiter,
      });
      bump('accepted');
      saveCheckpoint(cp);
      log.info(`  + ${id} (${signals[0]!.category}, ${attribution.vendor}, arbiter=${arbiter.confirmed ?? arbiter.mode})`);
    }
  }

  const splits = cp.candidates.filter((c) => c.arbiter.agreed === false).length;
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/mine-complaints.ts',
    note:
      'Complaint-mined agent-PR candidates for MAINTAINER REVIEW. Not folded into the corpus. ' +
      'Each carries the maintainer complaint, agent attribution, and a dual-arbiter category ' +
      'confirmation; arbiter splits are excluded from the confirmed count and reported.',
    args: { ...args },
    apiCalls,
    wallClockMs: Date.now() - started,
    arbiterCostUsd: ledger.spentUsd(),
    funnel: cp.funnel,
    counts: {
      candidates: cp.candidates.length,
      arbiterConfirmed: cp.candidates.filter((c) => c.arbiter.confirmed === true).length,
      arbiterSplits: splits,
    },
    candidates: cp.candidates,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(out, null, 2)}\n`);
  log.info(
    `mine-complaints: ${cp.candidates.length} candidate(s), ${out.counts.arbiterConfirmed} arbiter-confirmed, ` +
      `${splits} split; ${apiCalls} API calls, $${ledger.spentUsd().toFixed(2)} arbiter cost -> ${args.out}`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
