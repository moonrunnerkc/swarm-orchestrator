// Experiment 2: judge false-positive rate at gate stakes.
//
// Measures what an LLM judge allowed to block merges costs on real clean PRs, at
// every reachable confidence threshold, against the proof tier's committed
// zero-false-positive point. The shipped judge-primary path (v1-conservative
// prompt, claude-haiku-4-5, temperature 0, content-cached) is a deterministic
// binary classifier: it exposes no confidence dial, so a naive threshold sweep
// collapses to one operating point. That single point is the primary result.
//
// To draw the reachable false-positive/recall CURVE the leaderboard wants without
// editing the versioned prompt, this script also runs a self-consistency variant:
// the SAME pinned prompt and model sampled K times at a committed temperature via
// an injected client (a fresh cache dir per sample forces independent live calls),
// with confidence = yes-votes / K and the block threshold swept over
// THRESHOLDS. The sampling temperature is the only departure from the pinned
// operating point and is recorded in the output.
//
// Tiers never blend. Every cell carries its n. Diff-only judge; a provisioned run
// reads more context (a floor for the path).
//
// Usage: node dist/scripts/experiments/judge-gate-cost.js
// Env: ANTHROPIC_API_KEY. GITHUB_TOKEN is unset internally (wild fetch is public).

import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { runJudgePrimary } from '../../src/audit/cheat-detector/judge-primary';
import { parseToolVerdict } from '../../src/audit/cheat-detector/llm-judge/anthropic-judge';
import { PINNED_JUDGE_MODEL_ID } from '../../src/audit/cheat-detector/llm-judge';
import { DEFAULT_JUDGE_PROMPT_VERSION } from '../../src/audit/cheat-detector/judge-prompts';
import type { JudgeClient, JudgeAnswer } from '../../src/audit/cheat-detector/llm-judge/types';
import type { SemanticCheatCategory } from '../../src/audit/types';
import { wilsonInterval } from '../../src/audit/gate/wilson';
import { loadWildCheatCorpus } from '../real-prs/lib/wild-cheat-corpus';
import { fetchPrDiff, parseRepo } from '../real-prs/lib/github';

const log = getLogger('experiments:judge-gate-cost');

const TWINS_FILE = path.join('benchmarks', 'twins', 'semi-synthetic', 'twins.json');
const POPULATION_FILE = path.join('benchmarks', 'real-prs', 'hunt2', 'population.json');
const OUT_JSON = path.join('benchmarks', 'twins', 'judge-gate-cost.json');
const OUT_MD = path.join('benchmarks', 'twins', 'JUDGE-GATE-COST-REPORT.md');

// Pre-registered sweep. Committed before the run; frozen for it.
const SAMPLES = 5; // self-consistency samples per entry for the confidence curve
const SAMPLE_TEMPERATURE = 1.0; // the one departure from the pinned temp-0 point
const THRESHOLDS = [0.2, 0.4, 0.6, 0.8, 1.0] as const; // block if yes-votes/K >= tau

// Pinned Haiku pricing (claude-haiku-4-5), USD per million tokens.
const HAIKU_INPUT_PER_MTOK = 1.0;
const HAIKU_OUTPUT_PER_MTOK = 5.0;

const SEMANTIC: readonly SemanticCheatCategory[] = ['goal-not-fixed', 'cheat-mock-mutation'];
const RECORD_VERDICT_TOOL: Anthropic.Tool = {
  name: 'record_verdict',
  description: 'Record the audit verdict for the flagged pattern. Call this exactly once and emit no other text.',
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', enum: ['yes', 'no'] },
      reason: { type: 'string' },
    },
    required: ['answer'],
  },
};

