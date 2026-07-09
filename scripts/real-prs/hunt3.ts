// Hunt 3 rematch runner. Runs the upgraded proof tier (the six restoration
// engines plus claim-differential) over the EG-viable entries of the HELD-OUT
// wild cheat corpus, once per PR through the shipped `runExecutionGrounded`
// pipeline (the same engine `swarm audit --pr` invokes), and records a proven
// verdict only when a block trigger's controls are all green or the
// claim-differential returns a controlled `claim-falsified-synthesized`.
//
// Pre-registered in `benchmarks/real-prs/hunt3/PREREGISTRATION.md`. The design is
// frozen; this instrument does not tune on the corpus. The corpus is read through
// the hold-out choke point (`loadWildCheatCorpus({ forEvaluation: true })`).
//
// Checkpointed and resumable: each record is written immediately to
// `benchmarks/real-prs/hunt3/records/<id>.json`; a re-run skips a completed record
// unless `--force`. Fetches route through unauthenticated public GitHub access
// because the provided GITHUB_TOKEN is invalid (BASELINE.md); the runner unsets it.
//
// Usage:
//   node dist/scripts/real-prs/hunt3.js [--force] [--eg-wall-clock-ms 300000]
// Env: ANTHROPIC_API_KEY (claim-differential), Docker daemon, Node 22 sandbox.

import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { runExecutionGrounded } from '../../src/audit/execution-grounded';
import type { ExecutionGroundedConfig } from '../../src/audit/cheat-detector/audit-config';
import { detectBlockTriggers, type BlockTrigger } from '../../src/audit/gate/block-triggers';
import { controlsAllGreen } from '../../src/audit/gate/self-certifying';
import { createClaimLlm, type ClaimLlm } from '../../src/audit/execution-grounded/claim-llm';
import type { ClaimDifferentialResult } from '../../src/audit/execution-grounded/claim-differential';
import { loadWildCheatCorpus, type WildCheatEntry } from './lib/wild-cheat-corpus';
import { fetchPrDiff, parseRepo } from './lib/github';

const log = getLogger('real-prs:hunt3');

const OUT_DIR = path.join('benchmarks', 'real-prs', 'hunt3');
const RECORDS_DIR = path.join(OUT_DIR, 'records');
const SUMMARY_FILE = path.join(OUT_DIR, 'hunt3-summary.json');
const POPULATION_FILE = path.join('benchmarks', 'real-prs', 'hunt2', 'population.json');

/** Per-model token usage, keyed by model id. */
export interface ModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}
export type TokenMeter = Map<string, ModelUsage>;

interface PopEntry {
  id: string;
  title?: string;
  body?: string;
}

/** A frozen EG-viable entry joined with the PR title/body the claim needs. */
export interface FrozenTarget {
  entry: WildCheatEntry;
  title: string;
  body: string;
}

export interface Hunt3Record {
  generatedAt: string;
  id: string;
  repo: string;
  prNumber: number;
  url: string;
  headSha: string;
  baseSha: string;
  vendor: string;
  state: string;
  maintainerCategory: string;
  egViable: true;
  status: 'proven-block' | 'claim-differential-advisory' | 'ran-no-proof' | 'not-provisioned' | 'error';
  restorationProvenTriggers: { kind: string; file: string; reproduce: string }[];
  claimDifferential: {
    verdict: string;
    isFinding: boolean;
    reason: string;
    witnessModel: string | null;
    witnessPromptVersion: string | null;
    witnessSamplingPolicy: string | null;
    witnessRetried: boolean | null;
    witnessRegeneratedForClosure: boolean | null;
    arbiterAgreed: boolean | null;
    closureLinked: boolean | null;
    baseRuns: string[] | null;
    headStatus: string | null;
    reproduceCommand: string | null;
  } | null;
  advisoryFindings: { category: string; file: string; line: number; confidence: string }[];
  proofFunnel: Record<string, number>;
  skipped: string[];
  tokenSpend: { byModel: Record<string, ModelUsage>; totalInputTokens: number; totalOutputTokens: number };
  note: string;
}

