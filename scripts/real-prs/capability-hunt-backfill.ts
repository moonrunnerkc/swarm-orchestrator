// Backfill hunt runner (Stage 3, backward). Audits a bounded, checkpointed batch
// of MERGED agent-authored PRs through the shipped, deterministic `swarm audit
// --pr` (no --enable-llm-judge, so Anthropic spend is USD 0.00), records each
// PR's full funnel, tallies the metrics every audited PR feeds regardless of
// verdict, and HALTS the batch on any proven gate trigger for the FP protocol.
//
// The population is the fixed-attribution miner's output (fetch-agent-prs
// sources.json): PRs the shipped fingerprinter attributes to an AI agent, merged,
// across a wide historical window. Not complaint-filtered: the milestone targets
// merged-and-never-flagged.
//
// Checkpointed: a PR whose record already exists is skipped, so a run resumes.
// Per-audit wall-clock is capped so one slow clone does not stall the batch.
//
// Usage:
//   node dist/scripts/real-prs/capability-hunt-backfill.js \
//     [--population <file>] [--batch-size 12] [--offset 0] \
//     [--timeout-ms 200000] [--out <dir>] [--batch-id b1]

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { SELF_CERTIFYING_TRIGGERS } from '../../src/audit/gate/self-certifying';

const log = getLogger('hunt:backfill');

interface PopulationRecord {
  repo: string;
  prNumber: number;
  headSha?: string;
  agent?: { vendor?: string; confidence?: string; source?: string };
  title?: string;
}

interface Args {
  population: string;
  batchSize: number;
  offset: number;
  timeoutMs: number;
  outDir: string;
  batchId: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
  };
  return {
    population: get('--population', path.join('benchmarks', 'real-prs', 'agent-corpus', 'sources.json')),
    batchSize: Number(get('--batch-size', '12')),
    offset: Number(get('--offset', '0')),
    timeoutMs: Number(get('--timeout-ms', '200000')),
    outDir: get('--out', path.join('benchmarks', 'real-prs', 'capability-hunt')),
    batchId: get('--batch-id', 'batch-1'),
  };
}

/** Find the array of PR records in the population file (sources.json wraps them
 *  under a vendor-keyed or `prs`/`records` field, or is itself an array). */
function loadPopulation(file: string): PopulationRecord[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (Array.isArray(raw)) return raw as PopulationRecord[];
  if (raw !== null && typeof raw === 'object') {
    for (const value of Object.values(raw as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0] as Record<string, unknown>;
        if (typeof first.repo === 'string' && typeof first.prNumber === 'number') {
          return value as PopulationRecord[];
        }
      }
    }
  }
  throw new Error(`no PR-record array found in ${file}`);
}

const GATE_TRIGGER_KINDS = new Set<string>(SELF_CERTIFYING_TRIGGERS as readonly string[]);

interface AuditFunnel {
  ref: string;
  agent: string;
  status: 'audited' | 'timeout' | 'error';
  pass: boolean | null;
  gateTriggers: string[];
  advisoryFindings: Array<{ category: string; severity: string }>;
  provisioning: { attempted: boolean; provisioned: boolean; reason?: string } | null;
  enginesApplicable: number;
  enginesExecuted: number;
  disputed: number;
  abstainVerdicts: string[];
  elapsedMs: number;
  detail?: string;
}

function slug(ref: string): string {
  return ref.replace(/[^A-Za-z0-9]+/g, '-');
}

