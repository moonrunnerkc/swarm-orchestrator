// Recall measurement on the v3 wild-cheat corpus (pre-registration amendment 2,
// benchmarks/real-prs/capability-hunt/PREREGISTRATION-AMENDMENT-2.md). Audits the
// EG-viable entries at their recorded baseSha/headSha through the shipped
// `swarm audit --pr --mode gate` path, one arm at a time. An entry whose live PR
// still sits at the recorded SHA pair is audited live; an entry whose PR moved is
// driven through the fail-closed SWARM_PR_FIXTURE_DIR seam with the pinned-pair
// compare diff, so the measurement never silently re-pins. A gate trigger is
// replayed fresh before it counts as proven.
//
// Usage:
//   node dist/scripts/real-prs/recall-v3.js --arm <deterministic|judge>
//     [--only <id>] [--timeout-ms 2400000] [--ceiling-usd 10]
//   node dist/scripts/real-prs/recall-v3.js --screen-nonviable
//
// The judge arm requires ANTHROPIC_API_KEY and stops paid work at the ceiling
// (live judge calls priced at the documented per-call Haiku rate).

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { SELF_CERTIFYING_TRIGGERS } from '../../src/audit/gate/self-certifying';
import { makeOctokit, parseRepo, resolveGithubToken } from './lib/github';
import { screenPr } from './eg-viability-screen';

const log = getLogger('hunt:recall-v3');

const DATASET_FILE = path.join('benchmarks', 'real-prs', 'wild-cheat-corpus', 'v3', 'dataset.json');
const CENSUS_FILE = path.join('benchmarks', 'real-prs', 'hunt3', 'viability-census.json');
const OUT_DIR = path.join('benchmarks', 'real-prs', 'capability-hunt', 'recall-v3');
const FIXTURE_ROOT = path.join('.swarm', 'recall-v3-fixtures');
// The pinned sandbox toolchain every prior evidence run used.
const EG_NODE_BIN = path.join(process.env.HOME ?? '', '.nvm', 'versions', 'node', 'v22.15.0', 'bin');
// Per-call Haiku rate from benchmarks/results/AB-REPORT.md, the same rate
// build-cost-ledger.ts prices billable judge calls at.
const HAIKU_PER_CALL_USD = 0.0045;

interface DatasetEntry {
  id: string;
  repo: string;
  prNumber: number;
  url: string;
  headSha: string;
  baseSha: string;
  complaintCategory: string;
  complaintBar: string;
  egViable: boolean;
  complaints: Array<{ category: string; phrase: string; source: string }>;
}

type Arm = 'deterministic' | 'judge';
type Bucket = 'proven' | 'advisory-found' | 'abstained' | 'not-provisionable';

interface EntryRecord {
  id: string;
  repo: string;
  prNumber: number;
  arm: Arm;
  complaintCategory: string;
  complaintBar: string;
  recordedHeadSha: string;
  recordedBaseSha: string;
  liveHeadSha: string | null;
  liveBaseSha: string | null;
  shasMatch: boolean | null;
  mode: 'live' | 'fixture' | 'none';
  status: 'audited' | 'timeout' | 'error' | 'pr-fetch-failed' | 'sha-unfetchable';
  bucket: Bucket;
  bucketStage?: string;
  pass: boolean | null;
  gateTriggers: string[];
  replayConfirmed: boolean | null;
  advisoryFindings: Array<{ category: string; severity: string }>;
  provisioning: { attempted: boolean; provisioned: boolean; reason?: string } | null;
  enginesApplicable: number;
  enginesExecuted: number;
  abstains: Array<{ engine: string; verdict: string }>;
  elapsedMs: number;
  replayCommand: string;
  detail?: string;
}

function arg(flag: string, fallback: string | null): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

function loadDataset(): DatasetEntry[] {
  return (JSON.parse(fs.readFileSync(DATASET_FILE, 'utf8')) as { entries: DatasetEntry[] }).entries;
}

interface LivePr {
  headSha: string;
  baseSha: string;
  title: string;
  body: string;
  author: string;
  headRef: string;
}