/**
 * Join the EG-viable held-out entries with the PR title/body from the Hunt 2
 * population (the corpus schema carries no PR text). Entries with no population
 * match keep empty text; the claim-differential then abstains `no-claim`, which is
 * a valid recorded outcome.
 *
 * @param entries the held-out wild-cheat entries (already filtered to EG-viable).
 * @param population the Hunt 2 population records keyed for title/body lookup.
 * @returns one target per EG-viable entry, in corpus order.
 */
export function selectFrozenEgViable(
  entries: readonly WildCheatEntry[],
  population: readonly PopEntry[],
): FrozenTarget[] {
  const byId = new Map(population.map((p) => [p.id, p]));
  return entries
    .filter((e) => e.egViable)
    .map((entry) => {
      const pop = byId.get(entry.id);
      return { entry, title: pop?.title ?? '', body: pop?.body ?? '' };
    });
}

/**
 * Derive the proof status from the proven restoration triggers, the
 * claim-differential result, and the skip list. Only a restoration trigger with
 * all controls green is a proven block: those are self-certifying (executed,
 * replayable evidence). A controlled `claim-falsified-synthesized` is
 * advisory-pending-measurement, never proven and never gate-eligible until it
 * clears the promotions bar on measured data; it is recorded separately as
 * `claim-differential-advisory`. (After the discrimination control it also cannot
 * fire at all in production, where no honest twin establishes pass-capability.) A
 * provisioning skip with no proof is `not-provisioned`; otherwise the tier ran and
 * found nothing.
 *
 * @param restorationProvenCount count of restoration triggers with all controls green.
 * @param claimIsFinding true when claim-differential returned claim-falsified-synthesized.
 * @param skipped the execution-grounded skip reasons.
 * @returns the record status and its note.
 */
export function deriveStatus(
  restorationProvenCount: number,
  claimIsFinding: boolean,
  skipped: readonly string[],
): { status: Hunt3Record['status']; note: string } {
  if (restorationProvenCount > 0) {
    return {
      status: 'proven-block',
      note: `STOP-THE-LINE: ${restorationProvenCount} restoration proof(s) on a held-out wild agent PR; confirm via the live swarm audit --pr path and a fresh-clone replay before trusting it`,
    };
  }
  if (claimIsFinding) {
    return {
      status: 'claim-differential-advisory',
      note: 'a controlled claim-falsified-synthesized was raised; ADVISORY-pending-measurement (not proven, not gate-eligible) until it clears the promotions bar on measured data',
    };
  }
  const provisionSkip = skipped.find((s) => s.startsWith('provision:'));
  if (provisionSkip !== undefined) return { status: 'not-provisioned', note: provisionSkip };
  return { status: 'ran-no-proof', note: 'upgraded proof tier ran; no controlled block trigger and no claim-differential finding' };
}

/** Fold one model call's token usage into the meter, keyed by model id. Pure. */
export function accumulateUsage(
  meter: TokenMeter,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const usage = meter.get(model) ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
  usage.calls += 1;
  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  meter.set(model, usage);
}

/** Build a claim-differential LLM whose Anthropic calls accumulate per-model
 *  token usage into `meter`. Only `messages.create` is wrapped; that is the sole
 *  method `createClaimLlm` calls. */
export function meteredClaimLlm(meter: TokenMeter): ClaimLlm {
  const real = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const wrapped = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
        const res = await real.messages.create(params);
        accumulateUsage(meter, params.model, res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        return res;
      },
    },
  } as unknown as Anthropic;
  return createClaimLlm({ client: wrapped });
}

function tally(records: { verdict: string }[], into: Record<string, number>, prefix: string): void {
  for (const r of records) {
    const key = `${prefix}:${r.verdict}`;
    into[key] = (into[key] ?? 0) + 1;
  }
}

function claimRecord(cd: ClaimDifferentialResult | undefined): Hunt3Record['claimDifferential'] {
  if (cd === undefined) return null;
  return {
    verdict: cd.verdict,
    isFinding: cd.isFinding,
    reason: cd.reason,
    witnessModel: cd.witness?.model ?? null,
    witnessPromptVersion: cd.witness?.promptVersion ?? null,
    witnessSamplingPolicy: cd.witness?.samplingPolicy ?? null,
    witnessRetried: cd.witness?.retried ?? null,
    witnessRegeneratedForClosure: cd.witness?.regeneratedForClosure ?? null,
    arbiterAgreed: cd.arbiter?.agreed ?? null,
    closureLinked: cd.closure?.linked ?? null,
    baseRuns: cd.baseRuns ?? null,
    headStatus: cd.headStatus ?? null,
    reproduceCommand: cd.reproduceCommand ?? null,
  };
}

