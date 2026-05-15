/* eslint-disable no-console */
/**
 * Phase 3 paired-run harness.
 *
 * Reads the locked Phase 3 obligation set at
 * `evidence/phase3/obligations.json` and runs one of two configs across
 * the 20 obligations sequentially. Per-obligation evidence lives under
 * `evidence/phase3/run/<config>/<id>/`.
 *
 * Configs:
 *   - `b`  Producer + Codex falsifier (existing v8.0.1 default; Phase 2's
 *          shipped configuration). Codex's strategy targets
 *          property-must-hold and is not registered against the Phase 3
 *          obligation types, so on every Phase 3 obligation the dispatcher
 *          finds zero matching adapters; the run records that the
 *          producer-only path passes (predicate-style: the AST verifier
 *          says the obligation is satisfied against the bare fixture)
 *          with $0 LLM cost.
 *   - `bp` (Config B') Producer + Codex + Copilot. Same as B except the
 *          Copilot falsifier is registered. For every Phase 3 obligation
 *          (all import-graph or function-signature) the dispatcher routes
 *          to Copilot; Codex is offered the obligation but returns
 *          strategy-not-applicable.
 *
 * Per-obligation artifacts (one directory per obligation per config):
 *   - `result.json`        the FalsifyOutcome from the Copilot call (B only)
 *                          or a synthesized producer-only outcome (B').
 *   - `cost.json`          { dollarsBilled, dollarsTokenEstimate, wallClockMs,
 *                            llmCalls, costCapHit }.
 *   - `stdout.log`         baseline-verifier output + copilot stdout/stderr
 *                          (B' only).
 *   - `request.json`       captured copilot prompt + flag set (B' only).
 *   - `copilot-stdout.txt` raw stdout (B' only).
 *   - `copilot-stderr.txt` raw stderr (B' only).
 *   - `error.txt`          any thrown error message (env discards land here).
 *
 * Aggregate artifacts under each run directory:
 *   - `summary.md`         operator-readable rendering, schema parallel to Phase 2.
 *   - `summary.tsv`        one row per obligation, machine-friendly.
 *   - `runtime.json`       wall-clock, cost, LLM-call totals.
 *   - `environment.json`   config, fixture path/hash, patch SHA, node version.
 *   - `runtime-progress.json` resume state.
 *
 * Invocation:
 *   node dist/scripts/phase3/run-harness.js --config <b|bp> [flags]
 *
 *   --config <b|bp>          required.
 *   --time-budget-ms M       per-obligation wall-clock. Default 300000.
 *   --cost-cap-usd N         per-obligation hard cap. Default depends on
 *                            config (b: 0.01, bp: 0.65).
 *   --fixture-root <path>    override fixture location.
 *   --obligations <path>     override the obligations file.
 *   --resume                 re-enter an existing run dir; skip obligations
 *                            already recorded in runtime-progress.json.
 *   --copilot-binary <path>  override copilot binary (default `copilot`).
 *
 * Without --resume the harness refuses to overwrite an existing run dir.
 */

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { CliFalsifier, type CliInvocationRequest, type CliInvocationResult } from '../../src/falsification/adapters/cli-falsifier';
import { copilotProfile } from '../../src/falsification/adapters/profiles/copilot';
import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
  ObligationV1,
} from '../../src/contract/types';
import type { FalsificationInput, FalsifyOutcome } from '../../src/falsification/adapters/types';
import { verifyObligation } from '../../src/verification/run-verifier';

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

type ConfigName = 'b' | 'bp';

interface CliFlags {
  readonly config: ConfigName;
  readonly timeBudgetMs: number;
  readonly costCapUsd: number;
  readonly fixtureRootOverride: string | null;
  readonly obligationsPathOverride: string | null;
  readonly resume: boolean;
  readonly copilotBinary: string | null;
}

const DEFAULT_TIME_BUDGET_MS = 300_000;
const DEFAULT_COST_CAP_B_USD = 0.01;
const DEFAULT_COST_CAP_BP_USD = 0.65;

