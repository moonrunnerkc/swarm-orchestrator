/* eslint-disable no-console */
/**
 * Phase 2 paired-run harness.
 *
 * Reads the locked Phase 2 obligation set at
 * `evidence/phase2/obligations.json`, runs one of two configs across all
 * 30 obligations sequentially, and writes per-obligation evidence under
 * `evidence/phase2/run/<config>/`.
 *
 * Config A: producer-only. The "producer" for property-must-hold here is
 *   the predicate evaluator the existing v8.0.1 pipeline runs at
 *   pre-merge time (`src/falsification/adapters/codex/predicate-runner.ts`'s
 *   `checkPredicateBaseline`, which is the same shell-exec the property-gate
 *   layer uses). No Codex spawn. Captures: predicate exit code, stdout/stderr,
 *   wall-clock, $0 cost, 0 LLM calls.
 * Config B: producer + Codex falsifier in sequence (the existing
 *   `CodexFalsifier` path; the falsifier internally checks the baseline,
 *   then dispatches Codex if baseline passes). Captures: same predicate
 *   data + Codex outcome, total wall-clock, billed/token-estimate cost,
 *   1 LLM call per Codex invocation.
 *
 * The harness does NOT modify the workspace between configs. Each
 * obligation gets a fresh fixture copy in a temp directory; that directory
 * is removed after the call returns.
 *
 * Per-obligation artifacts (one directory per obligation per config):
 *   - `result.json` — the FalsifyOutcome (config A: a synthesized
 *     producer-only outcome; config B: the actual CodexFalsifier outcome)
 *   - `cost.json` — { dollarsBilled, dollarsTokenEstimate, wallClockMs,
 *     llmCalls, costCapHit } — the four pre-registered metrics plus a
 *     boolean for "did this obligation hit the cost cap?"
 *   - `stdout.log` — predicate stdout/stderr (always) plus codex
 *     stdout/stderr (config B only)
 *
 * Aggregate artifacts under each run directory:
 *   - `summary.md` — operator-readable rendering, schema parallel to Phase 1
 *   - `summary.tsv` — one row per obligation, machine-friendly
 *   - `runtime.json` — wall-clock total, cost total, LLM-call total
 *   - `environment.json` — config, fixture path/hash, patch SHA, node version
 *
 * Invocation:
 *   node dist/scripts/phase2/run-harness.js --config <a|b> [flags]
 *
 *   --config <a|b>          Required. Selects which run to perform.
 *   --time-budget-ms M      Per-obligation wall-clock budget. Default 300000.
 *   --cost-cap-usd N        Per-obligation hard cost cap. Default depends
 *                           on --config (A: 0.01, B: 1.00).
 *   --fixture-root <path>   Override the fixture path. Default reads
 *                           `fixturePath` from obligations.json.
 *   --obligations <path>    Override the obligations file path. Default
 *                           `evidence/phase2/obligations.json`.
 *   --resume                Re-enter an existing run dir; skip obligations
 *                           already recorded in runtime-progress.json.
 *
 * Without --resume the harness refuses to overwrite an existing run dir.
 */