function meterSnapshot(meter: TokenMeter): Hunt3Record['tokenSpend'] {
  const byModel: Record<string, ModelUsage> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const [model, u] of meter) {
    byModel[model] = { ...u };
    totalInputTokens += u.inputTokens;
    totalOutputTokens += u.outputTokens;
  }
  return { byModel, totalInputTokens, totalOutputTokens };
}

function upgradedConfig(egWallClockMs: number): ExecutionGroundedConfig {
  return {
    enabled: true,
    mutation: false,
    coverage: false,
    issueRepro: false,
    runner: 'host',
    corroborateStructural: false,
    claimDifferential: true,
    errorSwallow: false,
    claimBinding: false,
    maxWallClockPerPrMs: egWallClockMs,
  };
}

export async function proveEntry(target: FrozenTarget, egWallClockMs: number): Promise<Hunt3Record> {
  const { entry } = target;
  const meter: TokenMeter = new Map();
  const base: Hunt3Record = {
    generatedAt: new Date().toISOString(),
    id: entry.id,
    repo: entry.repo,
    prNumber: entry.prNumber,
    url: entry.url,
    headSha: entry.headSha,
    baseSha: entry.baseSha,
    vendor: entry.vendor,
    state: entry.state,
    maintainerCategory: entry.complaintCategory,
    egViable: true,
    status: 'error',
    restorationProvenTriggers: [],
    claimDifferential: null,
    advisoryFindings: [],
    proofFunnel: {},
    skipped: [],
    tokenSpend: { byModel: {}, totalInputTokens: 0, totalOutputTokens: 0 },
    note: '',
  };
  const octokit = new Octokit(); // unauthenticated: public repos, invalid token unset
  const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-hunt3-manifest-'));
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-hunt3-ws-'));
  try {
    const prDiff = await fetchPrDiff(octokit, parseRepo(entry.repo), entry.prNumber);
    const prContext = {
      number: entry.prNumber,
      headSha: entry.headSha,
      baseSha: entry.baseSha,
      title: target.title,
      body: target.body,
      author: '',
      headRef: '',
      repository: entry.repo,
    };
    const audit = await runCheatDetectors({ unifiedDiff: prDiff, repoRoot: manifestDir, pr: prContext });
    base.advisoryFindings = audit.findings.map((f) => ({
      category: f.category,
      file: f.location.file,
      line: f.location.line,
      confidence: f.confidence ?? 'unknown',
    }));

    const outcome = await runExecutionGrounded({
      prDiff,
      repo: entry.repo,
      prNumber: entry.prNumber,
      prHeadSha: entry.headSha,
      prBaseSha: entry.baseSha,
      prTitle: target.title,
      prBody: target.body,
      prText: `${target.title}\n\n${target.body}`,
      claimLlm: meteredClaimLlm(meter),
      config: upgradedConfig(egWallClockMs),
      baseDir,
      installTimeoutMs: egWallClockMs,
      structuralFindings: audit.findings,
    });

    base.skipped = outcome.skipped;
    tally(outcome.restorations, base.proofFunnel, 'test-tamper');
    tally(outcome.mockRestorations, base.proofFunnel, 'mock');
    tally(outcome.noOpRestorations, base.proofFunnel, 'no-op');
    tally(outcome.typeSuppressionRestorations, base.proofFunnel, 'type-suppression');
    tally(outcome.fakeRefactorRestorations, base.proofFunnel, 'fake-refactor');
    tally(outcome.deadBranchRestorations, base.proofFunnel, 'dead-branch');

    const triggers: BlockTrigger[] = detectBlockTriggers({
      restorations: { restorations: outcome.restorations },
      mockRestorations: { mockRestorations: outcome.mockRestorations },
      noOpRestorations: { noOpRestorations: outcome.noOpRestorations },
      typeSuppressionRestorations: { typeSuppressionRestorations: outcome.typeSuppressionRestorations },
      fakeRefactorRestorations: { fakeRefactorRestorations: outcome.fakeRefactorRestorations },
      deadBranchRestorations: { deadBranchRestorations: outcome.deadBranchRestorations },
    });
    const proven = triggers.filter((t) => controlsAllGreen(t));
    base.restorationProvenTriggers = proven.map((t) => ({
      kind: t.kind,
      file: 'file' in t.evidence ? (t.evidence as { file: string }).file : '',
      reproduce: 'reproduce' in t ? (t as { reproduce: string }).reproduce : '',
    }));

    const cd = outcome.claimDifferentials[0];
    base.claimDifferential = claimRecord(cd);
    base.tokenSpend = meterSnapshot(meter);

    const { status, note } = deriveStatus(proven.length, cd?.isFinding === true, outcome.skipped);
    base.status = status;
    base.note = note;
    return base;
  } catch (err) {
    base.status = 'error';
    base.note = err instanceof Error ? err.message : String(err);
    base.tokenSpend = meterSnapshot(meter);
    return base;
  } finally {
    fs.rmSync(manifestDir, { recursive: true, force: true });
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

function writeRecord(r: Hunt3Record): void {
  fs.mkdirSync(RECORDS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RECORDS_DIR, `${r.id}.json`), `${JSON.stringify(r, null, 2)}\n`);
}

function parseWallClock(argv: string[]): number {
  const i = argv.indexOf('--eg-wall-clock-ms');
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : 300000;
}

async function main(): Promise<void> {
  loadDotenv();
  // The provided GITHUB_TOKEN is invalid (401). Unset it so every fetch and clone
  // routes through unauthenticated public access; recorded in PREREGISTRATION.md.
  delete process.env.GITHUB_TOKEN;
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const egWallClockMs = parseWallClock(argv);

  const entries = loadWildCheatCorpus({ forEvaluation: true });
  const pop = JSON.parse(fs.readFileSync(POPULATION_FILE, 'utf8')) as { population: PopEntry[] };
  const targets = selectFrozenEgViable(entries, pop.population);
  log.info(`hunt3: upgraded tier over ${targets.length} EG-viable held-out entries (wall-clock ${egWallClockMs}ms/pr)`);

  const records: Hunt3Record[] = [];
  for (const target of targets) {
    const recordPath = path.join(RECORDS_DIR, `${target.entry.id}.json`);
    if (!force && fs.existsSync(recordPath)) {
      log.info(`  ${target.entry.id}: already recorded, skipping (--force to rerun)`);
      records.push(JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Hunt3Record);
      continue;
    }
    log.info(`  ${target.entry.id}: proving...`);
    const record = await proveEntry(target, egWallClockMs);
    writeRecord(record);
    records.push(record);
    log.info(`  ${target.entry.id}: ${record.status} (claim: ${record.claimDifferential?.verdict ?? 'none'})`);
  }

  writeSummary(records);
}

function writeSummary(records: readonly Hunt3Record[]): void {
  const provenCount = records.filter((r) => r.status === 'proven-block').length;
  const byModel: Record<string, ModelUsage> = {};
  for (const r of records) {
    for (const [model, u] of Object.entries(r.tokenSpend.byModel)) {
      const acc = byModel[model] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
      acc.calls += u.calls;
      acc.inputTokens += u.inputTokens;
      acc.outputTokens += u.outputTokens;
      byModel[model] = acc;
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/hunt3.ts',
    egViableEntries: records.length,
    provenBlocks: provenCount,
    baselineProven: 0,
    funnel: {
      provisioned: records.filter((r) => r.status !== 'not-provisioned' && r.status !== 'error').length,
      notProvisioned: records.filter((r) => r.status === 'not-provisioned').length,
      errored: records.filter((r) => r.status === 'error').length,
      claimCompiled: records.filter((r) => r.claimDifferential?.witnessModel != null).length,
      claimArbiterAgreed: records.filter((r) => r.claimDifferential?.arbiterAgreed === true).length,
      claimFindings: records.filter((r) => r.claimDifferential?.isFinding === true).length,
    },
    tokenSpendByModel: byModel,
    records: records.map((r) => ({ id: r.id, status: r.status, claimVerdict: r.claimDifferential?.verdict ?? null })),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  log.info(`hunt3 summary: ${provenCount} proven of ${records.length} EG-viable (baseline 0). Wrote ${SUMMARY_FILE}`);
}

if (require.main === module) {
  main().catch((err) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