function parseFlags(argv: readonly string[]): CliFlags {
  let config: ConfigName | null = null;
  let timeBudgetMs = DEFAULT_TIME_BUDGET_MS;
  let costCapUsd: number | null = null;
  let fixtureRootOverride: string | null = null;
  let obligationsPathOverride: string | null = null;
  let resume = false;
  let copilotBinary: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      const next = argv[i + 1];
      if (next !== 'b' && next !== 'bp') {
        throw new Error(`--config requires value 'b' or 'bp', got ${next}`);
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
    } else if (arg === '--copilot-binary') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--copilot-binary requires a value');
      copilotBinary = next;
      i += 1;
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node dist/scripts/phase3/run-harness.js --config <b|bp> ' +
          '[--time-budget-ms M] [--cost-cap-usd N] [--fixture-root PATH] ' +
          '[--obligations PATH] [--copilot-binary PATH] [--resume]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (config === null) throw new Error('--config <b|bp> is required');
  const resolvedCap =
    costCapUsd !== null ? costCapUsd : config === 'b' ? DEFAULT_COST_CAP_B_USD : DEFAULT_COST_CAP_BP_USD;
  return {
    config,
    timeBudgetMs,
    costCapUsd: resolvedCap,
    fixtureRootOverride,
    obligationsPathOverride,
    resume,
    copilotBinary,
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
      throw new Error(
        `obligation ${sample.id} missing constraint/scope for import-graph-must-satisfy`,
      );
    }
    return {
      type: 'import-graph-must-satisfy',
      constraint: sample.constraint,
      scope: sample.scope,
    };
  }
  if (sample.file === undefined || sample.name === undefined || sample.signature === undefined) {
    throw new Error(
      `obligation ${sample.id} missing file/name/signature for function-must-have-signature`,
    );
  }
  return {
    type: 'function-must-have-signature',
    file: sample.file,
    name: sample.name,
    signature: sample.signature,
  };
}

interface PerObligationOutcome {
  readonly id: string;
  readonly stratum: 'I' | 'F';
  readonly type: string;
  /**
   * `pass = true` iff the system returns no falsification (i.e. the
   * obligation is satisfied and no adapter falsified it).
   */
  readonly pass: boolean;
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

async function runConfigB(
  sample: Phase3Obligation,
  obligationDir: string,
  fixtureRoot: string,
  costCapUsd: number,
): Promise<PerObligationOutcome> {
  // Config B = producer + Codex. Neither matches the Phase 3 obligation
  // types (Codex handles property-must-hold). So the dispatcher returns
  // an empty adapter set; the producer-side AST verifier runs against the
  // bare fixture and the obligation is satisfied by construction. This
  // is the "no falsifier catches anything new beyond the producer" branch
  // we measure B' against.
  const obligation = toObligation(sample);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `phase3-B-${sample.id}-`));
  const workspaceRoot = path.join(tmpRoot, 'workspace');
  copyFixtureInto(fixtureRoot, workspaceRoot);
  const t0 = Date.now();
  const verdict = verifyObligation(obligation as ObligationV1, { repoRoot: workspaceRoot });
  const wallClockMs = Date.now() - t0;
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  const result = {
    config: 'b',
    obligationId: sample.id,
    kind: verdict.satisfied ? 'producer-pass' : 'producer-fail',
    verifierDetail: verdict.detail,
    verifierWallClockMs: wallClockMs,
  };
  fs.writeFileSync(path.join(obligationDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(obligationDir, 'stdout.log'), verdict.detail);
  const cost = {
    dollarsBilled: 0,
    dollarsTokenEstimate: 0,
    wallClockMs,
    llmCalls: 0,
    costCapUsd,
    costCapHit: false,
  };
  fs.writeFileSync(path.join(obligationDir, 'cost.json'), JSON.stringify(cost, null, 2) + '\n');

  return {
    id: sample.id,
    stratum: sample.stratum,
    type: sample.type,
    pass: verdict.satisfied,
    resultKind: result.kind,
    resultReason: null,
    counterExamplesFound: 0,
    falsePositives: 0,
    dollarsBilled: 0,
    dollarsTokenEstimate: 0,
    authMethod: 'none',
    llmCalls: 0,
    wallClockMs,
    costCapUsd,
    costCapHit: false,
    errorMessage: null,
  };
}

