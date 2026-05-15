/* eslint-disable no-console */
/**
 * Phase 4 redo paired-run harness.
 *
 * Audit-and-corrections rerun (DECISIONS.md 2026-05-09): the original
 * Phase 4 reused Phase 3's obligation set, which targeted Copilot's
 * specialties (`import-graph-must-satisfy`, `function-must-have-signature`).
 * That obligation surface is uninterpretable for ClaudeCode's
 * adversarial-test-input strategy. The redo runs against an N=20
 * `property-must-hold` obligation set at
 * `evidence/phase4-redo/obligations.json`, disjoint from Phases 1, 2,
 * and 3.
 *
 * Configs:
 *   - `bp`  Producer + Codex + Copilot. Per the production
 *           configuration; Copilot is *not* registered in the harness
 *           because its strategy does not handle property-must-hold (it
 *           would short-circuit to strategy-not-applicable). Codex
 *           runs.
 *   - `bpp` Producer + Codex + Copilot + ClaudeCode. Same as bp plus
 *           ClaudeCode. ClaudeCode now handles property-must-hold (Phase
 *           4 redo extension; see `claude-code-falsifier.ts`).
 *
 * Per-obligation artifacts (one directory per obligation per config):
 *   - `result.json`            aggregated outcome across all adapters
 *                              that handled the obligation.
 *   - `cost.json`              { dollarsBilled, dollarsTokenEstimate,
 *                                dollarsApiEquivalent, wallClockMs,
 *                                llmCalls, costCapHit } summed across
 *                                the adapters that ran.
 *   - `<adapter>-result.json`  per-adapter outcome.
 *   - `<adapter>-stdout.txt`,
 *     `<adapter>-stderr.txt`   per-adapter raw subprocess output.
 *   - `error.txt`              any thrown error message.
 *
 * Aggregate artifacts:
 *   - `summary.md`, `summary.tsv`, `runtime.json`, `environment.json`,
 *     `runtime-progress.json`.
 *
 * Invocation:
 *   node dist/scripts/phase4-redo/run-harness.js --config <bp|bpp> [flags]
 */

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { CliFalsifier, type CliInvocationRequest, type CliInvocationResult } from '../../src/falsification/adapters/cli-falsifier';
import { codexProfile } from '../../src/falsification/adapters/profiles/codex';
import { claudeCodeProfile } from '../../src/falsification/adapters/profiles/claude-code';
import type {
  ObligationV1,
  PropertyMustHoldObligation,
} from '../../src/contract/types';
import type {
  AdapterCostRecord,
  FalsificationInput,
  FalsifierAdapter,
  FalsifyOutcome,
} from '../../src/falsification/adapters/types';

loadDotenv();

interface PhaseObligation {
  readonly id: string;
  readonly stratum: 'A' | 'B' | 'C';
  readonly type: 'property-must-hold';
  readonly target: string;
  readonly predicate: string;
  readonly expectedPreApplyExit: number;
}

interface PhaseSampleFile {
  readonly obligationCount: number;
  readonly obligations: readonly PhaseObligation[];
  readonly fixturePath: string;
}

type ConfigName = 'bp' | 'bpp';

interface CliFlags {
  readonly config: ConfigName;
  readonly timeBudgetMs: number;
  readonly costCapUsd: number;
  readonly fixtureRootOverride: string | null;
  readonly obligationsPathOverride: string | null;
  readonly resume: boolean;
  readonly maxTotalSpendUsd: number;
}

const DEFAULT_TIME_BUDGET_MS = 300_000;
// Per-obligation cost cap. Phase 2 ran ~$0.16 / obligation on Codex
// alone; Phase 4 redo's bpp config also runs ClaudeCode (subscription
// or API) per obligation. $0.65 mirrors the prior phase caps and stays
// well inside the $20 total ceiling (20 × $0.65 = $13).
const DEFAULT_COST_CAP_USD = 0.65;
// Hard total ceiling per the audit-and-corrections brief: $20 across
// the entire Part C run (B' + B'').
const DEFAULT_MAX_TOTAL_SPEND_USD = 20;