import { execFileSync, execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { CliFalsifier, type CliInvocationRequest, type CliInvocationResult } from '../../src/falsification/adapters/cli-falsifier';
import { codexProfile } from '../../src/falsification/adapters/profiles/codex';
import type { ObligationV1, PropertyMustHoldObligation } from '../../src/contract/types';
import type { FalsificationInput, FalsifyOutcome } from '../../src/falsification/adapters/types';

loadDotenv();

interface Phase2Obligation {
  readonly id: string;
  readonly stratum: 'A' | 'B' | 'C';
  readonly type: 'property-must-hold';
  readonly target: string;
  readonly predicate: string;
  readonly expectedPreApplyExit: number;
}

interface Phase2SampleFile {
  readonly obligationCount: number;
  readonly obligations: readonly Phase2Obligation[];
  readonly fixturePath: string;
}

type ConfigName = 'a' | 'b';

interface CliFlags {
  readonly config: ConfigName;
  readonly timeBudgetMs: number;
  readonly costCapUsd: number;
  readonly fixtureRootOverride: string | null;
  readonly obligationsPathOverride: string | null;
  readonly resume: boolean;
}

const DEFAULT_TIME_BUDGET_MS = 300_000;
const DEFAULT_COST_CAP_A_USD = 0.01;
// Config B per-obligation hard cap. 30 × $0.65 = $19.50 + Config A's
// $0.30 worst case = $19.80 total. Tightened from the original $1.00
// proposal after the operator approved a $20 worst-case ceiling for
// Phase 2.
const DEFAULT_COST_CAP_B_USD = 0.65;

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
      if (next !== 'a' && next !== 'b') {
        throw new Error(`--config requires value 'a' or 'b', got ${next}`);
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
        'Usage: node dist/scripts/phase2/run-harness.js --config <a|b> ' +
          '[--time-budget-ms M] [--cost-cap-usd N] [--fixture-root PATH] ' +
          '[--obligations PATH] [--resume]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (config === null) throw new Error('--config <a|b> is required');
  const resolvedCap =
    costCapUsd !== null ? costCapUsd : config === 'a' ? DEFAULT_COST_CAP_A_USD : DEFAULT_COST_CAP_B_USD;
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

function toObligation(sample: Phase2Obligation): PropertyMustHoldObligation {
  return {
    type: 'property-must-hold',
    predicate: sample.predicate,
    target: sample.target,
  };
}

interface PredicateRunResult {
  readonly exitCode: number;
  readonly output: string;
  readonly wallClockMs: number;
}

function runPredicate(predicate: string, cwd: string): PredicateRunResult {
  const t0 = Date.now();
  try {
    const stdout = execSync(predicate, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout, wallClockMs: Date.now() - t0 };
  } catch (cause) {
    const err = cause as { status?: unknown; stdout?: unknown; stderr?: unknown };
    const status = typeof err.status === 'number' ? err.status : 1;
    const stdout = typeof err.stdout === 'string' ? err.stdout : '';
    const stderr = typeof err.stderr === 'string' ? err.stderr : '';
    return {
      exitCode: status,
      output: `${stdout}${stderr}`,
      wallClockMs: Date.now() - t0,
    };
  }
}

interface PerObligationOutcome {
  readonly id: string;
  readonly stratum: 'A' | 'B' | 'C';
  readonly target: string;
  readonly predicate: string;
  /** "pass" iff the system returns no falsification (config A: predicate exits 0; config B: predicate exits 0 AND codex returns no-counter-example). */
  readonly pass: boolean;
  /** Result kind from FalsifyOutcome (config B); for config A, "predicate-passes" or "predicate-fails". */
  readonly resultKind: string;
  readonly resultReason: string | null;
  readonly counterExamplesFound: number;
  readonly falsePositives: number;
  readonly dollarsBilled: number;
  readonly dollarsTokenEstimate: number;
  readonly authMethod: string;
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

async function runConfigA(
  sample: Phase2Obligation,
  obligationDir: string,
  fixtureRoot: string,
  costCapUsd: number,
): Promise<PerObligationOutcome> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `phase2-A-${sample.id}-`));
  const workspaceRoot = path.join(tmpRoot, 'workspace');
  copyFixtureInto(fixtureRoot, workspaceRoot);
  let exec: PredicateRunResult;
  try {
    exec = runPredicate(sample.predicate, workspaceRoot);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const pass = exec.exitCode === 0;
  const result = {
    config: 'a',
    obligationId: sample.id,
    kind: pass ? 'predicate-passes' : 'predicate-fails',
    predicateExitCode: exec.exitCode,
    predicateWallClockMs: exec.wallClockMs,
  };
  fs.writeFileSync(path.join(obligationDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(obligationDir, 'stdout.log'), exec.output);
  const cost = {
    dollarsBilled: 0,
    dollarsTokenEstimate: 0,
    wallClockMs: exec.wallClockMs,
    llmCalls: 0,
    costCapUsd,
    costCapHit: 0 > costCapUsd,
  };
  fs.writeFileSync(path.join(obligationDir, 'cost.json'), JSON.stringify(cost, null, 2) + '\n');

  return {
    id: sample.id,
    stratum: sample.stratum,
    target: sample.target,
    predicate: sample.predicate,
    pass,
    resultKind: result.kind,
    resultReason: null,
    counterExamplesFound: 0,
    falsePositives: 0,
    dollarsBilled: 0,
    dollarsTokenEstimate: 0,
    authMethod: 'none',
    llmCalls: 0,
    wallClockMs: exec.wallClockMs,
    costCapUsd,
    costCapHit: false,
    errorMessage: null,
  };
}

async function runConfigB(
  sample: Phase2Obligation,
  obligationDir: string,
  fixtureRoot: string,
  patchSha: string,
  timeBudgetMs: number,
  costCapUsd: number,
): Promise<PerObligationOutcome> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `phase2-B-${sample.id}-`));
  const workspaceRoot = path.join(tmpRoot, 'workspace');
  copyFixtureInto(fixtureRoot, workspaceRoot);

  const obligation = toObligation(sample);
  let lastInvocation: { request: CliInvocationRequest; result: CliInvocationResult } | null =
    null;
  const falsifier = new CliFalsifier(codexProfile, {
    onInvocation: (request, result) => {
      lastInvocation = { request, result };
    },
  });

  const input: FalsificationInput = {
    patchSha,
    obligation: obligation as ObligationV1,
    contextRefs: [],
    timeBudgetMs,
    workspaceRoot,
  };

  const t0 = Date.now();
  let outcome: FalsifyOutcome | null = null;
  let errorMessage: string | null = null;
  let predicateBaselineOutput = '';
  try {
    // Capture baseline predicate output up-front for the stdout.log even
    // though CodexFalsifier itself does this internally; we need both the
    // pre-apply baseline and Codex's stdout in the captured log.
    const baseline = runPredicate(sample.predicate, workspaceRoot);
    predicateBaselineOutput = baseline.output;
    outcome = await falsifier.falsify(input);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    if (lastInvocation !== null) {
      const li = lastInvocation as { request: CliInvocationRequest; result: CliInvocationResult };
      fs.writeFileSync(
        path.join(obligationDir, 'request.json'),
        JSON.stringify(
          {
            binaryPath: li.request.binaryPath,
            args: li.request.args,
            cwd: li.request.cwd,
            timeoutMs: li.request.timeoutMs,
            prompt: li.request.prompt,
          },
          null,
          2,
        ) + '\n',
      );
      fs.writeFileSync(path.join(obligationDir, 'codex-stdout.txt'), li.result.stdout);
      fs.writeFileSync(path.join(obligationDir, 'codex-stderr.txt'), li.result.stderr);
      fs.writeFileSync(path.join(obligationDir, 'codex-exit-code.txt'), `${li.result.exitCode}\n`);
    }
    if (errorMessage !== null) {
      fs.writeFileSync(path.join(obligationDir, 'error.txt'), errorMessage + '\n');
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  const totalWallClockMs = Date.now() - t0;

  if (outcome === null) {
    const stdoutLog = `--- predicate baseline ---\n${predicateBaselineOutput}\n--- error ---\n${errorMessage ?? ''}\n`;
    fs.writeFileSync(path.join(obligationDir, 'stdout.log'), stdoutLog);
    const cost = {
      dollarsBilled: 0,
      dollarsTokenEstimate: 0,
      wallClockMs: totalWallClockMs,
      llmCalls: lastInvocation !== null ? 1 : 0,
      costCapUsd,
      costCapHit: false,
    };
    fs.writeFileSync(path.join(obligationDir, 'cost.json'), JSON.stringify(cost, null, 2) + '\n');
    return {
      id: sample.id,
      stratum: sample.stratum,
      target: sample.target,
      predicate: sample.predicate,
      pass: false,
      resultKind: 'errored',
      resultReason: null,
      counterExamplesFound: 0,
      falsePositives: 0,
      dollarsBilled: 0,
      dollarsTokenEstimate: 0,
      authMethod: 'unknown',
      llmCalls: lastInvocation !== null ? 1 : 0,
      wallClockMs: totalWallClockMs,
      costCapUsd,
      costCapHit: false,
      errorMessage,
    };
  }

  fs.writeFileSync(path.join(obligationDir, 'result.json'), JSON.stringify(outcome, null, 2) + '\n');
  const codexStdoutTxt =
    lastInvocation !== null
      ? (lastInvocation as { result: CliInvocationResult }).result.stdout
      : '';
  const codexStderrTxt =
    lastInvocation !== null
      ? (lastInvocation as { result: CliInvocationResult }).result.stderr
      : '';
  fs.writeFileSync(
    path.join(obligationDir, 'stdout.log'),
    `--- predicate baseline ---\n${predicateBaselineOutput}\n--- codex stdout ---\n${codexStdoutTxt}\n--- codex stderr ---\n${codexStderrTxt}\n`,
  );
  const llmCalls =
    outcome.result.kind === 'no-falsification-found' &&
    outcome.result.reason === 'baseline-predicate-failed'
      ? 0
      : 1;
  const dollarsBilled = outcome.cost.dollarsBilled;
  const dollarsTokenEstimate = outcome.cost.dollarsTokenEstimate;
  const costCapHit = dollarsBilled > costCapUsd || dollarsTokenEstimate > costCapUsd;
  const cost = {
    dollarsBilled,
    dollarsTokenEstimate,
    wallClockMs: totalWallClockMs,
    llmCalls,
    costCapUsd,
    costCapHit,
  };
  fs.writeFileSync(path.join(obligationDir, 'cost.json'), JSON.stringify(cost, null, 2) + '\n');

  const pass = outcome.result.kind !== 'counter-example-input';
  const resultReason =
    outcome.result.kind === 'no-falsification-found' ? outcome.result.reason : null;
  return {
    id: sample.id,
    stratum: sample.stratum,
    target: sample.target,
    predicate: sample.predicate,
    pass,
    resultKind: outcome.result.kind,
    resultReason,
    counterExamplesFound:
      outcome.result.kind === 'counter-example-input' ? outcome.result.inputs.length : 0,
    falsePositives: outcome.cost.falsePositives,
    dollarsBilled,
    dollarsTokenEstimate,
    authMethod: outcome.cost.authMethod,
    llmCalls,
    wallClockMs: totalWallClockMs,
    costCapUsd,
    costCapHit,
    errorMessage: null,
  };
}

function writeSummaryTsv(
  outcomes: readonly PerObligationOutcome[],
  runDir: string,
): void {
  const header =
    'id\tstratum\tpass\tresultKind\tresultReason\tcounterExamples\tfalsePositives\tdollarsBilled\tdollarsTokenEstimate\tllmCalls\twallClockMs\tcostCapHit\terror';
  const rows = outcomes.map((o) =>
    [
      o.id,
      o.stratum,
      o.pass ? 'true' : 'false',
      o.resultKind,
      o.resultReason ?? '',
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

  const lines: string[] = [];
  lines.push(`# Phase 2 run summary (config ${config.toUpperCase()})`);
  lines.push('');
  lines.push(`- Patch SHA: \`${patchSha}\``);
  lines.push(`- Fixture root: \`${fixtureRoot}\``);
  lines.push(`- Fixture content hash: \`${fixtureHash}\``);
  lines.push(`- Cost cap (per obligation, USD): ${costCapUsd.toFixed(4)}`);
  lines.push(`- Obligations: ${outcomes.length}`);
  lines.push(`- Pass count: ${passCount} (passes when system returns no falsification)`);
  lines.push(`- Counter-examples returned (machine-claimed): ${counterExamples}`);
  lines.push(`- Errored obligations: ${errored}`);
  lines.push(`- Cost-cap hits: ${capHits}`);
  lines.push(`- Total wall-clock: ${(totalWallClockMs / 1000).toFixed(1)} s`);
  lines.push(`- Total LLM calls: ${totalLlmCalls}`);
  lines.push(`- Total dollars (billed): $${totalBilled.toFixed(4)}`);
  lines.push(`- Total dollars (token estimate): $${totalTokenEst.toFixed(4)}`);
  lines.push('');
  lines.push('| id | stratum | pass | result | yield | FP | $billed | $tokenEst | calls | ms | cap | error |');
  lines.push('|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|');
  for (const o of outcomes) {
    lines.push(
      `| ${o.id} | ${o.stratum} | ${o.pass ? 'yes' : 'no'} | ${o.resultKind}${o.resultReason ? '/' + o.resultReason : ''} | ${o.counterExamplesFound} | ${o.falsePositives} | ${o.dollarsBilled.toFixed(4)} | ${o.dollarsTokenEstimate.toFixed(4)} | ${o.llmCalls} | ${o.wallClockMs} | ${o.costCapHit ? 'HIT' : ''} | ${o.errorMessage ?? ''} |`,
    );
  }
  lines.push('');
  lines.push(
    'Pass = system returns no falsification (config A: predicate exits 0; config B: predicate exits 0 and Codex returns no counter-example). Cost-cap hits are flagged separately and counted as completions, not failures.',
  );
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
    : path.join(repo, 'evidence', 'phase2', 'obligations.json');
  if (!fs.existsSync(obligationsPath)) {
    throw new Error(`Phase 2 obligations file missing at ${obligationsPath}`);
  }
  const sample = JSON.parse(fs.readFileSync(obligationsPath, 'utf8')) as Phase2SampleFile;
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

  const runDir = path.join(repo, 'evidence', 'phase2', 'run', `config-${flags.config}`);
  let resumeProgress: RuntimeProgress | null = null;
  if (fs.existsSync(runDir)) {
    if (!flags.resume) {
      throw new Error(
        `run directory already exists: ${runDir}. Remove it or pass --resume to continue.`,
      );
    }
    const file = progressFile(runDir);
    if (!fs.existsSync(file)) {
      throw new Error(
        `--resume passed but ${file} is missing. Refusing to scribble over an unknown-state run dir.`,
      );
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
      process.stderr.write(`[phase2-${flags.config}] skipping ${obligation.id}: already completed\n`);
      continue;
    }
    const obligationDir = path.join(runDir, obligation.id);
    fs.mkdirSync(obligationDir, { recursive: true });

    const t0 = Date.now();
    process.stderr.write(
      `[phase2-${flags.config}] starting ${obligation.id} (${obligation.stratum}) :: ${obligation.target}\n`,
    );

    let outcome: PerObligationOutcome;
    if (flags.config === 'a') {
      outcome = await runConfigA(obligation, obligationDir, fixtureRoot, flags.costCapUsd);
    } else {
      outcome = await runConfigB(
        obligation,
        obligationDir,
        fixtureRoot,
        patchSha,
        flags.timeBudgetMs,
        flags.costCapUsd,
      );
    }
    outcomes.push(outcome);
    completedIds.add(outcome.id);
    process.stderr.write(
      `[phase2-${flags.config}]   ${obligation.id} -> pass=${outcome.pass} ` +
        `kind=${outcome.resultKind}${outcome.resultReason ? '/' + outcome.resultReason : ''} ` +
        `yield=${outcome.counterExamplesFound} ` +
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
        `[phase2-${flags.config}] obligation ${obligation.id} errored; halting per "no defensive try/catch" policy.\n`,
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
    `[phase2-${flags.config}] done. evidence: ${path.relative(repo, runDir)}/\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[phase2-harness] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
