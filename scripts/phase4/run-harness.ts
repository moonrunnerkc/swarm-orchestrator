/* eslint-disable no-console */
/**
 * Phase 4 paired-run harness.
 *
 * Reuses the locked Phase 3 obligation set at
 * `evidence/phase3/obligations.json`. Runs one of two configs across
 * the 20 obligations sequentially. Per-obligation evidence lives under
 * `evidence/phase4/run/<config>/<id>/`.
 *
 * Configs:
 *   - `bp`  Producer + Codex + Copilot (Phase 3's shipped configuration).
 *           Mirrors the dispatch path that ran in Phase 3's Config B'.
 *   - `bpp` (Config B'') Producer + Codex + Copilot + ClaudeCode. Adds
 *           the ClaudeCode falsifier; the dispatcher offers each
 *           obligation to every adapter that handles it. The harness
 *           records each adapter's outcome separately and aggregates
 *           "any-adapter falsified" as the per-obligation pass/fail.
 *
 * Per-obligation artifacts (one directory per obligation per config):
 *   - `result.json`            aggregated outcome across all adapters
 *                              that handled the obligation.
 *   - `cost.json`              { dollarsBilled, dollarsTokenEstimate,
 *                                wallClockMs, llmCalls, costCapHit }
 *                              summed across the adapters that ran.
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
 *   node dist/scripts/phase4/run-harness.js --config <bp|bpp> [flags]
 *
 *   --config <bp|bpp>          required.
 *   --time-budget-ms M         per-obligation wall-clock. Default 300000.
 *   --cost-cap-usd N           per-obligation hard cap. Default 0.65 (bp)
 *                              or 1.50 (bpp; ClaudeCode is more expensive).
 *   --fixture-root <path>      override fixture location.
 *   --obligations <path>       override the obligations file.
 *   --resume                   re-enter an existing run dir.
 */

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { CliFalsifier, type CliInvocationRequest, type CliInvocationResult } from '../../src/falsification/adapters/cli-falsifier';
import { copilotProfile } from '../../src/falsification/adapters/profiles/copilot';
import { claudeCodeProfile } from '../../src/falsification/adapters/profiles/claude-code';
import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
  ObligationV1,
} from '../../src/contract/types';
import type {
  AdapterCostRecord,
  FalsificationInput,
  FalsifierAdapter,
  FalsifyOutcome,
} from '../../src/falsification/adapters/types';

loadDotenv();

interface Phase3Obligation {
  readonly id: string;
  readonly stratum: 'I' | 'F';
  readonly type: 'import-graph-must-satisfy' | 'function-must-have-signature';
  readonly constraint?: 'no-cycles' | 'no-upward-imports';
  readonly scope?: string;
  readonly file?: string;
  readonly name?: string;
  readonly signature?: string;
}

interface Phase3SampleFile {
  readonly obligationCount: number;
  readonly obligations: readonly Phase3Obligation[];
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
}

const DEFAULT_TIME_BUDGET_MS = 300_000;
const DEFAULT_COST_CAP_BP_USD = 0.65;
const DEFAULT_COST_CAP_BPP_USD = 1.5;