function auditOne(rec: PopulationRecord, timeoutMs: number): AuditFunnel {
  const ref = `${rec.repo}#${rec.prNumber}`;
  const agent = rec.agent?.vendor ?? 'unknown';
  const started = Date.now();
  const env = { ...process.env, PATH: `${process.env.HOME}/go-toolchain/go/bin:${process.env.PATH ?? ''}` };
  const res = spawnSync(
    'node',
    ['dist/src/cli.js', 'audit', '--pr', ref, '--mode', 'gate', '--output', 'json'],
    { encoding: 'utf8', env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
  );
  const elapsedMs = Date.now() - started;
  const base: AuditFunnel = {
    ref,
    agent,
    status: 'audited',
    pass: null,
    gateTriggers: [],
    advisoryFindings: [],
    provisioning: null,
    enginesApplicable: 0,
    enginesExecuted: 0,
    disputed: 0,
    abstainVerdicts: [],
    elapsedMs,
  };
  if (res.error !== undefined && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { ...base, status: 'timeout', detail: `audit exceeded ${timeoutMs}ms` };
  }
  const stdout = res.stdout ?? '';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return { ...base, status: 'error', detail: `unparseable audit output: ${(res.stderr ?? '').slice(-300)}` };
  }
  const findings = Array.isArray(parsed.findings) ? (parsed.findings as Array<Record<string, unknown>>) : [];
  const triggers = Array.isArray(parsed.blockingTriggers)
    ? (parsed.blockingTriggers as Array<Record<string, unknown>>)
    : [];
  const pc = (parsed.proofCoverage ?? {}) as Record<string, unknown>;
  const prov = (pc.provisioning ?? null) as AuditFunnel['provisioning'];
  const summary = (pc.summary ?? {}) as Record<string, number>;
  const engines = Array.isArray(pc.engines) ? (pc.engines as Array<Record<string, unknown>>) : [];
  const abstainVerdicts: string[] = [];
  for (const e of engines) {
    const records = Array.isArray(e.records) ? (e.records as Array<Record<string, unknown>>) : [];
    for (const r of records) {
      if (r.outcome === 'abstain' && typeof r.verdict === 'string') abstainVerdicts.push(r.verdict);
    }
  }
  return {
    ...base,
    pass: typeof parsed.pass === 'boolean' ? parsed.pass : null,
    gateTriggers: triggers
      .map((t) => (typeof t.kind === 'string' ? t.kind : ''))
      .filter((k) => GATE_TRIGGER_KINDS.has(k)),
    advisoryFindings: findings.map((f) => ({
      category: String(f.category ?? 'unknown'),
      severity: String(f.severity ?? 'unknown'),
    })),
    provisioning: prov,
    enginesApplicable: Number(summary.enginesApplicable ?? 0),
    enginesExecuted: Number(summary.enginesExecuted ?? 0),
    disputed: Number(summary.disputed ?? 0),
    abstainVerdicts,
  };
}

interface BatchMetrics {
  batchId: string;
  populationFile: string;
  offset: number;
  requested: number;
  audited: number;
  skippedExisting: number;
  viability: { attempted: number; provisioned: number };
  verdicts: { pass: number; block: number; timeout: number; error: number };
  gateTriggers: Record<string, number>;
  advisoryFindings: Record<string, number>;
  abstainReasons: Record<string, number>;
  provenRefs: string[];
}

