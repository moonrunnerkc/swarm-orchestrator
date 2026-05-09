/* eslint-disable no-console */
/**
 * Phase 1 dev-gate driver.
 *
 * Reads the locked obligation sample at
 * `evidence/phase1-dev-gate/sample-obligations.json`, runs `CodexFalsifier`
 * against each obligation against a freshly-snapshotted workspace
 * (`git archive <sha> | tar -x`), and writes per-obligation evidence under
 * `evidence/phase1-dev-gate/run-<N>/`. No mocks: real codex subprocess via
 * the production `CodexFalsifier` path. Errors from missing binary or auth
 * surface as thrown errors and stop the run; the runner does not recover.
 *
 * Snapshot SHA: defaults to `a7e5455` (v8.0.1). That SHA pre-dates the
 * `evidence/phase1-dev-gate/` subtree, so the workspace is not re-entrant
 * against its own committed evidence (the failure mode that contaminated
 * obligations A2/A3/A8/C5 in run-1-aborted/).
 *
 * Per-obligation artifacts (one directory per obligation):
 *   - `request.json` — codex CLI binary, args, prompt, cwd
 *   - `codex-stdout.txt`, `codex-stderr.txt`, `codex-exit-code.txt` — raw
 *   - `result.json` — parsed `FalsifyOutcome` (result + cost)
 *   - `error.txt` — present iff the call threw, with the captured message
 *   - `baseline-skipped.txt` — present iff the obligation was skipped by
 *     the baseline predicate check before codex was invoked
 *
 * Aggregate artifacts under the run directory:
 *   - `summary.tsv` — one row per obligation, machine-friendly
 *   - `summary.md` — operator-readable rendering of the same data
 *   - `runtime.json` — wall-clock total, per-obligation count, dollar total
 *   - `runtime-progress.json` — written after each obligation; consumed by
 *     `--resume` to skip already-completed obligations
 *
 * Invocation:
 *   node dist/scripts/phase1-dev-gate/run-gate.js [flags]
 *
 *   --run N                 Run number; produces `run-N/`. Default 1.
 *   --time-budget-ms M      Per-obligation codex time budget. Default 300000.
 *   --snapshot-sha <sha>    Git SHA to snapshot. Default a7e5455 (v8.0.1).
 *   --start-from <id>       Skip obligations until <id> is reached.
 *   --skip <id1,id2,...>    Comma-separated list of ids to skip.
 *   --resume                Read runtime-progress.json from run dir; skip
 *                           already-completed obligations. Allows re-entry
 *                           into an existing run-N/.
 *
 * Without `--resume` the runner refuses to overwrite an existing
 * `run-<N>/` directory; bump `--run` or pass `--resume` to continue.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import {
  CodexFalsifier,
  type CodexInvocationRequest,
  type CodexInvocationResult,
} from '../../src/falsification/adapters/codex/codex-falsifier';
import type { ObligationV1, PropertyMustHoldObligation } from '../../src/contract/types';
import type { FalsificationInput, FalsifyOutcome } from '../../src/falsification/adapters/types';

// Source `.env` from cwd / orchestrator install / `~/.env` so
// `OPENAI_API_KEY` reaches the codex subprocess without the operator
// having to export it manually each shell. Same logic as `src/cli.ts`,
// shared via `src/env-loader.ts`.
loadDotenv();

const DEFAULT_SNAPSHOT_SHA = 'a7e5455';

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
  snapshotSha: string;
  startFrom: string | null;
  skip: ReadonlySet<string>;
  resume: boolean;
}

function parseFlags(argv: readonly string[]): CliFlags {
  let runNumber = 1;
  let timeBudgetMs = 300_000;
  let snapshotSha = DEFAULT_SNAPSHOT_SHA;
  let startFrom: string | null = null;
  const skip = new Set<string>();
  let resume = false;
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
    } else if (arg === '--snapshot-sha') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--snapshot-sha requires a value');
      snapshotSha = next;
      i += 1;
    } else if (arg === '--start-from') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--start-from requires a value');
      startFrom = next;
      i += 1;
    } else if (arg === '--skip') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--skip requires a value');
      for (const id of next.split(',')) {
        const trimmed = id.trim();
        if (trimmed.length > 0) skip.add(trimmed);
      }
      i += 1;
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node dist/scripts/phase1-dev-gate/run-gate.js ' +
          '[--run N] [--time-budget-ms M] [--snapshot-sha SHA] ' +
          '[--start-from ID] [--skip ID1,ID2,...] [--resume]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { runNumber, timeBudgetMs, snapshotSha, startFrom, skip, resume };
}

function repoRoot(): string {
  const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!out) throw new Error('git rev-parse --show-toplevel returned empty');
  return out;
}

function resolveSha(repoPath: string, sha: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    throw new Error(
      `snapshot SHA ${sha} not found in local repo. ` +
        `Fetch or check out the v8.0.1 tag (or pass a different --snapshot-sha) before retrying.`,
      { cause: err instanceof Error ? err : new Error(String(err)) },
    );
  }
}

function snapshotShaInto(repoPath: string, sha: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  // git archive <sha> | tar -x -C destDir
  const archive = execFileSync('git', ['archive', sha], {
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
  readonly resultReason: string | null;
  readonly counterExamples: number;
  readonly falsePositives: number;
  readonly dollarsSpent: number;
  readonly dollarsBilled: number;
  readonly dollarsTokenEstimate: number;
  readonly authMethod: string;
  readonly wallClockMs: number;
  readonly codexExitCode: number | 'errored' | 'unrun' | 'skipped';
  readonly errorMessage: string | null;
}

interface RuntimeProgress {
  readonly snapshotSha: string;
  readonly startedAtIso: string;
  readonly lastCompletedId: string | null;
  readonly completedIds: readonly string[];
  readonly outcomes: readonly PerObligationOutcome[];
}

function progressFile(runDir: string): string {
  return path.join(runDir, 'runtime-progress.json');
}

function readProgressIfPresent(runDir: string): RuntimeProgress | null {
  const file = progressFile(runDir);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RuntimeProgress;
}

function writeProgress(runDir: string, progress: RuntimeProgress): void {
  const tmp = progressFile(runDir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(progress, null, 2) + '\n');
  fs.renameSync(tmp, progressFile(runDir));
}

async function runOneObligation(
  sample: SampleObligation,
  runDir: string,
  timeBudgetMs: number,
  patchSha: string,
  repoPath: string,
  snapshotSha: string,
): Promise<PerObligationOutcome> {
  const obligationDir = path.join(runDir, sample.id);
  fs.mkdirSync(obligationDir, { recursive: true });

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `phase1-gate-${sample.id}-`));
  const workspaceRoot = path.join(tmpRoot, 'workspace');
  snapshotShaInto(repoPath, snapshotSha, workspaceRoot);

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
      if (
        outcome.result.kind === 'no-falsification-found' &&
        outcome.result.reason === 'baseline-predicate-failed'
      ) {
        fs.writeFileSync(
          path.join(obligationDir, 'baseline-skipped.txt'),
          (outcome.result.detail ?? 'baseline predicate failed') + '\n',
        );
      }
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
      resultReason: null,
      counterExamples: 0,
      falsePositives: 0,
      dollarsSpent: 0,
      dollarsBilled: 0,
      dollarsTokenEstimate: 0,
      authMethod: 'unknown',
      wallClockMs: lastInvocation
        ? (lastInvocation as { result: CodexInvocationResult }).result.wallClockMs
        : 0,
      codexExitCode: lastInvocation
        ? (lastInvocation as { result: CodexInvocationResult }).result.exitCode
        : 'unrun',
      errorMessage,
    };
  }

  const reason =
    outcome.result.kind === 'no-falsification-found' ? outcome.result.reason : null;
  return {
    id: sample.id,
    stratum: sample.stratum,
    target: sample.target,
    predicate: sample.predicate,
    resultKind: outcome.result.kind,
    resultReason: reason,
    counterExamples:
      outcome.result.kind === 'counter-example-input' ? outcome.result.inputs.length : 0,
    falsePositives: outcome.cost.falsePositives,
    dollarsSpent: outcome.cost.dollarsSpent,
    dollarsBilled: outcome.cost.dollarsBilled,
    dollarsTokenEstimate: outcome.cost.dollarsTokenEstimate,
    authMethod: outcome.cost.authMethod,
    wallClockMs: outcome.cost.wallClockMs,
    codexExitCode:
      reason === 'baseline-predicate-failed'
        ? 'skipped'
        : lastInvocation
          ? (lastInvocation as { result: CodexInvocationResult }).result.exitCode
          : 'unrun',
    errorMessage: null,
  };
}

function rowResultKind(o: PerObligationOutcome): string {
  if (o.resultReason === 'baseline-predicate-failed') return 'setup-skipped';
  return o.resultKind;
}

function writeSummaryTsv(outcomes: readonly PerObligationOutcome[], runDir: string): void {
  const header =
    'id\tstratum\tresultKind\tauthMethod\tcounterExamples\tfalsePositives\tdollarsBilled\tdollarsTokenEstimate\twallClockMs\tcodexExitCode\terror';
  const rows = outcomes.map((o) =>
    [
      o.id,
      o.stratum,
      rowResultKind(o),
      o.authMethod,
      o.counterExamples,
      o.falsePositives,
      o.dollarsBilled.toFixed(6),
      o.dollarsTokenEstimate.toFixed(6),
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
  snapshotSha: string,
  totalDollarsBilled: number,
  totalDollarsTokenEstimate: number,
  totalWallClockMs: number,
): void {
  const lines: string[] = [];
  lines.push('# Phase 1 dev gate — run summary');
  lines.push('');
  lines.push(`- Patch SHA: \`${patchSha}\``);
  lines.push(`- Snapshot SHA: \`${snapshotSha}\``);
  lines.push(`- Obligations: ${outcomes.length}`);
  lines.push(`- Total wall-clock: ${(totalWallClockMs / 1000).toFixed(1)} s`);
  lines.push(`- Total dollars (billed): $${totalDollarsBilled.toFixed(4)}`);
  lines.push(`- Total dollars (token estimate): $${totalDollarsTokenEstimate.toFixed(4)}`);
  const counterExamples = outcomes.reduce((acc, o) => acc + o.counterExamples, 0);
  const errored = outcomes.filter((o) => o.errorMessage !== null).length;
  const skipped = outcomes.filter((o) => o.resultReason === 'baseline-predicate-failed').length;
  lines.push(`- Counter-examples returned (machine-claimed): ${counterExamples}`);
  lines.push(`- Errored obligations: ${errored}`);
  lines.push(`- Setup-skipped (baseline predicate failed): ${skipped}`);
  lines.push('');
  lines.push('| id | stratum | result | auth | yield | FP | $billed | $tokenEst | ms | codex_exit | error |');
  lines.push('|---|---|---|---|---:|---:|---:|---:|---:|---:|---|');
  for (const o of outcomes) {
    lines.push(
      `| ${o.id} | ${o.stratum} | ${rowResultKind(o)} | ${o.authMethod} | ${o.counterExamples} | ${o.falsePositives} | ${o.dollarsBilled.toFixed(4)} | ${o.dollarsTokenEstimate.toFixed(4)} | ${o.wallClockMs} | ${o.codexExitCode} | ${o.errorMessage ?? ''} |`,
    );
  }
  lines.push('');
  lines.push('Yield is *machine-claimed* only. Operator hand-inspection in inspection.md');
  lines.push('determines confirmed-vs-false-positive yield. Rows tagged `setup-skipped`');
  lines.push('had the baseline predicate fail against the snapshot before codex was invoked');
  lines.push('and consumed zero dollars.');
  lines.push('');
  fs.writeFileSync(path.join(runDir, 'summary.md'), lines.join('\n'));
}

function selectObligations(
  sample: SampleFile,
  flags: CliFlags,
  resumeProgress: RuntimeProgress | null,
): { toRun: SampleObligation[]; skipped: SampleObligation[] } {
  const completedFromResume = new Set<string>(resumeProgress?.completedIds ?? []);
  const toRun: SampleObligation[] = [];
  const skipped: SampleObligation[] = [];
  let started = flags.startFrom === null;
  for (const ob of sample.obligations) {
    if (!started) {
      if (ob.id === flags.startFrom) started = true;
      else {
        skipped.push(ob);
        continue;
      }
    }
    if (flags.skip.has(ob.id) || completedFromResume.has(ob.id)) {
      skipped.push(ob);
      continue;
    }
    toRun.push(ob);
  }
  return { toRun, skipped };
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

  const resolvedSha = resolveSha(repo, flags.snapshotSha);

  const runDir = path.join(repo, 'evidence', 'phase1-dev-gate', `run-${flags.runNumber}`);
  let resumeProgress: RuntimeProgress | null = null;
  if (fs.existsSync(runDir)) {
    if (!flags.resume) {
      throw new Error(
        `run directory already exists: ${runDir}. Bump --run, remove the directory, ` +
          `or pass --resume to continue from runtime-progress.json.`,
      );
    }
    resumeProgress = readProgressIfPresent(runDir);
    if (resumeProgress === null) {
      throw new Error(
        `--resume passed but ${progressFile(runDir)} is missing. Refusing to scribble over an ` +
          `unknown-state run directory.`,
      );
    }
    if (resumeProgress.snapshotSha !== resolvedSha) {
      throw new Error(
        `--resume snapshot SHA mismatch: progress file says ${resumeProgress.snapshotSha}, ` +
          `current --snapshot-sha resolves to ${resolvedSha}. Mixing snapshots within one run ` +
          `would invalidate cross-obligation comparisons.`,
      );
    }
  } else {
    fs.mkdirSync(runDir, { recursive: true });
  }

  const patchSha = resolveSha(repo, 'HEAD');
  const startedAtIso = resumeProgress?.startedAtIso ?? new Date().toISOString();
  if (!fs.existsSync(path.join(runDir, 'environment.json'))) {
    fs.writeFileSync(
      path.join(runDir, 'environment.json'),
      JSON.stringify(
        {
          runNumber: flags.runNumber,
          startedAtIso,
          patchSha,
          snapshotSha: resolvedSha,
          repoRoot: repo,
          nodeVersion: process.version,
          platform: `${os.platform()}-${os.arch()}`,
          timeBudgetMs: flags.timeBudgetMs,
        },
        null,
        2,
      ) + '\n',
    );
  }

  const { toRun, skipped } = selectObligations(sample, flags, resumeProgress);
  for (const ob of skipped) {
    process.stderr.write(`[phase1-gate] skipping ${ob.id}: already completed or filtered\n`);
  }

  const startedAt = Date.now();
  const outcomes: PerObligationOutcome[] = [...(resumeProgress?.outcomes ?? [])];
  const completedIds = new Set<string>(outcomes.map((o) => o.id));

  for (const ob of toRun) {
    const t0 = Date.now();
    process.stderr.write(
      `[phase1-gate] starting ${ob.id} (${ob.stratum}) :: ${ob.target}\n`,
    );
    const outcome = await runOneObligation(ob, runDir, flags.timeBudgetMs, patchSha, repo, resolvedSha);
    outcomes.push(outcome);
    completedIds.add(outcome.id);
    process.stderr.write(
      `[phase1-gate]   ${ob.id} -> ${rowResultKind(outcome)} ` +
        `yield=${outcome.counterExamples} fp=${outcome.falsePositives} ` +
        `billed=$${outcome.dollarsBilled.toFixed(4)} ` +
        `tokenEst=$${outcome.dollarsTokenEstimate.toFixed(4)} ` +
        `ms=${Date.now() - t0}` +
        `${outcome.errorMessage ? ` err="${outcome.errorMessage}"` : ''}\n`,
    );

    writeProgress(runDir, {
      snapshotSha: resolvedSha,
      startedAtIso,
      lastCompletedId: outcome.id,
      completedIds: [...completedIds],
      outcomes,
    });

    if (outcome.errorMessage !== null) {
      process.stderr.write(
        `[phase1-gate] obligation ${ob.id} errored; halting per "no defensive try/catch" policy. ` +
          `See ${path.relative(repo, runDir)}/${ob.id}/error.txt\n`,
      );
      writeSummaryTsv(outcomes, runDir);
      writeSummaryMd(outcomes, runDir, patchSha, resolvedSha, 0, 0, Date.now() - startedAt);
      process.exit(2);
    }
  }
  const totalWallClockMs = Date.now() - startedAt;
  const totalDollarsBilled = outcomes.reduce((acc, o) => acc + o.dollarsBilled, 0);
  const totalDollarsTokenEstimate = outcomes.reduce((acc, o) => acc + o.dollarsTokenEstimate, 0);
  fs.writeFileSync(
    path.join(runDir, 'runtime.json'),
    JSON.stringify(
      {
        totalWallClockMs,
        totalDollarsBilled,
        totalDollarsTokenEstimate,
        obligationCount: outcomes.length,
        finishedAtIso: new Date().toISOString(),
        snapshotSha: resolvedSha,
      },
      null,
      2,
    ) + '\n',
  );
  writeSummaryTsv(outcomes, runDir);
  writeSummaryMd(
    outcomes,
    runDir,
    patchSha,
    resolvedSha,
    totalDollarsBilled,
    totalDollarsTokenEstimate,
    totalWallClockMs,
  );

  process.stderr.write(
    `[phase1-gate] done. evidence: ${path.relative(repo, runDir)}/\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`[phase1-gate] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