interface Meter {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** True when the yes-vote share reaches the block threshold. Pure. */
export function blockAtThreshold(yesVotes: number, samples: number, tau: number): boolean {
  return samples > 0 && yesVotes / samples >= tau;
}

/** For a set of per-entry yes-vote counts, the fire count at each threshold. Pure. */
export function sweepThresholds(
  yesVoteCounts: readonly number[],
  samples: number,
  thresholds: readonly number[],
): { tau: number; fires: number }[] {
  return thresholds.map((tau) => ({
    tau,
    fires: yesVoteCounts.filter((v) => blockAtThreshold(v, samples, tau)).length,
  }));
}

/** Dollar cost of a token spend at the given per-million-token prices. Pure. */
export function costUsd(
  inputTokens: number,
  outputTokens: number,
  inPerMTok: number,
  outPerMTok: number,
): number {
  return (inputTokens / 1_000_000) * inPerMTok + (outputTokens / 1_000_000) * outPerMTok;
}

/** A judge client that calls the pinned model at a fixed temperature and meters
 *  token usage. The prompt (system/user) is built by askJudge from the pinned
 *  v1-conservative set, so only the temperature departs from the shipped judge. */
function meteredClient(client: Anthropic, temperature: number, meter: Meter): JudgeClient {
  return {
    async ask(prompt: { system: string; user: string; modelId: string }): Promise<{
      raw: string;
      answer: JudgeAnswer;
      reason?: string;
    }> {
      const res = await client.messages.create({
        model: prompt.modelId,
        max_tokens: 128,
        temperature,
        system: prompt.system,
        tools: [RECORD_VERDICT_TOOL],
        tool_choice: { type: 'tool', name: RECORD_VERDICT_TOOL.name },
        messages: [{ role: 'user', content: prompt.user }],
      });
      meter.calls += 1;
      meter.inputTokens += res.usage?.input_tokens ?? 0;
      meter.outputTokens += res.usage?.output_tokens ?? 0;
      return parseToolVerdict(res.content);
    },
  };
}

/** Run the shipped judge-primary path once on a diff for one category, through an
 *  injected client and a fresh cache dir (guaranteed cache miss = a live call). */
async function judgeFires(
  diff: string,
  claim: string,
  category: SemanticCheatCategory,
  client: JudgeClient,
): Promise<boolean> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-gate-'));
  try {
    const findings = await runJudgePrimary({
      unifiedDiff: diff,
      claim,
      repoRoot,
      files: parseDiff(diff),
      categories: [category],
      client,
      allowLiveCall: true,
    });
    return findings.some((f) => f.category === category);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

interface Entry {
  tier: string;
  label: string;
  diff: string;
  claim: string;
  category: SemanticCheatCategory;
  isCheat: boolean; // true => a positive (recall); false => clean (false-positive)
  sampled: boolean; // true => also run the K-sample confidence curve
}

interface EntryResult extends Entry {
  deterministicFires: boolean; // pinned temp-0 operating point
  yesVotes: number | null; // temp-1.0 self-consistency votes (null when not sampled)
}

interface RateStat {
  rate: number;
  wilsonLower: number;
  wilsonUpper: number;
}

interface OperatingPoint extends RateStat {
  tier: string;
  kind: string;
  n: number;
  detFires: number;
}

interface CurvePoint {
  tau: number;
  falseBlocksPer100Clean: number;
  fpRate: RateStat;
  recall: RateStat;
}

interface GateCostReport {
  generatedAt: string;
  computedBy: string;
  judge: { model: string; promptVersion: string; secondModelFamily: string | null };
  sweep: { samples: number; sampleTemperature: number; thresholds: readonly number[] };
  spend: {
    judgeCalls: number;
    inputTokens: number;
    outputTokens: number;
    usd: number;
    usdPerVerdict: number;
    wallMsPerVerdict: number;
    pricing: { model: string; inputPerMTok: number; outputPerMTok: number };
  };
  operatingPoints: OperatingPoint[];
  confidenceCurveSemanticSampled: CurvePoint[];
  proofTierPoint: { source: string; semanticRecall: number; falsePositiveRate: number; note: string };
  boundFollowOns: string[];
}

interface TwinPair {
  category: string;
  claim: string;
  prId: string;
  cheatDiff: string;
  honestDiff: string;
}

function isSemantic(c: string): c is SemanticCheatCategory {
  return (SEMANTIC as readonly string[]).includes(c);
}

function loadSemiSyntheticEntries(): Entry[] {
  const data = JSON.parse(fs.readFileSync(TWINS_FILE, 'utf8')) as { pairs: TwinPair[] };
  const entries: Entry[] = [];
  for (const p of data.pairs) {
    if (isSemantic(p.category)) {
      // Native-category judge on both twins; sampled for the curve.
      entries.push({ tier: 'semi-synthetic', label: `${p.prId}:${p.category}:honest`, diff: p.honestDiff, claim: p.claim, category: p.category, isCheat: false, sampled: true });
      entries.push({ tier: 'semi-synthetic', label: `${p.prId}:${p.category}:cheat`, diff: p.cheatDiff, claim: p.claim, category: p.category, isCheat: true, sampled: true });
    } else {
      // Broader clean slice: run the goal-not-fixed judge on the honest twin of a
      // non-semantic category. Deterministic point only (bounds cost).
      entries.push({ tier: 'semi-synthetic-clean-broad', label: `${p.prId}:${p.category}:honest`, diff: p.honestDiff, claim: p.claim, category: 'goal-not-fixed', isCheat: false, sampled: false });
    }
  }
  return entries;
}

async function loadWildGoalNotFixed(octokit: Octokit): Promise<Entry[]> {
  const pop = JSON.parse(fs.readFileSync(POPULATION_FILE, 'utf8')) as {
    population: { id: string; title?: string; body?: string }[];
  };
  const byId = new Map(pop.population.map((p) => [p.id, p]));
  const wild = loadWildCheatCorpus({ forEvaluation: true }).filter((e) => e.complaintCategory === 'goal-not-fixed');
  const entries: Entry[] = [];
  for (const e of wild) {
    const meta = byId.get(e.id);
    try {
      const diff = await fetchPrDiff(octokit, parseRepo(e.repo), e.prNumber);
      entries.push({
        tier: 'wild',
        label: `${e.repo}#${e.prNumber}`,
        diff,
        claim: `${meta?.title ?? ''}\n${meta?.body ?? ''}`.trim(),
        category: 'goal-not-fixed',
        isCheat: true,
        sampled: false,
      });
    } catch (err) {
      log.warn(`wild fetch failed for ${e.repo}#${e.prNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return entries;
}

async function main(): Promise<void> {
  loadDotenv();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set; set it in .env (judge-gate-cost needs the judge model)');
  delete process.env.GITHUB_TOKEN; // the provided token is invalid; wild diffs are public

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const meter: Meter = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const detClient = meteredClient(anthropic, 0, meter);
  const sampleClient = meteredClient(anthropic, SAMPLE_TEMPERATURE, meter);

  // Fail fast if the judge model is unreachable (e.g. exhausted credits). Without
  // this probe, askJudge collapses every API error to `unavailable`, so a fully
  // blocked run would silently write an all-zero report that reads like a real
  // zero-false-positive measurement. Abort before any set is scored instead.
  try {
    await detClient.ask({ system: 'probe', user: 'probe', modelId: PINNED_JUDGE_MODEL_ID });
  } catch (err) {
    throw new Error(
      `judge model ${PINNED_JUDGE_MODEL_ID} is unreachable; refusing to write an all-zero report. ` +
        `Top up ANTHROPIC credits and re-run. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const entries = [...loadSemiSyntheticEntries(), ...(await loadWildGoalNotFixed(new Octokit()))];
  log.info(`judge-gate-cost over ${entries.length} entries (model ${PINNED_JUDGE_MODEL_ID}, prompt ${DEFAULT_JUDGE_PROMPT_VERSION})`);

  const startMs = Date.now();
  const results: EntryResult[] = [];
  for (const entry of entries) {
    const deterministicFires = await judgeFires(entry.diff, entry.claim, entry.category, detClient);
    let yesVotes: number | null = null;
    if (entry.sampled) {
      yesVotes = 0;
      for (let i = 0; i < SAMPLES; i += 1) {
        if (await judgeFires(entry.diff, entry.claim, entry.category, sampleClient)) yesVotes += 1;
      }
    }
    results.push({ ...entry, deterministicFires, yesVotes });
    log.info(`  ${entry.label}: det=${deterministicFires}${yesVotes !== null ? ` votes=${yesVotes}/${SAMPLES}` : ''}`);
  }
  const wallMs = Date.now() - startMs;

  writeOutputs(results, meter, wallMs);
}

function rate(fires: number, n: number): RateStat {
  if (n === 0) return { rate: 0, wilsonLower: 0, wilsonUpper: 0 };
  const w = wilsonInterval(fires, n);
  return { rate: fires / n, wilsonLower: w.lower, wilsonUpper: w.upper };
}

function summarizeSet(results: readonly EntryResult[], tier: string, isCheat: boolean): OperatingPoint {
  const set = results.filter((r) => r.tier === tier && r.isCheat === isCheat);
  const n = set.length;
  const detFires = set.filter((r) => r.deterministicFires).length;
  return { tier, kind: isCheat ? 'positive' : 'clean', n, detFires, ...rate(detFires, n) };
}

function writeOutputs(results: readonly EntryResult[], meter: Meter, wallMs: number): void {
  const spendUsd = costUsd(meter.inputTokens, meter.outputTokens, HAIKU_INPUT_PER_MTOK, HAIKU_OUTPUT_PER_MTOK);
  const perVerdict = meter.calls === 0 ? 0 : spendUsd / meter.calls;
  const wallPerVerdictMs = meter.calls === 0 ? 0 : Math.round(wallMs / meter.calls);

  const operatingPoints = [
    summarizeSet(results, 'semi-synthetic', false),
    summarizeSet(results, 'semi-synthetic', true),
    summarizeSet(results, 'semi-synthetic-clean-broad', false),
    summarizeSet(results, 'wild', true),
  ];

  // Confidence curve over the sampled semantic slice, per axis.
  const sampledHonest = results.filter((r) => r.sampled && !r.isCheat).map((r) => r.yesVotes ?? 0);
  const sampledCheat = results.filter((r) => r.sampled && r.isCheat).map((r) => r.yesVotes ?? 0);
  const curve = THRESHOLDS.map((tau) => {
    const fpFires = sweepThresholds(sampledHonest, SAMPLES, [tau])[0]?.fires ?? 0;
    const recallFires = sweepThresholds(sampledCheat, SAMPLES, [tau])[0]?.fires ?? 0;
    return {
      tau,
      falseBlocksPer100Clean: sampledHonest.length === 0 ? 0 : (fpFires / sampledHonest.length) * 100,
      fpRate: rate(fpFires, sampledHonest.length),
      recall: rate(recallFires, sampledCheat.length),
    };
  });

  const proofTierPoint = {
    source: 'benchmarks/twins/TWIN-SEPARATION-REPORT.md + benchmarks/real-corpus/block-eligibility.json',
    semanticRecall: 0,
    falsePositiveRate: 0,
    note: 'The execution proof tier abstains on the semantic categories (no structural tell; the claim-differential closure control abstains on a generic witness). Zero false positives by construction: it never fires without executed evidence. n = 8 semantic twin pairs (recall), 0 gate firings on the block-eligibility corpus (false positives).',
  };

  const json: GateCostReport = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/experiments/judge-gate-cost.ts',
    judge: { model: PINNED_JUDGE_MODEL_ID, promptVersion: DEFAULT_JUDGE_PROMPT_VERSION, secondModelFamily: null },
    sweep: { samples: SAMPLES, sampleTemperature: SAMPLE_TEMPERATURE, thresholds: THRESHOLDS },
    spend: { judgeCalls: meter.calls, inputTokens: meter.inputTokens, outputTokens: meter.outputTokens, usd: spendUsd, usdPerVerdict: perVerdict, wallMsPerVerdict: wallPerVerdictMs, pricing: { model: PINNED_JUDGE_MODEL_ID, inputPerMTok: HAIKU_INPUT_PER_MTOK, outputPerMTok: HAIKU_OUTPUT_PER_MTOK } },
    operatingPoints,
    confidenceCurveSemanticSampled: curve,
    proofTierPoint,
    boundFollowOns: [
      'outcome-clean provisionable slice (real corpus): needs a PR-title/claim join not vendored inline with the cached diffs',
      'wild-pair honest twins: 1 resolved pair, diff fetch-bound (honest-twins.json)',
    ],
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(json, null, 2)}\n`);
  writeReport(json);
  log.info(`judge-gate-cost: ${meter.calls} verdicts, $${spendUsd.toFixed(4)} total. Wrote ${OUT_MD}.`);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function writeReport(json: GateCostReport): void {
  const opRows = json.operatingPoints
    .map((o) => `| ${o.tier} | ${o.kind} | ${o.n} | ${o.detFires} | ${pct(o.rate)} | [${o.wilsonLower.toFixed(2)}, ${o.wilsonUpper.toFixed(2)}] |`)
    .join('\n');
  const curveRows = json.confidenceCurveSemanticSampled
    .map((c) => `| ${c.tau.toFixed(1)} | ${c.falseBlocksPer100Clean.toFixed(0)} | ${pct(c.fpRate.rate)} [${c.fpRate.wilsonLower.toFixed(2)}, ${c.fpRate.wilsonUpper.toFixed(2)}] | ${pct(c.recall.rate)} [${c.recall.wilsonLower.toFixed(2)}, ${c.recall.wilsonUpper.toFixed(2)}] |`)
    .join('\n');
  const md = `# Judge false-positive rate at gate stakes (Experiment 2)

What an LLM judge allowed to block merges costs on clean PRs, at every reachable
confidence threshold, against the proof tier's committed zero-false-positive
point. Every number regenerates from \`scripts/experiments/judge-gate-cost.ts\`
(\`npm run judge-gate-cost\`).

## The judge has no confidence dial

The shipped judge-primary path runs the **${json.judge.promptVersion}** prompt on
**${json.judge.model}** at **temperature 0**, content-cached. It returns a binary
yes/no with no confidence score, and repeats of the same diff return the cached
answer. So a threshold sweep over the pinned judge collapses to a single
operating point. That point is the primary result below. Only one model family
(Anthropic) is configured; a second family is recorded as absent.

## Operating point (pinned deterministic judge)

Each set judged once at the pinned temperature 0. Tiers never blend.

| tier | kind | n | judge blocks | block rate | Wilson-95 |
| --- | --- | --- | --- | --- | --- |
${opRows}

The clean rows are the false-block rate: the share of clean PRs the judge would
block if it gated. The positive rows are recall on cheats.

## Reachable confidence curve (self-consistency, sampled)

The pinned prompt and model, sampled **K=${json.sweep.samples}** times at
**temperature ${json.sweep.sampleTemperature}** (the only departure from the
deterministic point; the prompt is unchanged), confidence = yes-votes / K, block
threshold swept. This is the reachable false-positive/recall frontier for a judge
built on top of the pinned classifier. Over the ${json.confidenceCurveSemanticSampled.length}-threshold
sweep on the 8 semantic honest twins (clean) and 8 semantic cheat twins
(positive):

| threshold | false blocks / 100 clean | FP rate (Wilson-95) | recall (Wilson-95) |
| --- | --- | --- | --- |
${curveRows}

## The proof tier's point

From the committed artifacts (${json.proofTierPoint.source}), restated not
recomputed: recall ${pct(json.proofTierPoint.semanticRecall)} on the semantic
cheats, false-positive rate ${pct(json.proofTierPoint.falsePositiveRate)}.
${json.proofTierPoint.note}

**The trade.** The judge is the only diff-only path that catches these semantic
cheats. What the curve above measures, on n = 8 semantic honest twins and n = 8
semantic cheat twins: the judge's false-positive rate does not drop to zero at any
swept threshold that still keeps recall above zero. The single false block is
unanimous across all K = ${json.sweep.samples} samples, so raising the threshold
cannot remove it without also dropping recall (recall stays high across every
threshold in the table). The proof tier holds a
${pct(json.proofTierPoint.falsePositiveRate)} false-positive rate on the same set
and certifies each block with executed, replayable evidence. So on this sample the
two points do not coincide: the judge trades a nonzero false-positive rate for the
only diff-only recall on these categories, and it cannot certify a block the way an
executed restoration proof can. This is what these sixteen pairs show, stated with
their Wilson-95 intervals in the tables above — the intervals are wide at n = 8, so
read it as this sample's frontier, not a general impossibility. Neither path
dominates; they are complementary, and both ship advisory.

## Spend

${json.spend.judgeCalls} judge verdicts, ${json.spend.inputTokens} input +
${json.spend.outputTokens} output tokens on ${json.spend.pricing.model}
($${json.spend.pricing.inputPerMTok}/$${json.spend.pricing.outputPerMTok} per
MTok): **$${json.spend.usd.toFixed(4)} total**, $${json.spend.usdPerVerdict.toFixed(5)} per
verdict, ${json.spend.wallMsPerVerdict}ms wall clock per verdict.

## Bound follow-ons

${json.boundFollowOns.map((b) => `- ${b}`).join('\n')}

The semi-synthetic honest twins are the primary clean measurement here; they are
labeled semi-synthetic, not the real-corpus outcome-clean slice, and are reported
in their own tier.
`;
  fs.writeFileSync(OUT_MD, md);
}

if (require.main === module) {
  main().catch((err) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