function tally(funnels: AuditFunnel[], args: Args, skipped: number): BatchMetrics {
  const m: BatchMetrics = {
    batchId: args.batchId,
    populationFile: args.population,
    offset: args.offset,
    requested: args.batchSize,
    audited: funnels.length,
    skippedExisting: skipped,
    viability: { attempted: 0, provisioned: 0 },
    verdicts: { pass: 0, block: 0, timeout: 0, error: 0 },
    gateTriggers: {},
    advisoryFindings: {},
    abstainReasons: {},
    provenRefs: [],
  };
  for (const f of funnels) {
    if (f.status === 'timeout') m.verdicts.timeout += 1;
    else if (f.status === 'error') m.verdicts.error += 1;
    else if (f.pass === false) m.verdicts.block += 1;
    else m.verdicts.pass += 1;
    if (f.provisioning?.attempted) m.viability.attempted += 1;
    if (f.provisioning?.provisioned) m.viability.provisioned += 1;
    for (const t of f.gateTriggers) {
      m.gateTriggers[t] = (m.gateTriggers[t] ?? 0) + 1;
      if (!m.provenRefs.includes(f.ref)) m.provenRefs.push(f.ref);
    }
    for (const a of f.advisoryFindings) {
      const key = `${a.category}:${a.severity}`;
      m.advisoryFindings[key] = (m.advisoryFindings[key] ?? 0) + 1;
    }
    if (f.disputed > 0) m.advisoryFindings['disputed'] = (m.advisoryFindings['disputed'] ?? 0) + f.disputed;
    for (const v of f.abstainVerdicts) m.abstainReasons[v] = (m.abstainReasons[v] ?? 0) + 1;
  }
  return m;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const population = loadPopulation(args.population);
  const batch = population.slice(args.offset, args.offset + args.batchSize);
  const recordsDir = path.join(args.outDir, 'records');
  fs.mkdirSync(recordsDir, { recursive: true });

  const funnels: AuditFunnel[] = [];
  let skipped = 0;
  let halted = false;
  for (const rec of batch) {
    const ref = `${rec.repo}#${rec.prNumber}`;
    const recordFile = path.join(recordsDir, `${slug(ref)}.json`);
    if (fs.existsSync(recordFile)) {
      skipped += 1;
      funnels.push(JSON.parse(fs.readFileSync(recordFile, 'utf8')) as AuditFunnel);
      log.info(`skip (checkpoint): ${ref}`);
      continue;
    }
    log.info(`audit: ${ref} (${rec.agent?.vendor ?? '?'})`);
    const funnel = auditOne(rec, args.timeoutMs);
    fs.writeFileSync(recordFile, `${JSON.stringify(funnel, null, 2)}\n`);
    funnels.push(funnel);
    log.info(
      `  ${ref}: ${funnel.status} pass=${funnel.pass} triggers=[${funnel.gateTriggers.join(',')}] ` +
        `prov=${funnel.provisioning?.provisioned} advisory=${funnel.advisoryFindings.length} ${funnel.elapsedMs}ms`,
    );
    if (funnel.gateTriggers.length > 0) {
      // A proven gate trigger: HALT the batch for the FP protocol before any more
      // audits, per the pre-registration.
      halted = true;
      const haltFile = path.join(args.outDir, `HALT-${slug(ref)}.md`);
      fs.writeFileSync(
        haltFile,
        `# HALT: proven gate trigger on ${ref}\n\n` +
          `Batch stopped for the FP protocol (fresh-clone replay, production diff read, ` +
          `repo history check, registry check). Triggers: ${funnel.gateTriggers.join(', ')}.\n` +
          `Record: benchmarks/real-prs/capability-hunt/records/${slug(ref)}.json\n`,
      );
      log.error(`HALT: proven gate trigger on ${ref} (${funnel.gateTriggers.join(', ')}); wrote ${haltFile}`);
      break;
    }
  }

  const metrics = tally(funnels, args, skipped);
  const outFile = path.join(args.outDir, `BACKFILL-${args.batchId}.json`);
  fs.writeFileSync(
    outFile,
    `${JSON.stringify({ computedBy: 'scripts/real-prs/capability-hunt-backfill.ts', halted, ...metrics }, null, 2)}\n`,
  );
  log.info(
    `backfill ${args.batchId}: audited ${metrics.audited} (skipped ${skipped}), ` +
      `provisioned ${metrics.viability.provisioned}/${metrics.viability.attempted}, ` +
      `proven gate triggers ${metrics.provenRefs.length}, advisory ${Object.keys(metrics.advisoryFindings).length} kinds. ` +
      `Wrote ${outFile}${halted ? ' (HALTED)' : ''}.`,
  );
  if (halted) process.exitCode = 3;
}

if (require.main === module) {
  try {
    main();
  } catch (err: unknown) {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}