async function fetchLivePr(entry: DatasetEntry): Promise<LivePr> {
  const octokit = makeOctokit(resolveGithubToken());
  const target = parseRepo(entry.repo);
  // One retry: the first request after a multi-minute child audit can die on a
  // stale keep-alive socket (EPIPE / other side closed).
  let res;
  try {
    res = await octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: entry.prNumber });
  } catch {
    res = await octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: entry.prNumber });
  }
  return {
    headSha: res.data.head.sha,
    baseSha: res.data.base.sha,
    title: res.data.title ?? '',
    body: res.data.body ?? '',
    author: res.data.user?.login ?? '',
    headRef: res.data.head.ref ?? '',
  };
}

/** Commit messages at the PINNED head (repos.listCommits walks from that sha),
 *  so fingerprint input matches the audited tree, not the moved branch. */
async function fetchPinnedCommitMessages(entry: DatasetEntry): Promise<string[]> {
  try {
    const octokit = makeOctokit(resolveGithubToken());
    const target = parseRepo(entry.repo);
    const res = await octokit.repos.listCommits({
      owner: target.owner,
      repo: target.repo,
      sha: entry.headSha,
      per_page: 20,
    });
    return res.data.map((c) => c.commit.message);
  } catch {
    return [];
  }
}

/** The pinned-pair unified diff via the compare API. Throws when the pair is no
 *  longer fetchable, which the caller records as sha-unfetchable. */
async function fetchPinnedDiff(entry: DatasetEntry): Promise<string> {
  const octokit = makeOctokit(resolveGithubToken());
  const target = parseRepo(entry.repo);
  const res = await octokit.repos.compareCommitsWithBasehead({
    owner: target.owner,
    repo: target.repo,
    basehead: `${entry.baseSha}...${entry.headSha}`,
    mediaType: { format: 'diff' },
  });
  const data = res.data as unknown;
  if (typeof data !== 'string') throw new Error('compare API returned a non-diff payload');
  return data;
}