function parseFlags(argv: readonly string[]): CliFlags {
  let config: ConfigName | null = null;
  let timeBudgetMs = DEFAULT_TIME_BUDGET_MS;
  let costCapUsd = DEFAULT_COST_CAP_USD;
  let fixtureRootOverride: string | null = null;
  let obligationsPathOverride: string | null = null;
  let resume = false;
  let maxTotalSpendUsd = DEFAULT_MAX_TOTAL_SPEND_USD;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      const next = argv[i + 1];
      if (next !== 'bp' && next !== 'bpp') {
        throw new Error(`--config requires value 'bp' or 'bpp', got ${next}`);
      }
      config = next;
      i += 1;
    } else if (arg === '--time-budget-ms') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--time-budget-ms requires a value');
      timeBudgetMs = Number.parseInt(next, 10);
      if (!Number.isFinite(timeBudgetMs) || timeBudgetMs < 1000) {
        throw new Error(`--time-budget-ms must be >= 1000, got ${next}`);
      }
      i += 1;
    } else if (arg === '--cost-cap-usd') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--cost-cap-usd requires a value');
      const parsed = Number.parseFloat(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--cost-cap-usd must be > 0, got ${next}`);
      }
      costCapUsd = parsed;
      i += 1;
    } else if (arg === '--max-total-spend-usd') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--max-total-spend-usd requires a value');
      const parsed = Number.parseFloat(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--max-total-spend-usd must be > 0, got ${next}`);
      }
      maxTotalSpendUsd = parsed;
      i += 1;
    } else if (arg === '--fixture-root') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--fixture-root requires a value');
      fixtureRootOverride = next;
      i += 1;
    } else if (arg === '--obligations') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--obligations requires a value');
      obligationsPathOverride = next;
      i += 1;
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node dist/scripts/phase4-redo/run-harness.js --config <bp|bpp> ' +
          '[--time-budget-ms M] [--cost-cap-usd N] [--max-total-spend-usd N] ' +
          '[--fixture-root PATH] [--obligations PATH] [--resume]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (config === null) throw new Error('--config <bp|bpp> is required');
  return {
    config,
    timeBudgetMs,
    costCapUsd,
    maxTotalSpendUsd,
    fixtureRootOverride,
    obligationsPathOverride,
    resume,
  };
}

function repoRoot(): string {
  const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!out) throw new Error('git rev-parse --show-toplevel returned empty');
  return out;
}

function fixtureContentHash(fixtureRoot: string): string {
  const entries: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const stat = fs.lstatSync(abs);
      const rel = path.relative(fixtureRoot, abs);
      if (stat.isSymbolicLink()) {
        entries.push(`symlink:${rel}\0${fs.readlinkSync(abs)}\0`);
        continue;
      }
      if (stat.isDirectory()) {
        walk(abs);
        continue;
      }
      if (stat.isFile()) {
        const content = fs.readFileSync(abs);
        const sha = crypto.createHash('sha256').update(content).digest('hex');
        entries.push(`file:${rel}\0${sha}\0`);
      }
    }
  };
  walk(fixtureRoot);
  const hasher = crypto.createHash('sha256');
  for (const e of entries) hasher.update(e);
  return hasher.digest('hex');
}

function copyFixtureInto(fixtureRoot: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(fixtureRoot, destDir, { recursive: true });
}

function toObligation(sample: PhaseObligation): PropertyMustHoldObligation {
  return {
    type: 'property-must-hold',
    predicate: sample.predicate,
    target: sample.target,
  };
}

interface AdapterRunRecord {
  readonly adapterName: string;
  readonly outcome: FalsifyOutcome | null;
  readonly errorMessage: string | null;
}

interface PerObligationOutcome {
  readonly id: string;
  readonly stratum: 'A' | 'B' | 'C';
  readonly type: string;
  readonly pass: boolean;
  readonly falsifyingAdapters: string;
  readonly perAdapterYield: string;
  readonly counterExamplesFound: number;
  readonly falsePositives: number;
  readonly dollarsBilled: number;
  readonly dollarsTokenEstimate: number;
  readonly dollarsApiEquivalent: number;
  readonly llmCalls: number;
  readonly wallClockMs: number;
  readonly costCapUsd: number;
  readonly costCapHit: boolean;
  readonly errorMessage: string | null;
}