function parseFlags(argv: readonly string[]): CliFlags {
  let config: ConfigName | null = null;
  let timeBudgetMs = DEFAULT_TIME_BUDGET_MS;
  let costCapUsd: number | null = null;
  let fixtureRootOverride: string | null = null;
  let obligationsPathOverride: string | null = null;
  let resume = false;
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
        'Usage: node dist/scripts/phase4/run-harness.js --config <bp|bpp> ' +
          '[--time-budget-ms M] [--cost-cap-usd N] [--fixture-root PATH] ' +
          '[--obligations PATH] [--resume]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (config === null) throw new Error('--config <bp|bpp> is required');
  const resolvedCap =
    costCapUsd !== null ? costCapUsd : config === 'bp' ? DEFAULT_COST_CAP_BP_USD : DEFAULT_COST_CAP_BPP_USD;
  return {
    config,
    timeBudgetMs,
    costCapUsd: resolvedCap,
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

function toObligation(
  sample: Phase3Obligation,
): ImportGraphMustSatisfyObligation | FunctionMustHaveSignatureObligation {
  if (sample.type === 'import-graph-must-satisfy') {
    if (sample.constraint === undefined || sample.scope === undefined) {
      throw new Error(`obligation ${sample.id} missing constraint/scope`);
    }
    return { type: 'import-graph-must-satisfy', constraint: sample.constraint, scope: sample.scope };
  }
  if (sample.file === undefined || sample.name === undefined || sample.signature === undefined) {
    throw new Error(`obligation ${sample.id} missing file/name/signature`);
  }
  return {
    type: 'function-must-have-signature',
    file: sample.file,
    name: sample.name,
    signature: sample.signature,
  };
}

interface AdapterRunRecord {
  readonly adapterName: string;
  readonly outcome: FalsifyOutcome | null;
  readonly errorMessage: string | null;
}

interface PerObligationOutcome {
  readonly id: string;
  readonly stratum: 'I' | 'F';
  readonly type: string;
  /** True iff *no* adapter reported a counter-example. */
  readonly pass: boolean;
  /** Comma-separated list of adapter names that reported counter-examples. */
  readonly falsifyingAdapters: string;
  /** Per-adapter counter-example counts, joined as `name=N` pairs. */
  readonly perAdapterYield: string;
  readonly counterExamplesFound: number;
  readonly falsePositives: number;
  readonly dollarsBilled: number;
  readonly dollarsTokenEstimate: number;
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
  // Codex is registered as a default adapter but its handles list does
  // not include the Phase 3 obligation types, so it is omitted here to
  // avoid a per-call no-op spawn-shape (`falsify` would short-circuit
  // on strategy-not-applicable). The dispatcher in production handles
  // that filtering automatically; the harness mirrors the production
  // dispatch by registering only the adapters whose strategies match.
  if (config === 'bp') {
    return [new CliFalsifier(copilotProfile, )];
  }
  return [new CliFalsifier(copilotProfile, ), new CliFalsifier(claudeCodeProfile, )];
}

async function runConfig(
  sample: Phase3Obligation,
  obligationDir: string,
  fixtureRoot: string,
  patchSha: string,
  timeBudgetMs: number,
  costCapUsd: number,
  config: ConfigName,
): Promise<PerObligationOutcome> {
  const obligation = toObligation(sample);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `phase4-${config}-${sample.id}-`));
  const workspaceRoot = path.join(tmpRoot, 'workspace');
  copyFixtureInto(fixtureRoot, workspaceRoot);

  const adapters = buildAdapters(config);
  const adapterRecords: AdapterRunRecord[] = [];
  let firstError: string | null = null;

  // Per-adapter capture hooks. We attach an `onInvocation` hook by
  // re-wrapping the spawn factory; for simplicity here we capture the
  // raw subprocess output via a side-channel array that each adapter
  // pushes to.
  const subprocessCaptures: Array<{
    adapterName: string;
    request: CliInvocationRequest | CliInvocationRequest;
    result: CliInvocationResult | CliInvocationResult;
  }> = [];

  // Build adapter-specific instances with onInvocation hooks attached.
  // Re-build adapters here so the hook closures see `subprocessCaptures`
  // bound to this call.
  const hookedAdapters: FalsifierAdapter[] = [];
  for (const adapter of adapters) {
    if (adapter.name === 'copilot') {
      hookedAdapters.push(
        new CliFalsifier(copilotProfile, {
          onInvocation: (request, result) => {
            subprocessCaptures.push({ adapterName: 'copilot', request, result });
          },
        }),
      );
    } else if (adapter.name === 'claude-code') {
      hookedAdapters.push(
        new CliFalsifier(claudeCodeProfile, {
          onInvocation: (request, result) => {
            subprocessCaptures.push({ adapterName: 'claude-code', request, result });
          },
        }),
      );
    } else {
      hookedAdapters.push(adapter);
    }
  }

  const t0 = Date.now();
  for (const adapter of hookedAdapters) {
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
      break; // halt on first error per "no defensive try/catch" policy
    }
  }
  const totalWallClockMs = Date.now() - t0;

  // Persist per-adapter raw output before tearing down workspace.
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
  const llmCalls = adapterRecords.reduce(
    (acc, r) =>
      acc +
      (r.outcome !== null && !isBaselineSkip(r.outcome.cost) ? 1 : 0),
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
    totalDollarsBilled > costCapUsd || totalDollarsTokenEstimate > costCapUsd;

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
    llmCalls,
    wallClockMs: totalWallClockMs,
    costCapUsd,
    costCapHit,
    errorMessage: firstError,
  };
}

function isBaselineSkip(cost: AdapterCostRecord): boolean {
  return cost.dollarsTokenEstimate === 0 && cost.counterExamplesFound === 0 && cost.falsePositives === 0;
}

