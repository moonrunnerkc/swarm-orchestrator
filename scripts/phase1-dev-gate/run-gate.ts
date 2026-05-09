/* eslint-disable no-console */
/**
 * Phase 1 dev-gate driver.
 *
 * Reads the locked obligation sample at
 * `evidence/phase1-dev-gate/sample-obligations.json`, runs `CodexFalsifier`
 * against each obligation against a freshly-snapshotted workspace
 * (`git archive HEAD | tar -x`), and writes per-obligation evidence under
 * `evidence/phase1-dev-gate/run-<N>/`. No mocks: real codex subprocess via
 * the production `CodexFalsifier` path. Errors from missing binary or auth
 * surface as thrown errors and stop the run; the runner does not recover.
 *
 * Per-obligation artifacts (one directory per obligation):
 *   - `request.json` — codex CLI binary, args, prompt, cwd
 *   - `codex-stdout.txt`, `codex-stderr.txt`, `codex-exit-code.txt` — raw
 *   - `result.json` — parsed `FalsifyOutcome` (result + cost)
 *   - `error.txt` — present iff the call threw, with the captured message
 *
 * Aggregate artifacts under the run directory:
 *   - `summary.tsv` — one row per obligation, machine-friendly
 *   - `summary.md` — operator-readable rendering of the same data
 *   - `runtime.json` — wall-clock total, per-obligation count, dollar total
 *
 * Invocation:
 *   node dist/scripts/phase1-dev-gate/run-gate.js [--run <N>] [--time-budget-ms <ms>]
 *
 *   --run N             Run number; produces `run-N/`. Default 1.
 *   --time-budget-ms M  Per-obligation codex time budget. Default 300000 (5 min).
 *
 * The runner refuses to overwrite an existing `run-<N>/` directory; bump
 * `--run` to start a new attempt.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CodexFalsifier,
  type CodexInvocationRequest,
  type CodexInvocationResult,
} from '../../src/falsification/adapters/codex/codex-falsifier';
import type { ObligationV1, PropertyMustHoldObligation } from '../../src/contract/types';
import type { FalsificationInput, FalsifyOutcome } from '../../src/falsification/adapters/types';

interface SampleObligation {
  id: string;
  stratum: 'A' | 'B' | 'C';
  type: 'property-must-hold';
  target: string;
  predicate: string;
}

interface SampleFile {
  obligationCount: number;
  obligations: SampleObligation[];
}

interface CliFlags {
  runNumber: number;
  timeBudgetMs: number;
}

function parseFlags(argv: readonly string[]): CliFlags {
  let runNumber = 1;
  let timeBudgetMs = 300_000;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--run requires a value');
      runNumber = Number.parseInt(next, 10);
      if (!Number.isFinite(runNumber) || runNumber < 1) {
        throw new Error(`--run must be a positive integer, got ${next}`);
      }
      i += 1;
    } else if (arg === '--time-budget-ms') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--time-budget-ms requires a value');
      timeBudgetMs = Number.parseInt(next, 10);
      if (!Number.isFinite(timeBudgetMs) || timeBudgetMs < 1000) {
        throw new Error(`--time-budget-ms must be >= 1000, got ${next}`);
      }
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node dist/scripts/phase1-dev-gate/run-gate.js [--run N] [--time-budget-ms M]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { runNumber, timeBudgetMs };
}

function repoRoot(): string {
  const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!out) throw new Error('git rev-parse --show-toplevel returned empty');
  return out;
}

function headSha(repoPath: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function snapshotHeadInto(repoPath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  // git archive HEAD | tar -x -C destDir
  const archive = execFileSync('git', ['archive', 'HEAD'], {
    cwd: repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 1024,
  });
  const tarPath = path.join(destDir, '.snapshot.tar');
  fs.writeFileSync(tarPath, archive);
  execFileSync('tar', ['-xf', tarPath, '-C', destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  fs.rmSync(tarPath, { force: true });
}

function toObligation(sample: SampleObligation): PropertyMustHoldObligation {
  return {
    type: 'property-must-hold',
    predicate: sample.predicate,
    target: sample.target,
  };
}

interface PerObligationOutcome {
  readonly id: string;
  readonly stratum: SampleObligation['stratum'];
  readonly target: string;
  readonly predicate: string;
  readonly resultKind: string;
  readonly counterExamples: number;
  readonly falsePositives: number;
  readonly dollarsSpent: number;
  readonly wallClockMs: number;
  readonly codexExitCode: number | 'errored' | 'unrun';
  readonly errorMessage: string | null;
}

async function runOneObligation(
  sample: SampleObligation,
  runDir: string,
  timeBudgetMs: number,
  patchSha: string,
  repoPath: string,
): Promise<PerObligationOutcome> {
  const obligationDir = path.join(runDir, sample.id);
  fs.mkdirSync(obligationDir, { recursive: true });

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `phase1-gate-${sample.id}-`));
  const workspaceRoot = path.join(tmpRoot, 'workspace');
  snapshotHeadInto(repoPath, workspaceRoot);

  const obligation = toObligation(sample);
  let lastInvocation: { request: CodexInvocationRequest; result: CodexInvocationResult } | null =
    null;
  const falsifier = new CodexFalsifier({
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

  let outcome: FalsifyOutcome | null = null;
  let errorMessage: string | null = null;
  try {
    outcome = await falsifier.falsify(input);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    if (lastInvocation !== null) {
      const li = lastInvocation as { request: CodexInvocationRequest; result: CodexInvocationResult };
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
      fs.writeFileSync(
        path.join(obligationDir, 'codex-exit-code.txt'),
        `${li.result.exitCode}\n`,
      );
    }
    if (errorMessage !== null) {
      fs.writeFileSync(path.join(obligationDir, 'error.txt'), errorMessage + '\n');
    }
    if (outcome !== null) {
      fs.writeFileSync(
        path.join(obligationDir, 'result.json'),
        JSON.stringify(outcome, null, 2) + '\n',
      );
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  if (outcome === null) {
    return {
      id: sample.id,
      stratum: sample.stratum,
      target: sample.target,
      predicate: sample.predicate,
      resultKind: 'errored',
      counterExamples: 0,
      falsePositives: 0,
      dollarsSpent: 0,
      wallClockMs: lastInvocation
        ? (lastInvocation as { result: CodexInvocationResult }).result.wallClockMs
        : 0,
      codexExitCode: lastInvocation
        ? (lastInvocation as { result: CodexInvocationResult }).result.exitCode
        : 'unrun',
      errorMessage,
    };
  }

  return {
    id: sample.id,
    stratum: sample.stratum,
    target: sample.target,
    predicate: sample.predicate,
    resultKind: outcome.result.kind,
    counterExamples:
      outcome.result.kind === 'counter-example-input' ? outcome.result.inputs.length : 0,
    falsePositives: outcome.cost.falsePositives,
    dollarsSpent: outcome.cost.dollarsSpent,
    wallClockMs: outcome.cost.wallClockMs,
    codexExitCode: lastInvocation
      ? (lastInvocation as { result: CodexInvocationResult }).result.exitCode
      : 'unrun',
    errorMessage: null,
  };
}

function writeSummaryTsv(outcomes: readonly PerObligationOutcome[], runDir: string): void {
  const header =
    'id\tstratum\tresultKind\tcounterExamples\tfalsePositives\tdollarsSpent\twallClockMs\tcodexExitCode\terror';
  const rows = outcomes.map((o) =>
    [
      o.id,
      o.stratum,
      o.resultKind,
      o.counterExamples,
      o.falsePositives,
      o.dollarsSpent.toFixed(6),
      o.wallClockMs,
      o.codexExitCode,
      o.errorMessage ?? '',
    ].join('\t'),
  );
  fs.writeFileSync(path.join(runDir, 'summary.tsv'), [header, ...rows, ''].join('\n'));
}

function writeSummaryMd(
  outcomes: readonly PerObligationOutcome[],
  runDir: string,
  patchSha: string,
  totalDollars: number,
  totalWallClockMs: number,
): void {
  const lines: string[] = [];
  lines.push('# Phase 1 dev gate — run summary');
  lines.push('');
  lines.push(`- Patch SHA: \`${patchSha}\``);
  lines.push(`- Obligations: ${outcomes.length}`);
  lines.push(`- Total wall-clock: ${(totalWallClockMs / 1000).toFixed(1)} s`);
  lines.push(`- Total dollars: $${totalDollars.toFixed(4)}`);
  const counterExamples = outcomes.reduce((acc, o) => acc + o.counterExamples, 0);
  const errored = outcomes.filter((o) => o.errorMessage !== null).length;
  lines.push(`- Counter-examples returned (machine-claimed): ${counterExamples}`);
  lines.push(`- Errored obligations: ${errored}`);
  lines.push('');
  lines.push('| id | stratum | result | yield | FP | $ | ms | codex_exit | error |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---|');
  for (const o of outcomes) {
    lines.push(
      `| ${o.id} | ${o.stratum} | ${o.resultKind} | ${o.counterExamples} | ${o.falsePositives} | ${o.dollarsSpent.toFixed(4)} | ${o.wallClockMs} | ${o.codexExitCode} | ${o.errorMessage ?? ''} |`,
    );
  }
  lines.push('');
  lines.push('Yield is *machine-claimed* only. Operator hand-inspection in inspection.md');
  lines.push('determines confirmed-vs-false-positive yield.');
  lines.push('');
  fs.writeFileSync(path.join(runDir, 'summary.md'), lines.join('\n'));
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const repo = repoRoot();
  const samplePath = path.join(repo, 'evidence', 'phase1-dev-gate', 'sample-obligations.json');
  if (!fs.existsSync(samplePath)) {
    throw new Error(
      `sample-obligations.json missing at ${samplePath}; runner expects the locked sample to be tracked on the branch`,
    );
  }
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8')) as SampleFile;
  if (sample.obligations.length !== sample.obligationCount) {
    throw new Error(
      `sample-obligations.json: declared count ${sample.obligationCount} does not match obligations.length ${sample.obligations.length}`,
    );
  }

  const runDir = path.join(repo, 'evidence', 'phase1-dev-gate', `run-${flags.runNumber}`);
  if (fs.existsSync(runDir)) {
    throw new Error(
      `run directory already exists: ${runDir}. Bump --run or remove the directory before retrying.`,
    );
  }
  fs.mkdirSync(runDir, { recursive: true });

  const patchSha = headSha(repo);
  fs.writeFileSync(
    path.join(runDir, 'environment.json'),
    JSON.stringify(
      {
        runNumber: flags.runNumber,
        startedAtIso: new Date().toISOString(),
        patchSha,
        repoRoot: repo,
        nodeVersion: process.version,
        platform: `${os.platform()}-${os.arch()}`,
        timeBudgetMs: flags.timeBudgetMs,
      },
      null,
      2,
    ) + '\n',
  );

  const startedAt = Date.now();
  const outcomes: PerObligationOutcome[] = [];
  for (const ob of sample.obligations) {
    const t0 = Date.now();
    process.stderr.write(
      `[phase1-gate] starting ${ob.id} (${ob.stratum}) :: ${ob.target}\n`,
    );
    const outcome = await runOneObligation(ob, runDir, flags.timeBudgetMs, patchSha, repo);
    outcomes.push(outcome);
    process.stderr.write(
      `[phase1-gate]   ${ob.id} -> ${outcome.resultKind} ` +
        `yield=${outcome.counterExamples} fp=${outcome.falsePositives} ` +
        `cost=$${outcome.dollarsSpent.toFixed(4)} ms=${Date.now() - t0}` +
        `${outcome.errorMessage ? ` err="${outcome.errorMessage}"` : ''}\n`,
    );
    if (outcome.errorMessage !== null) {
      process.stderr.write(
        `[phase1-gate] obligation ${ob.id} errored; halting per "no defensive try/catch" policy. ` +
          `See ${path.relative(repo, runDir)}/${ob.id}/error.txt\n`,
      );
      writeSummaryTsv(outcomes, runDir);
      writeSummaryMd(outcomes, runDir, patchSha, 0, Date.now() - startedAt);
      process.exit(2);
    }
  }
  const totalWallClockMs = Date.now() - startedAt;
  const totalDollars = outcomes.reduce((acc, o) => acc + o.dollarsSpent, 0);
  fs.writeFileSync(
    path.join(runDir, 'runtime.json'),
    JSON.stringify(
      {
        totalWallClockMs,
        totalDollars,
        obligationCount: outcomes.length,
        finishedAtIso: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  writeSummaryTsv(outcomes, runDir);
  writeSummaryMd(outcomes, runDir, patchSha, totalDollars, totalWallClockMs);

  process.stderr.write(
    `[phase1-gate] done. evidence: ${path.relative(repo, runDir)}/\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`[phase1-gate] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