interface RuntimeProgress {
  readonly config: ConfigName;
  readonly fixtureContentHash: string;
  readonly startedAtIso: string;
  readonly completedIds: readonly string[];
  readonly outcomes: readonly PerObligationOutcome[];
}

function progressFile(runDir: string): string {
  return path.join(runDir, 'runtime-progress.json');
}

function buildAdapters(config: ConfigName): FalsifierAdapter[] {
  // Copilot's strategy does not handle property-must-hold; omitting it
  // here mirrors the Phase 4 production harness pattern (skip adapters
  // whose handles do not match the obligation type to keep the cost
  // record clean).
  if (config === 'bp') {
    return [new CliFalsifier(codexProfile, )];
  }
  return [new CliFalsifier(codexProfile, ), new CliFalsifier(claudeCodeProfile, )];
}

async function runConfig(
  sample: PhaseObligation,
  obligationDir: string,
  fixtureRoot: string,
  patchSha: string,
  timeBudgetMs: number,
  costCapUsd: number,
  config: ConfigName,
): Promise<PerObligationOutcome> {
  const obligation = toObligation(sample);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `phase4r-${config}-${sample.id}-`));
  const workspaceRoot = path.join(tmpRoot, 'workspace');
  copyFixtureInto(fixtureRoot, workspaceRoot);

  const subprocessCaptures: Array<{
    adapterName: string;
    request: CliInvocationRequest | CliInvocationRequest;
    result: CliInvocationResult | CliInvocationResult;
  }> = [];

  const adapters = buildAdapters(config).map((adapter) => {
    if (adapter.name === 'codex') {
      return new CliFalsifier(codexProfile, {
        onInvocation: (request, result) => {
          subprocessCaptures.push({ adapterName: 'codex', request, result });
        },
      });
    }
    if (adapter.name === 'claude-code') {
      return new CliFalsifier(claudeCodeProfile, {
        onInvocation: (request, result) => {
          subprocessCaptures.push({ adapterName: 'claude-code', request, result });
        },
      });
    }
    return adapter;
  });

  const adapterRecords: AdapterRunRecord[] = [];
  let firstError: string | null = null;

  const t0 = Date.now();
  for (const adapter of adapters) {
    if (!adapter.handles.includes(obligation.type)) continue;
    const input: FalsificationInput = {
      patchSha,
      obligation: obligation as ObligationV1,
      contextRefs: [],
      timeBudgetMs,
      workspaceRoot,
    };
    try {
      const outcome = await adapter.falsify(input);
      adapterRecords.push({ adapterName: adapter.name, outcome, errorMessage: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      adapterRecords.push({ adapterName: adapter.name, outcome: null, errorMessage: msg });
      if (firstError === null) firstError = `${adapter.name}: ${msg}`;
      break;
    }
  }
  const totalWallClockMs = Date.now() - t0;

  for (const record of adapterRecords) {
    if (record.outcome !== null) {
      fs.writeFileSync(
        path.join(obligationDir, `${record.adapterName}-result.json`),
        JSON.stringify(record.outcome, null, 2) + '\n',
      );
    }
  }
  for (const cap of subprocessCaptures) {
    fs.writeFileSync(path.join(obligationDir, `${cap.adapterName}-stdout.txt`), cap.result.stdout);
    fs.writeFileSync(path.join(obligationDir, `${cap.adapterName}-stderr.txt`), cap.result.stderr);
    fs.writeFileSync(
      path.join(obligationDir, `${cap.adapterName}-exit-code.txt`),
      `${cap.result.exitCode}\n`,
    );
  }
  if (firstError !== null) {
    fs.writeFileSync(path.join(obligationDir, 'error.txt'), firstError + '\n');
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  const totalCounterExamples = adapterRecords.reduce(
    (acc, r) =>
      acc +
      (r.outcome !== null && r.outcome.result.kind === 'counter-example-input'
        ? r.outcome.result.inputs.length
        : 0),
    0,
  );
  const totalFalsePositives = adapterRecords.reduce(
    (acc, r) => acc + (r.outcome !== null ? r.outcome.cost.falsePositives : 0),
    0,
  );
  const totalDollarsBilled = adapterRecords.reduce(
    (acc, r) => acc + (r.outcome !== null ? r.outcome.cost.dollarsBilled : 0),
    0,
  );
  const totalDollarsTokenEstimate = adapterRecords.reduce(
    (acc, r) => acc + (r.outcome !== null ? r.outcome.cost.dollarsTokenEstimate : 0),
    0,
  );
  const totalDollarsApiEquivalent = adapterRecords.reduce(
    (acc, r) => acc + (r.outcome !== null ? r.outcome.cost.dollarsApiEquivalent : 0),
    0,
  );
  const llmCalls = adapterRecords.reduce(
    (acc, r) => acc + (r.outcome !== null && !isBaselineSkip(r.outcome.cost) ? 1 : 0),
    0,
  );
  const falsifyingAdapters = adapterRecords
    .filter((r) => r.outcome !== null && r.outcome.result.kind === 'counter-example-input')
    .map((r) => r.adapterName)
    .join(',');
  const perAdapterYield = adapterRecords
    .map((r) => {
      const y =
        r.outcome !== null && r.outcome.result.kind === 'counter-example-input'
          ? r.outcome.result.inputs.length
          : 0;
      return `${r.adapterName}=${y}`;
    })
    .join(',');
  const pass = falsifyingAdapters.length === 0 && firstError === null;
  const costCapHit =
    totalDollarsBilled > costCapUsd ||
    totalDollarsTokenEstimate > costCapUsd ||
    totalDollarsApiEquivalent > costCapUsd;

  fs.writeFileSync(
    path.join(obligationDir, 'result.json'),
    JSON.stringify(
      {
        config,
        obligationId: sample.id,
        adapters: adapterRecords.map((r) => ({
          name: r.adapterName,
          outcomeKind: r.outcome === null ? 'errored' : r.outcome.result.kind,
          counterExamplesFound:
            r.outcome !== null && r.outcome.result.kind === 'counter-example-input'
              ? r.outcome.result.inputs.length
              : 0,
          dollarsBilled: r.outcome?.cost.dollarsBilled ?? 0,
          dollarsTokenEstimate: r.outcome?.cost.dollarsTokenEstimate ?? 0,
          dollarsApiEquivalent: r.outcome?.cost.dollarsApiEquivalent ?? 0,
          wallClockMs: r.outcome?.cost.wallClockMs ?? 0,
          errorMessage: r.errorMessage,
        })),
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(obligationDir, 'cost.json'),
    JSON.stringify(
      {
        dollarsBilled: totalDollarsBilled,
        dollarsTokenEstimate: totalDollarsTokenEstimate,
        dollarsApiEquivalent: totalDollarsApiEquivalent,
        wallClockMs: totalWallClockMs,
        llmCalls,
        costCapUsd,
        costCapHit,
      },
      null,
      2,
    ) + '\n',
  );

  return {
    id: sample.id,
    stratum: sample.stratum,
    type: sample.type,
    pass,
    falsifyingAdapters,
    perAdapterYield,
    counterExamplesFound: totalCounterExamples,
    falsePositives: totalFalsePositives,
    dollarsBilled: totalDollarsBilled,
    dollarsTokenEstimate: totalDollarsTokenEstimate,
    dollarsApiEquivalent: totalDollarsApiEquivalent,
    llmCalls,
    wallClockMs: totalWallClockMs,
    costCapUsd,
    costCapHit,
    errorMessage: firstError,
  };
}

function isBaselineSkip(cost: AdapterCostRecord): boolean {
  return (
    cost.dollarsTokenEstimate === 0 &&
    cost.dollarsApiEquivalent === 0 &&
    cost.counterExamplesFound === 0 &&
    cost.falsePositives === 0
  );
}

function writeSummaryTsv(outcomes: readonly PerObligationOutcome[], runDir: string): void {
  const header =
    'id\tstratum\ttype\tpass\tfalsifying\tperAdapterYield\tcounterExamples\tfalsePositives\t' +
    'dollarsBilled\tdollarsTokenEstimate\tdollarsApiEquivalent\tllmCalls\twallClockMs\tcostCapHit\terror';
  const rows = outcomes.map((o) =>
    [
      o.id,
      o.stratum,
      o.type,
      o.pass ? 'true' : 'false',
      o.falsifyingAdapters,
      o.perAdapterYield,
      o.counterExamplesFound,
      o.falsePositives,
      o.dollarsBilled.toFixed(6),
      o.dollarsTokenEstimate.toFixed(6),
      o.dollarsApiEquivalent.toFixed(6),
      o.llmCalls,
      o.wallClockMs,
      o.costCapHit ? 'true' : 'false',
      o.errorMessage ?? '',
    ].join('\t'),
  );
  fs.writeFileSync(path.join(runDir, 'summary.tsv'), [header, ...rows, ''].join('\n'));
}

function writeSummaryMd(
  config: ConfigName,
  outcomes: readonly PerObligationOutcome[],
  runDir: string,
  patchSha: string,
  fixtureRoot: string,
  fixtureHash: string,
  totalWallClockMs: number,
  costCapUsd: number,
  haltReason: string | null,
): void {
  const totalBilled = outcomes.reduce((acc, o) => acc + o.dollarsBilled, 0);
  const totalTokenEst = outcomes.reduce((acc, o) => acc + o.dollarsTokenEstimate, 0);
  const totalApiEquiv = outcomes.reduce((acc, o) => acc + o.dollarsApiEquivalent, 0);
  const totalLlmCalls = outcomes.reduce((acc, o) => acc + o.llmCalls, 0);
  const passCount = outcomes.filter((o) => o.pass).length;
  const errored = outcomes.filter((o) => o.errorMessage !== null).length;
  const counterExamples = outcomes.reduce((acc, o) => acc + o.counterExamplesFound, 0);
  const capHits = outcomes.filter((o) => o.costCapHit).length;
  const label = config === 'bp' ? "B' (Codex)" : "B'' (Codex + ClaudeCode)";
  const lines: string[] = [];
  lines.push(`# Phase 4 redo run summary (config ${config.toUpperCase()} — ${label})`);
  lines.push('');
  lines.push(`- Patch SHA: \`${patchSha}\``);
  lines.push(`- Fixture root: \`${fixtureRoot}\``);
  lines.push(`- Fixture content hash: \`${fixtureHash}\``);
  lines.push(`- Cost cap (per obligation, USD): ${costCapUsd.toFixed(4)}`);
  lines.push(`- Obligations: ${outcomes.length}`);
  lines.push(`- Pass count: ${passCount} (passes when *no* adapter reports a counter-example)`);
  lines.push(`- Counter-examples returned (machine-claimed): ${counterExamples}`);
  lines.push(`- Errored obligations: ${errored}`);
  lines.push(`- Cost-cap hits: ${capHits}`);
  lines.push(`- Total wall-clock: ${(totalWallClockMs / 1000).toFixed(1)} s`);
  lines.push(`- Total LLM calls: ${totalLlmCalls}`);
  lines.push(`- Total dollars (billed): $${totalBilled.toFixed(4)}`);
  lines.push(`- Total dollars (token estimate): $${totalTokenEst.toFixed(4)}`);
  lines.push(`- Total dollars (API-equivalent): $${totalApiEquiv.toFixed(4)}`);
  if (haltReason !== null) {
    lines.push('');
    lines.push(`**Halted: ${haltReason}**`);
  }
  lines.push('');
  lines.push('| id | stratum | type | pass | falsifying | per-adapter | yield | FP | $billed | $tokenEst | $apiEquiv | calls | ms | cap | error |');
  lines.push('|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|');
  for (const o of outcomes) {
    lines.push(
      `| ${o.id} | ${o.stratum} | ${o.type} | ${o.pass ? 'yes' : 'no'} | ${o.falsifyingAdapters || '—'} | ${o.perAdapterYield} | ${o.counterExamplesFound} | ${o.falsePositives} | ${o.dollarsBilled.toFixed(4)} | ${o.dollarsTokenEstimate.toFixed(4)} | ${o.dollarsApiEquivalent.toFixed(4)} | ${o.llmCalls} | ${o.wallClockMs} | ${o.costCapHit ? 'HIT' : ''} | ${o.errorMessage ?? ''} |`,
    );
  }
  lines.push('');
  fs.writeFileSync(path.join(runDir, 'summary.md'), lines.join('\n'));
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const repo = repoRoot();
  const obligationsPath = flags.obligationsPathOverride
    ? path.isAbsolute(flags.obligationsPathOverride)
      ? flags.obligationsPathOverride
      : path.resolve(repo, flags.obligationsPathOverride)
    : path.join(repo, 'evidence', 'phase4-redo', 'obligations.json');
  if (!fs.existsSync(obligationsPath)) {
    throw new Error(`obligations file missing at ${obligationsPath}`);
  }
  const sample = JSON.parse(fs.readFileSync(obligationsPath, 'utf8')) as PhaseSampleFile;
  if (sample.obligations.length !== sample.obligationCount) {
    throw new Error(
      `obligations.json: declared count ${sample.obligationCount} != obligations.length ${sample.obligations.length}`,
    );
  }

  const fixtureRoot = flags.fixtureRootOverride
    ? path.isAbsolute(flags.fixtureRootOverride)
      ? flags.fixtureRootOverride
      : path.resolve(repo, flags.fixtureRootOverride)
    : path.resolve(repo, sample.fixturePath);
  if (!fs.existsSync(fixtureRoot)) {
    throw new Error(`fixture root missing at ${fixtureRoot}`);
  }
  const fixtureHash = fixtureContentHash(fixtureRoot);

  const runDir = path.join(repo, 'evidence', 'phase4-redo', 'run', `config-${flags.config}`);
  let resumeProgress: RuntimeProgress | null = null;
  if (fs.existsSync(runDir)) {
    if (!flags.resume) {
      throw new Error(
        `run directory already exists: ${runDir}. Remove it or pass --resume to continue.`,
      );
    }
    const file = progressFile(runDir);
    if (!fs.existsSync(file)) {
      throw new Error(`--resume passed but ${file} is missing.`);
    }
    resumeProgress = JSON.parse(fs.readFileSync(file, 'utf8')) as RuntimeProgress;
    if (resumeProgress.fixtureContentHash !== fixtureHash) {
      throw new Error(
        `--resume fixture hash mismatch: progress ${resumeProgress.fixtureContentHash}, current ${fixtureHash}`,
      );
    }
    if (resumeProgress.config !== flags.config) {
      throw new Error(
        `--resume config mismatch: progress ${resumeProgress.config}, requested ${flags.config}`,
      );
    }
  } else {
    fs.mkdirSync(runDir, { recursive: true });
  }

  const patchSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const startedAtIso = resumeProgress?.startedAtIso ?? new Date().toISOString();
  if (!fs.existsSync(path.join(runDir, 'environment.json'))) {
    fs.writeFileSync(
      path.join(runDir, 'environment.json'),
      JSON.stringify(
        {
          config: flags.config,
          startedAtIso,
          patchSha,
          fixtureRoot: path.relative(repo, fixtureRoot),
          fixtureContentHash: fixtureHash,
          repoRoot: repo,
          nodeVersion: process.version,
          platform: `${os.platform()}-${os.arch()}`,
          timeBudgetMs: flags.timeBudgetMs,
          costCapUsd: flags.costCapUsd,
          maxTotalSpendUsd: flags.maxTotalSpendUsd,
        },
        null,
        2,
      ) + '\n',
    );
  }

  const outcomes: PerObligationOutcome[] = [...(resumeProgress?.outcomes ?? [])];
  const completedIds = new Set<string>(outcomes.map((o) => o.id));
  const startedAt = Date.now();
  let haltReason: string | null = null;

  for (const obligation of sample.obligations) {
    if (completedIds.has(obligation.id)) {
      process.stderr.write(`[phase4r-${flags.config}] skipping ${obligation.id}: already completed\n`);
      continue;
    }
    // Total-spend ceiling check: halt before invoking the next
    // obligation if the running total has reached the per-Part-C
    // ceiling. The running total counts dollarsApiEquivalent across
    // adapters because that is the cross-adapter comparison surface.
    const runningSpend = outcomes.reduce(
      (acc, o) => acc + Math.max(o.dollarsApiEquivalent, o.dollarsBilled),
      0,
    );
    if (runningSpend >= flags.maxTotalSpendUsd) {
      haltReason = `running spend $${runningSpend.toFixed(4)} reached --max-total-spend-usd ${flags.maxTotalSpendUsd}; halting before obligation ${obligation.id}.`;
      process.stderr.write(`[phase4r-${flags.config}] ${haltReason}\n`);
      break;
    }
    const obligationDir = path.join(runDir, obligation.id);
    fs.mkdirSync(obligationDir, { recursive: true });

    const t0 = Date.now();
    process.stderr.write(
      `[phase4r-${flags.config}] starting ${obligation.id} (${obligation.stratum}/${obligation.target})\n`,
    );

    const outcome = await runConfig(
      obligation,
      obligationDir,
      fixtureRoot,
      patchSha,
      flags.timeBudgetMs,
      flags.costCapUsd,
      flags.config,
    );
    outcomes.push(outcome);
    completedIds.add(outcome.id);
    process.stderr.write(
      `[phase4r-${flags.config}]   ${outcome.id} -> pass=${outcome.pass} ` +
        `falsifying=${outcome.falsifyingAdapters || '—'} ` +
        `yield=${outcome.counterExamplesFound} ` +
        `per=${outcome.perAdapterYield} ` +
        `billed=$${outcome.dollarsBilled.toFixed(4)} ` +
        `tokenEst=$${outcome.dollarsTokenEstimate.toFixed(4)} ` +
        `apiEquiv=$${outcome.dollarsApiEquivalent.toFixed(4)} ` +
        `calls=${outcome.llmCalls} ` +
        `ms=${Date.now() - t0}` +
        `${outcome.costCapHit ? ' COST-CAP-HIT' : ''}` +
        `${outcome.errorMessage ? ` err="${outcome.errorMessage}"` : ''}\n`,
    );

    fs.writeFileSync(
      progressFile(runDir),
      JSON.stringify(
        {
          config: flags.config,
          fixtureContentHash: fixtureHash,
          startedAtIso,
          completedIds: [...completedIds],
          outcomes,
        } satisfies RuntimeProgress,
        null,
        2,
      ) + '\n',
    );

    if (outcome.errorMessage !== null) {
      haltReason = `obligation ${obligation.id} errored: ${outcome.errorMessage}`;
      process.stderr.write(
        `[phase4r-${flags.config}] obligation ${obligation.id} errored; halting per "no defensive try/catch" policy.\n`,
      );
      break;
    }
  }

  const totalWallClockMs = Date.now() - startedAt;
  fs.writeFileSync(
    path.join(runDir, 'runtime.json'),
    JSON.stringify(
      {
        config: flags.config,
        totalWallClockMs,
        totalDollarsBilled: outcomes.reduce((acc, o) => acc + o.dollarsBilled, 0),
        totalDollarsTokenEstimate: outcomes.reduce((acc, o) => acc + o.dollarsTokenEstimate, 0),
        totalDollarsApiEquivalent: outcomes.reduce((acc, o) => acc + o.dollarsApiEquivalent, 0),
        totalLlmCalls: outcomes.reduce((acc, o) => acc + o.llmCalls, 0),
        obligationCount: outcomes.length,
        finishedAtIso: new Date().toISOString(),
        fixtureContentHash: fixtureHash,
        haltReason,
      },
      null,
      2,
    ) + '\n',
  );
  writeSummaryTsv(outcomes, runDir);
  writeSummaryMd(
    flags.config,
    outcomes,
    runDir,
    patchSha,
    fixtureRoot,
    fixtureHash,
    totalWallClockMs,
    flags.costCapUsd,
    haltReason,
  );

  process.stderr.write(
    `[phase4r-${flags.config}] done. evidence: ${path.relative(repo, runDir)}/\n`,
  );

  if (haltReason !== null) {
    process.exit(2);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[phase4r-harness] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