function writeFixture(entry: DatasetEntry, live: LivePr, diff: string, messages: string[]): string {
  const dir = path.join(FIXTURE_ROOT, entry.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pr.diff'), diff);
  fs.writeFileSync(
    path.join(dir, 'fixture.json'),
    `${JSON.stringify(
      {
        repo: entry.repo,
        number: entry.prNumber,
        title: live.title,
        body: live.body,
        author: live.author,
        headRef: live.headRef,
        headSha: entry.headSha,
        baseSha: entry.baseSha,
        commitMessages: messages,
        diffPath: 'pr.diff',
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

const GATE_TRIGGER_KINDS = new Set<string>(SELF_CERTIFYING_TRIGGERS as readonly string[]);

interface AuditRun {
  status: 'audited' | 'timeout' | 'error';
  pass: boolean | null;
  gateTriggers: string[];
  advisoryFindings: Array<{ category: string; severity: string }>;
  provisioning: EntryRecord['provisioning'];
  enginesApplicable: number;
  enginesExecuted: number;
  abstains: Array<{ engine: string; verdict: string }>;
  elapsedMs: number;
  detail?: string;
}

function runAudit(entry: DatasetEntry, arm: Arm, ledgerPath: string, fixtureDir: string | null, timeoutMs: number): AuditRun {
  const cliArgs = [
    'dist/src/cli.js',
    'audit',
    '--pr',
    `${entry.repo}#${entry.prNumber}`,
    '--mode',
    'gate',
    '--output',
    'json',
    '--ledger-path',
    ledgerPath,
  ];
  if (arm === 'judge') cliArgs.push('--enable-llm-judge');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${EG_NODE_BIN}${path.delimiter}${process.env.HOME}/go-toolchain/go/bin${path.delimiter}${process.env.PATH ?? ''}`,
    SWARM_EG_NODE_BIN: EG_NODE_BIN,
  };
  if (fixtureDir !== null) env.SWARM_PR_FIXTURE_DIR = path.resolve(fixtureDir);
  else delete env.SWARM_PR_FIXTURE_DIR;
  const started = Date.now();
  const res = spawnSync(path.join(EG_NODE_BIN, 'node'), cliArgs, {
    encoding: 'utf8',
    env,
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - started;
  const base: AuditRun = {
    status: 'audited',
    pass: null,
    gateTriggers: [],
    advisoryFindings: [],
    provisioning: null,
    enginesApplicable: 0,
    enginesExecuted: 0,
    abstains: [],
    elapsedMs,
  };
  if (res.error !== undefined && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { ...base, status: 'timeout', detail: `audit exceeded ${timeoutMs}ms` };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.stdout ?? '') as Record<string, unknown>;
  } catch {
    return { ...base, status: 'error', detail: `unparseable audit output: ${(res.stderr ?? '').slice(-400)}` };
  }
  const findings = Array.isArray(parsed.findings) ? (parsed.findings as Array<Record<string, unknown>>) : [];
  const triggers = Array.isArray(parsed.blockingTriggers)
    ? (parsed.blockingTriggers as Array<Record<string, unknown>>)
    : [];
  const pc = (parsed.proofCoverage ?? {}) as Record<string, unknown>;
  const summary = (pc.summary ?? {}) as Record<string, number>;
  const engines = Array.isArray(pc.engines) ? (pc.engines as Array<Record<string, unknown>>) : [];
  const abstains: Array<{ engine: string; verdict: string }> = [];
  for (const e of engines) {
    const records = Array.isArray(e.records) ? (e.records as Array<Record<string, unknown>>) : [];
    for (const r of records) {
      if (r.outcome === 'abstain' && typeof r.verdict === 'string') {
        abstains.push({ engine: String(e.engine ?? 'unknown'), verdict: r.verdict });
      }
    }
  }
  return {
    ...base,
    pass: typeof parsed.pass === 'boolean' ? parsed.pass : null,
    gateTriggers: triggers.map((t) => (typeof t.kind === 'string' ? t.kind : '')).filter((k) => GATE_TRIGGER_KINDS.has(k)),
    advisoryFindings: findings.map((f) => ({
      category: String(f.category ?? 'unknown'),
      severity: String(f.severity ?? 'unknown'),
    })),
    provisioning: (pc.provisioning ?? null) as EntryRecord['provisioning'],
    enginesApplicable: Number(summary.enginesApplicable ?? 0),
    enginesExecuted: Number(summary.enginesExecuted ?? 0),
    abstains,
  };
}

function classify(rec: EntryRecord): void {
  if (rec.status === 'pr-fetch-failed') {
    rec.bucket = 'not-provisionable';
    rec.bucketStage = 'pr-fetch';
  } else if (rec.status === 'sha-unfetchable') {
    rec.bucket = 'not-provisionable';
    rec.bucketStage = 'sha-fetch';
  } else if (rec.status === 'timeout') {
    rec.bucket = 'not-provisionable';
    rec.bucketStage = 'wall-clock-timeout';
  } else if (rec.status === 'error') {
    rec.bucket = 'not-provisionable';
    rec.bucketStage = 'audit-error';
  } else if (rec.provisioning !== null && rec.provisioning.attempted && !rec.provisioning.provisioned) {
    rec.bucket = 'not-provisionable';
    rec.bucketStage = `provision: ${rec.provisioning.reason ?? 'unknown'}`;
  } else if (rec.gateTriggers.length > 0 && rec.replayConfirmed === true) {
    rec.bucket = 'proven';
  } else if (rec.advisoryFindings.length > 0) {
    rec.bucket = 'advisory-found';
  } else {
    rec.bucket = 'abstained';
  }
}

/** Billable (cacheHit=false) llm-judge-result entries across every ledger under dir. */
function countLiveJudgeCalls(ledgerDir: string): number {
  if (!fs.existsSync(ledgerDir)) return 0;
  let live = 0;
  for (const f of fs.readdirSync(ledgerDir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(ledgerDir, f), 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        const e = JSON.parse(line) as { type?: string; cacheHit?: boolean };
        if (e.type === 'llm-judge-result' && e.cacheHit === false) live += 1;
      } catch {
        continue;
      }
    }
  }
  return live;
}

async function measureArm(arm: Arm): Promise<void> {
  const timeoutMs = Number(arg('--timeout-ms', '2400000'));
  const ceilingUsd = Number(arg('--ceiling-usd', '10'));
  const only = arg('--only', null);
  const entries = loadDataset().filter((e) => e.egViable && (only === null || e.id === only));
  if (arm === 'judge' && (process.env.ANTHROPIC_API_KEY ?? '').length === 0) {
    throw new Error('judge arm requires ANTHROPIC_API_KEY; load it from .env or record the arm as not-run');
  }
  const recordsDir = path.join(OUT_DIR, 'records');
  const ledgerDir = path.join(OUT_DIR, 'ledgers', arm);
  fs.mkdirSync(recordsDir, { recursive: true });
  fs.mkdirSync(ledgerDir, { recursive: true });

  const records: EntryRecord[] = [];
  let stoppedAtCeiling = false;
  for (const entry of entries) {
    const recordFile = path.join(recordsDir, `${entry.id}.${arm}.json`);
    if (fs.existsSync(recordFile)) {
      records.push(JSON.parse(fs.readFileSync(recordFile, 'utf8')) as EntryRecord);
      log.info(`skip (checkpoint): ${entry.id}`);
      continue;
    }
    if (arm === 'judge') {
      const cost = countLiveJudgeCalls(ledgerDir) * HAIKU_PER_CALL_USD;
      if (cost >= ceilingUsd) {
        stoppedAtCeiling = true;
        log.error(`cost ceiling reached (USD ${cost.toFixed(2)} >= ${ceilingUsd}); stopping paid work`);
        break;
      }
    }
    const rec: EntryRecord = {
      id: entry.id,
      repo: entry.repo,
      prNumber: entry.prNumber,
      arm,
      complaintCategory: entry.complaintCategory,
      complaintBar: entry.complaintBar,
      recordedHeadSha: entry.headSha,
      recordedBaseSha: entry.baseSha,
      liveHeadSha: null,
      liveBaseSha: null,
      shasMatch: null,
      mode: 'none',
      status: 'audited',
      bucket: 'abstained',
      pass: null,
      gateTriggers: [],
      replayConfirmed: null,
      advisoryFindings: [],
      provisioning: null,
      enginesApplicable: 0,
      enginesExecuted: 0,
      abstains: [],
      elapsedMs: 0,
      replayCommand: `node dist/scripts/real-prs/recall-v3.js --arm ${arm} --only ${entry.id}`,
    };
    log.info(`measuring ${entry.id} (${entry.repo}#${entry.prNumber}, ${arm} arm)`);
    let fixtureDir: string | null = null;
    try {
      const live = await fetchLivePr(entry);
      rec.liveHeadSha = live.headSha;
      rec.liveBaseSha = live.baseSha;
      rec.shasMatch = live.headSha === entry.headSha && live.baseSha === entry.baseSha;
      if (rec.shasMatch) {
        rec.mode = 'live';
      } else {
        log.warn(`  PR moved off the recorded pair; building pinned fixture`);
        try {
          const diff = await fetchPinnedDiff(entry);
          const messages = await fetchPinnedCommitMessages(entry);
          fixtureDir = writeFixture(entry, live, diff, messages);
          rec.mode = 'fixture';
        } catch (err) {
          rec.status = 'sha-unfetchable';
          rec.detail = `pinned pair not fetchable: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } catch (err) {
      rec.status = 'pr-fetch-failed';
      rec.detail = `PR fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (rec.status === 'audited') {
      const run = runAudit(entry, arm, path.join(ledgerDir, `${entry.id}.jsonl`), fixtureDir, timeoutMs);
      Object.assign(rec, run);
      if (run.status === 'audited' && run.gateTriggers.length > 0) {
        // The standing proven definition requires a fresh replay before a gate
        // trigger is believed. The audit clones fresh on every run.
        log.info(`  gate trigger(s) [${run.gateTriggers.join(', ')}]; replaying fresh`);
        const replay = runAudit(entry, arm, path.join(ledgerDir, `${entry.id}.replay.jsonl`), fixtureDir, timeoutMs);
        rec.replayConfirmed =
          replay.status === 'audited' &&
          replay.gateTriggers.length === run.gateTriggers.length &&
          replay.gateTriggers.every((t) => run.gateTriggers.includes(t));
      }
    }
    classify(rec);
    fs.writeFileSync(recordFile, `${JSON.stringify(rec, null, 2)}\n`);
    records.push(rec);
    log.info(
      `  ${entry.id}: ${rec.bucket}${rec.bucketStage !== undefined ? ` (${rec.bucketStage})` : ''} ` +
        `mode=${rec.mode} triggers=[${rec.gateTriggers.join(',')}] advisory=${rec.advisoryFindings.length} ` +
        `abstains=${rec.abstains.length} ${rec.elapsedMs}ms`,
    );
  }

  const liveJudgeCalls = arm === 'judge' ? countLiveJudgeCalls(ledgerDir) : 0;
  const summary = {
    computedBy: 'scripts/real-prs/recall-v3.ts',
    arm,
    engineSet: 'restoration+error-swallow+claim-binding (live), per .swarm/audit-config.yaml',
    dataset: DATASET_FILE,
    preregistration: 'benchmarks/real-prs/capability-hunt/PREREGISTRATION-AMENDMENT-2.md',
    entriesMeasured: records.length,
    stoppedAtCeiling,
    ...(arm === 'judge'
      ? { liveJudgeCalls, judgeCostUsd: Number((liveJudgeCalls * HAIKU_PER_CALL_USD).toFixed(4)), ceilingUsd }
      : { judgeCostUsd: 0 }),
    buckets: records.reduce<Record<string, number>>((acc, r) => {
      acc[r.bucket] = (acc[r.bucket] ?? 0) + 1;
      return acc;
    }, {}),
    records: records.map((r) => ({ id: r.id, bucket: r.bucket, stage: r.bucketStage ?? null })),
  };
  fs.writeFileSync(path.join(OUT_DIR, `RUN-${arm}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  log.info(`wrote ${path.join(OUT_DIR, `RUN-${arm}.json`)}`);
}

/** Per-entry screen reason for every frozen non-viable entry: the committed
 *  hunt3 census row when present, a live screenPr otherwise (the two v2-folded
 *  entries postdate the census). */
async function screenNonviable(): Promise<void> {
  const census = JSON.parse(fs.readFileSync(CENSUS_FILE, 'utf8')) as {
    rows: Array<{ id: string; viable: boolean; reason: string; ecosystem: string | null }>;
  };
  const byId = new Map(census.rows.map((r) => [r.id, r]));
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of loadDataset().filter((e) => !e.egViable)) {
    const censusRow = byId.get(entry.id);
    if (censusRow !== undefined) {
      rows.push({
        id: entry.id,
        repo: entry.repo,
        prNumber: entry.prNumber,
        complaintCategory: entry.complaintCategory,
        complaintBar: entry.complaintBar,
        screenReason: censusRow.reason,
        screenSource: 'hunt3 viability-census.json',
        installViableOnly: censusRow.viable,
      });
    } else {
      const octokit = makeOctokit(resolveGithubToken());
      const screened = await screenPr(octokit, {
        id: entry.id,
        repo: entry.repo,
        headSha: entry.headSha,
        outcome: 'unknown',
      });
      rows.push({
        id: entry.id,
        repo: entry.repo,
        prNumber: entry.prNumber,
        complaintCategory: entry.complaintCategory,
        complaintBar: entry.complaintBar,
        screenReason: screened.reason,
        screenSource: 'live screenPr (entry postdates the hunt3 census)',
        installViableOnly: screened.viable,
      });
    }
  }
  const out = {
    computedBy: 'scripts/real-prs/recall-v3.ts --screen-nonviable',
    note:
      'Frozen non-viable entries with the eg-viability-screen reason. installViableOnly=true means ' +
      'the screen would clone and install (pytest/Go or a lifted Node tree) but the frozen egViable ' +
      'flag predates or excludes it; the frozen flag is the population rule for this measurement.',
    entries: rows,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'nonviable.json'), `${JSON.stringify(out, null, 2)}\n`);
  log.info(`wrote ${path.join(OUT_DIR, 'nonviable.json')} (${rows.length} entries)`);
}

async function main(): Promise<void> {
  loadDotenv();
  if (process.argv.includes('--screen-nonviable')) {
    await screenNonviable();
    return;
  }
  const arm = arg('--arm', null);
  if (arm !== 'deterministic' && arm !== 'judge') {
    throw new Error('pass --arm deterministic | --arm judge, or --screen-nonviable');
  }
  await measureArm(arm);
}

if (require.main === module) {
  main().catch((err) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
