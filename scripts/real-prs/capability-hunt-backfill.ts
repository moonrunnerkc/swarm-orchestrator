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
  /** Fetch-arm label (amendment 3): 'per-vendor-control' | 'thin-review'.
   *  Absent on populations fetched before the two-arm fetcher. */
  arm?: string;
  /** Per-PR context features the fetcher recorded (amendment 3). Carried
   *  into the funnel record verbatim so every record is a dataset row. */
  context?: Record<string, unknown>;
}

interface Args {
  population: string;
  batchSize: number;
  offset: number;
  timeoutMs: number;
  outDir: string;
  batchId: string;
  /** Engine-set provenance recorded in the batch funnel: which engines were live
   *  for this batch, so hunt numbers stay comparable across the tool's history
   *  (the pre-wiring capability batches carry a different, narrower set). */
  engineSet: string;
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
    engineSet: get('--engine-set', 'restoration+error-swallow+claim-binding (live)'),
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

export interface AuditFunnel {
  ref: string;
  agent: string;
  /** Fetch-arm label copied from the population record (amendment 3);
   *  absent on records audited from pre-amendment populations. */
  arm?: string;
  /** Context features copied from the population record (amendment 3). */
  context?: Record<string, unknown>;
  status: 'audited' | 'timeout' | 'error';
  pass: boolean | null;
  gateTriggers: string[];
  advisoryFindings: Array<{ category: string; severity: string }>;
  provisioning: {
    attempted: boolean;
    provisioned: boolean;
    reason?: string;
    /** Where the install ran ('.' or a subdirectory), present on provisioned
     *  records since the B2 manifest discovery. Older records lack it. */
    manifestDir?: string;
    /** Present since the B1 instrumentation when the bail was an install
     *  failure. Older records lack it; every reader treats it as optional. */
    installFailure?: {
      packageManager: string;
      exitCode: number | null;
      timedOut: boolean;
      stderrTail: string;
      /** Present since the yarn-capture fix: corepack yarn errors on stdout.
       *  Older records lack it. */
      stdoutTail?: string;
      lockfile: string | null;
      nodeEngineRange: string | null;
      bucket: string;
    };
  } | null;
  enginesApplicable: number;
  enginesExecuted: number;
  disputed: number;
  abstainVerdicts: string[];
  /** Tally of every engine-record outcome from the proof-coverage
   *  attestation ('finding' | 'exonerated' | 'abstain' | 'signal' |
   *  'disputed'). The EG-corroboration metric (amendment 3) reads
   *  'finding' + 'signal'. Absent on records older than the field. */
  engineOutcomes?: Record<string, number>;
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
    ...(rec.arm !== undefined ? { arm: rec.arm } : {}),
    ...(rec.context !== undefined ? { context: rec.context } : {}),
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
  const engineOutcomes: Record<string, number> = {};
  for (const e of engines) {
    const records = Array.isArray(e.records) ? (e.records as Array<Record<string, unknown>>) : [];
    for (const r of records) {
      if (typeof r.outcome === 'string') {
        engineOutcomes[r.outcome] = (engineOutcomes[r.outcome] ?? 0) + 1;
      }
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
    engineOutcomes,
  };
}

export interface BatchMetrics {
  batchId: string;
  populationFile: string;
  offset: number;
  requested: number;
  audited: number;
  skippedExisting: number;
  /** Audited count per fetch arm (amendment 3). Records without a label
   *  (pre-amendment populations) tally under 'unlabeled'. */
  arms: Record<string, number>;
  viability: { attempted: number; provisioned: number };
  /** Install-failure cause buckets (B1 instrumentation). Zero-count on batches
   *  whose records predate the installFailure field. */
  installFailureBuckets: Record<string, number>;
  verdicts: { pass: number; block: number; timeout: number; error: number };
  gateTriggers: Record<string, number>;
  advisoryFindings: Record<string, number>;
  abstainReasons: Record<string, number>;
  provenRefs: string[];
}

/** Aggregate a batch's funnels into the committed metrics record. Exported
 *  for the arm-labeling test; the runner is the only production caller. */
export function tally(
  funnels: AuditFunnel[],
  args: Pick<Args, 'batchId' | 'population' | 'offset' | 'batchSize'>,
  skipped: number,
): BatchMetrics {
  const m: BatchMetrics = {
    batchId: args.batchId,
    populationFile: args.population,
    offset: args.offset,
    requested: args.batchSize,
    audited: funnels.length,
    skippedExisting: skipped,
    arms: {},
    viability: { attempted: 0, provisioned: 0 },
    installFailureBuckets: {},
    verdicts: { pass: 0, block: 0, timeout: 0, error: 0 },
    gateTriggers: {},
    advisoryFindings: {},
    abstainReasons: {},
    provenRefs: [],
  };
  for (const f of funnels) {
    const arm = f.arm ?? 'unlabeled';
    m.arms[arm] = (m.arms[arm] ?? 0) + 1;
    if (f.status === 'timeout') m.verdicts.timeout += 1;
    else if (f.status === 'error') m.verdicts.error += 1;
    else if (f.pass === false) m.verdicts.block += 1;
    else m.verdicts.pass += 1;
    if (f.provisioning?.attempted) m.viability.attempted += 1;
    if (f.provisioning?.provisioned) m.viability.provisioned += 1;
    const bucket = f.provisioning?.installFailure?.bucket;
    if (bucket !== undefined) {
      m.installFailureBuckets[bucket] = (m.installFailureBuckets[bucket] ?? 0) + 1;
    }
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
    `${JSON.stringify({ computedBy: 'scripts/real-prs/capability-hunt-backfill.ts', engineSet: args.engineSet, halted, ...metrics }, null, 2)}\n`,
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