function writeSummaryTsv(outcomes: readonly PerObligationOutcome[], runDir: string): void {
  const header =
    'id\tstratum\ttype\tpass\tfalsifying\tperAdapterYield\tcounterExamples\tfalsePositives\tdollarsBilled\tdollarsTokenEstimate\tllmCalls\twallClockMs\tcostCapHit\terror';
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
): void {
  const totalBilled = outcomes.reduce((acc, o) => acc + o.dollarsBilled, 0);
  const totalTokenEst = outcomes.reduce((acc, o) => acc + o.dollarsTokenEstimate, 0);
  const totalLlmCalls = outcomes.reduce((acc, o) => acc + o.llmCalls, 0);
  const passCount = outcomes.filter((o) => o.pass).length;
  const errored = outcomes.filter((o) => o.errorMessage !== null).length;
  const counterExamples = outcomes.reduce((acc, o) => acc + o.counterExamplesFound, 0);
  const capHits = outcomes.filter((o) => o.costCapHit).length;
  const label = config === 'bp' ? "B' (Codex + Copilot)" : "B'' (Codex + Copilot + ClaudeCode)";
  const lines: string[] = [];
  lines.push(`# Phase 4 run summary (config ${config.toUpperCase()} — ${label})`);
  lines.push('');
  lines.push(`- Patch SHA: \`${patchSha}\``);
  lines.push(`- Fixture root: \`${fixtureRoot}\``);
  lines.push(`- Fixture content hash: \`${fixtureHash}\``);
  lines.push(`- Cost cap (per obligation, USD): ${costCapUsd.toFixed(4)}`);
  lines.push(`- Obligations: ${outcomes.length}`);
  lines.push(`- Pass count: ${passCount} (passes when *no* adapter reports a counter-example)`);
  lines.push(`- Counter-examples returned (machine-claimed, total across adapters): ${counterExamples}`);
  lines.push(`- Errored obligations: ${errored}`);
  lines.push(`- Cost-cap hits: ${capHits}`);
  lines.push(`- Total wall-clock: ${(totalWallClockMs / 1000).toFixed(1)} s`);
  lines.push(`- Total LLM calls: ${totalLlmCalls}`);
  lines.push(`- Total dollars (billed): $${totalBilled.toFixed(4)}`);
  lines.push(`- Total dollars (token estimate): $${totalTokenEst.toFixed(4)}`);
  lines.push('');
  lines.push('| id | stratum | type | pass | falsifying | per-adapter | yield | FP | $billed | $tokenEst | calls | ms | cap | error |');
  lines.push('|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|');
  for (const o of outcomes) {
    lines.push(
      `| ${o.id} | ${o.stratum} | ${o.type} | ${o.pass ? 'yes' : 'no'} | ${o.falsifyingAdapters || '—'} | ${o.perAdapterYield} | ${o.counterExamplesFound} | ${o.falsePositives} | ${o.dollarsBilled.toFixed(4)} | ${o.dollarsTokenEstimate.toFixed(4)} | ${o.llmCalls} | ${o.wallClockMs} | ${o.costCapHit ? 'HIT' : ''} | ${o.errorMessage ?? ''} |`,
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
    : path.join(repo, 'evidence', 'phase3', 'obligations.json');
  if (!fs.existsSync(obligationsPath)) {
    throw new Error(`obligations file missing at ${obligationsPath}`);
  }
  const sample = JSON.parse(fs.readFileSync(obligationsPath, 'utf8')) as Phase3SampleFile;
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

  const runDir = path.join(repo, 'evidence', 'phase4', 'run', `config-${flags.config}`);
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
        },
        null,
        2,
      ) + '\n',
    );
  }

  const outcomes: PerObligationOutcome[] = [...(resumeProgress?.outcomes ?? [])];
  const completedIds = new Set<string>(outcomes.map((o) => o.id));
  const startedAt = Date.now();

  for (const obligation of sample.obligations) {
    if (completedIds.has(obligation.id)) {
      process.stderr.write(`[phase4-${flags.config}] skipping ${obligation.id}: already completed\n`);
      continue;
    }
    const obligationDir = path.join(runDir, obligation.id);
    fs.mkdirSync(obligationDir, { recursive: true });

    const t0 = Date.now();
    process.stderr.write(
      `[phase4-${flags.config}] starting ${obligation.id} (${obligation.stratum}/${obligation.type})\n`,
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
      `[phase4-${flags.config}]   ${outcome.id} -> pass=${outcome.pass} ` +
        `falsifying=${outcome.falsifyingAdapters || '—'} ` +
        `yield=${outcome.counterExamplesFound} ` +
        `per=${outcome.perAdapterYield} ` +
        `billed=$${outcome.dollarsBilled.toFixed(4)} ` +
        `tokenEst=$${outcome.dollarsTokenEstimate.toFixed(4)} ` +
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
      process.stderr.write(
        `[phase4-${flags.config}] obligation ${obligation.id} errored; halting per "no defensive try/catch" policy.\n`,
      );
      writeSummaryTsv(outcomes, runDir);
      writeSummaryMd(
        flags.config,
        outcomes,
        runDir,
        patchSha,
        fixtureRoot,
        fixtureHash,
        Date.now() - startedAt,
        flags.costCapUsd,
      );
      process.exit(2);
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
        totalLlmCalls: outcomes.reduce((acc, o) => acc + o.llmCalls, 0),
        obligationCount: outcomes.length,
        finishedAtIso: new Date().toISOString(),
        fixtureContentHash: fixtureHash,
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
  );

  process.stderr.write(
    `[phase4-${flags.config}] done. evidence: ${path.relative(repo, runDir)}/\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[phase4-harness] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