async function runConfigBPrime(
  sample: Phase3Obligation,
  obligationDir: string,
  fixtureRoot: string,
  patchSha: string,
  timeBudgetMs: number,
  costCapUsd: number,
  copilotBinary: string | null,
): Promise<PerObligationOutcome> {
  const obligation = toObligation(sample);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `phase3-Bp-${sample.id}-`));
  const workspaceRoot = path.join(tmpRoot, 'workspace');
  copyFixtureInto(fixtureRoot, workspaceRoot);

  let lastInvocation: { request: CliInvocationRequest; result: CliInvocationResult } | null =
    null;
  const falsifier = new CliFalsifier(copilotProfile, {
    ...(copilotBinary !== null ? { binaryPath: copilotBinary } : {}),
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
  let baselineDetail = '';
  try {
    const baseline = verifyObligation(obligation as ObligationV1, { repoRoot: workspaceRoot });
    baselineDetail = baseline.detail;
    outcome = await falsifier.falsify(input);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    if (lastInvocation !== null) {
      const li = lastInvocation as {
        request: CliInvocationRequest;
        result: CliInvocationResult;
      };
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
      fs.writeFileSync(path.join(obligationDir, 'copilot-stdout.txt'), li.result.stdout);
      fs.writeFileSync(path.join(obligationDir, 'copilot-stderr.txt'), li.result.stderr);
      fs.writeFileSync(path.join(obligationDir, 'copilot-exit-code.txt'), `${li.result.exitCode}\n`);
    }
    if (errorMessage !== null) {
      fs.writeFileSync(path.join(obligationDir, 'error.txt'), errorMessage + '\n');
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  const totalWallClockMs = Date.now() - t0;

  if (outcome === null) {
    const stdoutLog = `--- baseline ---\n${baselineDetail}\n--- error ---\n${errorMessage ?? ''}\n`;
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
      type: sample.type,
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
  const copilotStdoutTxt =
    lastInvocation !== null
      ? (lastInvocation as { result: CliInvocationResult }).result.stdout
      : '';
  const copilotStderrTxt =
    lastInvocation !== null
      ? (lastInvocation as { result: CliInvocationResult }).result.stderr
      : '';
  fs.writeFileSync(
    path.join(obligationDir, 'stdout.log'),
    `--- baseline ---\n${baselineDetail}\n--- copilot stdout ---\n${copilotStdoutTxt}\n--- copilot stderr ---\n${copilotStderrTxt}\n`,
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
    type: sample.type,
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

function writeSummaryTsv(outcomes: readonly PerObligationOutcome[], runDir: string): void {
  const header =
    'id\tstratum\ttype\tpass\tresultKind\tresultReason\tcounterExamples\tfalsePositives\tdollarsBilled\tdollarsTokenEstimate\tllmCalls\twallClockMs\tcostCapHit\terror';
  const rows = outcomes.map((o) =>
    [
      o.id,
      o.stratum,
      o.type,
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
  const label = config === 'b' ? "B (producer + Codex)" : "B' (producer + Codex + Copilot)";
  lines.push(`# Phase 3 run summary (config ${config.toUpperCase()} — ${label})`);
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
  lines.push('| id | stratum | type | pass | result | yield | FP | $billed | $tokenEst | calls | ms | cap | error |');
  lines.push('|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|');
  for (const o of outcomes) {
    lines.push(
      `| ${o.id} | ${o.stratum} | ${o.type} | ${o.pass ? 'yes' : 'no'} | ${o.resultKind}${o.resultReason ? '/' + o.resultReason : ''} | ${o.counterExamplesFound} | ${o.falsePositives} | ${o.dollarsBilled.toFixed(4)} | ${o.dollarsTokenEstimate.toFixed(4)} | ${o.llmCalls} | ${o.wallClockMs} | ${o.costCapHit ? 'HIT' : ''} | ${o.errorMessage ?? ''} |`,
    );
  }
  lines.push('');
  lines.push(
    `Pass = system returns no falsification. For config B (producer + Codex), Codex does not handle Phase 3 obligation types and does not run; pass therefore reflects only whether the bare fixture verifies. For config B' (producer + Codex + Copilot), Copilot's adversarial perturbations decide.`,
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
    : path.join(repo, 'evidence', 'phase3', 'obligations.json');
  if (!fs.existsSync(obligationsPath)) {
    throw new Error(`Phase 3 obligations file missing at ${obligationsPath}`);
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

  const runDir = path.join(repo, 'evidence', 'phase3', 'run', `config-${flags.config}`);
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
          copilotBinary: flags.copilotBinary ?? 'copilot',
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
      process.stderr.write(`[phase3-${flags.config}] skipping ${obligation.id}: already completed\n`);
      continue;
    }
    const obligationDir = path.join(runDir, obligation.id);
    fs.mkdirSync(obligationDir, { recursive: true });

    const t0 = Date.now();
    process.stderr.write(
      `[phase3-${flags.config}] starting ${obligation.id} (${obligation.stratum}/${obligation.type})\n`,
    );

    let outcome: PerObligationOutcome;
    if (flags.config === 'b') {
      outcome = await runConfigB(obligation, obligationDir, fixtureRoot, flags.costCapUsd);
    } else {
      outcome = await runConfigBPrime(
        obligation,
        obligationDir,
        fixtureRoot,
        patchSha,
        flags.timeBudgetMs,
        flags.costCapUsd,
        flags.copilotBinary,
      );
    }
    outcomes.push(outcome);
    completedIds.add(outcome.id);
    process.stderr.write(
      `[phase3-${flags.config}]   ${obligation.id} -> pass=${outcome.pass} ` +
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
        `[phase3-${flags.config}] obligation ${obligation.id} errored; halting per "no defensive try/catch" policy.\n`,
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
    `[phase3-${flags.config}] done. evidence: ${path.relative(repo, runDir)}/\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[phase3-harness] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
