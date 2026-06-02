// Diff-scoped mutation testing. The question this answers is sharper than
// "are there tests": does the test suite actually constrain the behavior of
// the lines this PR changed? A mutation that survives on a changed line is a
// line the tests run past without pinning down. Scoping Stryker's mutate set
// to the diff keeps the run bounded and the signal local to the change.
//
// The live runner (`runMutationCheck`) installs Stryker into the provisioned
// workspace and shells out; the pure helpers (scope, config, report parsing,
// proof correlation) carry the logic and are unit-tested without a run.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';
import type { ChangedLineRanges, LineRange } from '../cheat-detector/diff-walker';
import { lineInRanges } from '../cheat-detector/diff-walker';
import { execEnv } from './exec-env';
import { addDevTools, type PackageManager, type TestRunner } from './sandbox';

const log = getLogger('audit:execution-grounded:mutation');

export type MutationStatus =
  | 'Killed'
  | 'Survived'
  | 'NoCoverage'
  | 'CompileError'
  | 'RuntimeError'
  | 'Timeout'
  | 'Ignored'
  | 'Pending';

export interface MutationResult {
  file: string;
  line: number;
  mutator: string;
  killed: boolean;
  /** Raw Stryker status, kept so a downstream caller can tell a Survived
   *  mutant (test runs the line, does not constrain it) from a NoCoverage
   *  one (no test runs the line at all). */
  status: MutationStatus;
  /** For non-killed mutants, the status as a human-readable reason. */
  survivedReason?: string;
}

/** Stryker test runners we can drive, mapped to their plugin package. ava and
 *  node-test have no Stryker adapter, so a repo on those is unmutable here. */
const ADAPTER: Partial<Record<TestRunner, string>> = {
  jest: '@stryker-mutator/jest-runner',
  vitest: '@stryker-mutator/vitest-runner',
  mocha: '@stryker-mutator/mocha-runner',
};

// Keep a single PR's run bounded. The diff scope already holds mutant counts
// down; this is the backstop for a PR that rewrites a large file. When the
// changed-line budget is exceeded the extra lines are dropped (logged, never
// silently), and the run covers the first N changed lines.
const MAX_MUTATE_LINES = 200;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

export interface MutateScope {
  patterns: string[];
  includedLines: number;
  droppedLines: number;
}

// fast-glob (which Stryker uses to resolve `mutate`) treats these as glob
// metacharacters. A real path containing them (a Next.js dynamic route like
// `[trpc].ts`) is rejected when combined with a line range unless escaped.
const GLOB_META = /[[\]{}()!*?+@|]/g;

function escapeGlobPath(file: string): string {
  return file.replace(GLOB_META, '\\$&');
}

/** Build Stryker `mutate` patterns (`file:start-end`) from changed-line
 *  ranges, capped at `maxLines` total changed lines. File paths are
 *  glob-escaped so dynamic-route names do not break the run. */
export function buildMutateScope(changed: ChangedLineRanges, maxLines = MAX_MUTATE_LINES): MutateScope {
  const patterns: string[] = [];
  let included = 0;
  let dropped = 0;
  for (const [file, ranges] of Object.entries(changed)) {
    const escaped = escapeGlobPath(file);
    for (const r of ranges) {
      const span = r.end - r.start + 1;
      if (included >= maxLines) {
        dropped += span;
        continue;
      }
      const room = maxLines - included;
      const end = span <= room ? r.end : r.start + room - 1;
      patterns.push(`${escaped}:${r.start}-${end}`);
      included += end - r.start + 1;
      if (end < r.end) dropped += r.end - end;
    }
  }
  return { patterns, includedLines: included, droppedLines: dropped };
}

export interface StrykerConfig {
  testRunner: string;
  /** Named explicitly (not the default `@stryker-mutator/*` glob) so the
   *  plugin resolves by require from the package dir up to the hoisted root,
   *  which the glob scan misses under pnpm's strict node_modules. */
  plugins: string[];
  reporters: string[];
  mutate: string[];
  concurrency: number;
  coverageAnalysis: string;
  disableTypeChecks: boolean;
  ignoreStatic: boolean;
  timeoutMS: number;
  thresholds: { high: number; low: number; break: null };
  tempDirName: string;
}

export function defaultConcurrency(): number {
  return Math.max(1, os.cpus().length - 1);
}

/** Generate a per-PR Stryker config scoped to the changed lines. */
export function generateStrykerConfig(opts: {
  testRunner: 'jest' | 'vitest' | 'mocha';
  mutate: string[];
  concurrency?: number;
}): StrykerConfig {
  return {
    testRunner: opts.testRunner,
    plugins: [ADAPTER[opts.testRunner]!],
    reporters: ['json'],
    mutate: opts.mutate,
    concurrency: opts.concurrency ?? defaultConcurrency(),
    coverageAnalysis: 'perTest',
    // Mutated code can violate the type checker; we are testing runtime
    // behavior, not types, so do not let tsc fail the run.
    disableTypeChecks: true,
    ignoreStatic: true,
    timeoutMS: 15_000,
    thresholds: { high: 80, low: 60, break: null },
    tempDirName: '.stryker-tmp',
  };
}

interface RawStrykerReport {
  files?: Record<string, { mutants?: Array<{ mutatorName?: string; status?: string; location?: { start?: { line?: number } } }> }>;
}

/**
 * Parse a Stryker mutation.json report into MutationResults, restricted to
 * the changed lines (Stryker can mutate a neighboring line when a range
 * brushes a statement). Killed counts Timeout too: a mutant that hangs the
 * suite was caught by the tests, just via a timeout rather than an assertion.
 */
export function parseStrykerReport(report: unknown, changed: ChangedLineRanges): MutationResult[] {
  const r = report as RawStrykerReport;
  const out: MutationResult[] = [];
  if (r.files === undefined) return out;
  for (const [file, fileResult] of Object.entries(r.files)) {
    const ranges: LineRange[] | undefined = changed[file];
    for (const m of fileResult.mutants ?? []) {
      const line = m.location?.start?.line;
      if (line === undefined) continue;
      if (ranges !== undefined && !lineInRanges(line, ranges)) continue;
      const status = (m.status ?? 'Pending') as MutationStatus;
      const killed = status === 'Killed' || status === 'Timeout';
      const result: MutationResult = {
        file,
        line,
        mutator: m.mutatorName ?? 'unknown',
        killed,
        status,
      };
      if (!killed) result.survivedReason = status;
      out.push(result);
    }
  }
  return out;
}

export interface MutationSummary {
  total: number;
  killed: number;
  survived: number;
  noCoverage: number;
  errored: number;
}

export function summarizeMutations(results: MutationResult[]): MutationSummary {
  const s: MutationSummary = { total: results.length, killed: 0, survived: 0, noCoverage: 0, errored: 0 };
  for (const m of results) {
    if (m.killed) s.killed += 1;
    else if (m.status === 'Survived') s.survived += 1;
    else if (m.status === 'NoCoverage') s.noCoverage += 1;
    else s.errored += 1;
  }
  return s;
}

export interface ProofCorrelation {
  /** Surviving (or uncovered) mutants on lines the revert/hotfix later
   *  changed. These are the load-bearing catches: the tests did not
   *  constrain a line that proved to be wrong. */
  highConfidenceCatches: MutationResult[];
  /** Surviving/uncovered mutants elsewhere in the change. */
  otherSurvivors: MutationResult[];
}

/**
 * Split surviving mutants by whether they land on a line the proof (the
 * revert or hotfix) later changed. A survivor on a proof line is the
 * strongest signal this layer produces: the suite ran past a line that was
 * subsequently found to be the defect.
 */
export function correlateMutationsWithProof(
  results: MutationResult[],
  proofChangedLines: ChangedLineRanges,
): ProofCorrelation {
  const survivors = results.filter((m) => !m.killed && (m.status === 'Survived' || m.status === 'NoCoverage'));
  const high: MutationResult[] = [];
  const other: MutationResult[] = [];
  for (const m of survivors) {
    if (lineInRanges(m.line, proofChangedLines[m.file])) high.push(m);
    else other.push(m);
  }
  return { highConfidenceCatches: high, otherSurvivors: other };
}

export interface MutationRunOptions {
  workspacePath: string;
  changedLines: ChangedLineRanges;
  testRunner: TestRunner | null;
  /** Package manager of the workspace, used to add Stryker correctly. */
  packageManager?: PackageManager;
  /** Total wall-clock budget for install + run. Defaults to 30 minutes. */
  timeoutMs?: number;
  /** Directory to copy the raw Stryker report into for evidence. */
  evidenceDir?: string;
  /** Shared package cache so the Stryker install is a cache hit after the
   *  first PR in a run. */
  cacheDir?: string;
  /** Where to install Stryker and resolve its binary. Defaults to
   *  workspacePath; for a monorepo package, pass the workspace root so the
   *  install lands in the hoisted node_modules instead of fighting the
   *  workspace symlink layout. The run still uses workspacePath as cwd. */
  installDir?: string;
}

export interface MutationRunOutcome {
  ran: boolean;
  results: MutationResult[];
  summary: MutationSummary;
  scope: MutateScope;
  rawReportPath?: string;
  skipReason?: string;
}

function strykerReportPath(workspacePath: string): string {
  return path.join(workspacePath, 'reports', 'mutation', 'mutation.json');
}

/** Pull the most diagnostic line out of a tool's stderr for a skip reason:
 *  prefer a line naming an error/cause, else the last non-empty line (which
 *  is usually just the Node version banner, so the error line is better). */
function meaningfulErrorLine(stderr: string): string | undefined {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^at\s/.test(l) && !/^Node\.js v/.test(l));
  const named = lines.find((l) => /error|cannot|could not|missing|not found|unable|failed/i.test(l));
  return (named ?? lines[lines.length - 1])?.slice(0, 240);
}

/**
 * Run diff-scoped mutation testing in a provisioned workspace. Installs
 * Stryker plus the matching runner adapter into the workspace, writes a
 * scoped config, runs, and parses the report. Returns `ran: false` with a
 * skipReason when the runner is unsupported or there is nothing to mutate;
 * throws SwarmError only on an unexpected failure the caller should see.
 */
export function runMutationCheck(opts: MutationRunOptions): MutationRunOutcome {
  const { workspacePath, changedLines, testRunner } = opts;
  const scope = buildMutateScope(changedLines);
  const empty: MutationSummary = { total: 0, killed: 0, survived: 0, noCoverage: 0, errored: 0 };

  if (testRunner === null || ADAPTER[testRunner] === undefined) {
    return { ran: false, results: [], summary: empty, scope, skipReason: `unsupported test runner: ${testRunner ?? 'none'}` };
  }
  if (scope.patterns.length === 0) {
    return { ran: false, results: [], summary: empty, scope, skipReason: 'no mutable changed lines' };
  }
  if (scope.droppedLines > 0) {
    log.warn(`mutate scope capped: covering ${scope.includedLines} changed lines, dropped ${scope.droppedLines}`);
  }

  const adapter = ADAPTER[testRunner]!;
  const runner = testRunner as 'jest' | 'vitest' | 'mocha';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const installDir = opts.installDir ?? workspacePath;

  // Stryker resolves its runner plugin from the project under test, so it has
  // to be added to the workspace with the workspace's own package manager
  // (npm install into a pnpm/yarn root fails on the workspace: protocol).
  try {
    addDevTools(opts.packageManager ?? 'npm', installDir, [`@stryker-mutator/core@9`, `${adapter}@9`], {
      timeoutMs: Math.min(INSTALL_TIMEOUT_MS, deadline - Date.now()),
      ...(opts.cacheDir !== undefined ? { cacheDir: opts.cacheDir } : {}),
    });
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr).slice(-1500) : '';
    return {
      ran: false,
      results: [],
      summary: empty,
      scope,
      skipReason: `Stryker install failed for ${runner}: ${stderr.trim().split('\n').slice(-1)[0] ?? String(err)}`,
    };
  }

  const config = generateStrykerConfig({ testRunner: runner, mutate: scope.patterns });
  const configPath = path.join(workspacePath, 'stryker.swarm.conf.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  try {
    // Invoke the Stryker bin directly rather than via `node <path>`: under
    // pnpm the .bin entry is a shell shim, not a JS file. Its shebang picks up
    // node from PATH, which execEnv has pinned to the chosen Node.
    execFileSync(path.join(installDir, 'node_modules', '.bin', 'stryker'), ['run', configPath], {
      cwd: workspacePath,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: Math.max(1, deadline - Date.now()),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: execEnv(opts.cacheDir),
    });
  } catch (err) {
    // Stryker exits non-zero on a run error, but it may still have written a
    // partial report. Fall through to read it; only skip if there is none.
    const signal = err instanceof Error && 'signal' in err ? (err as { signal: unknown }).signal : undefined;
    if (signal === 'SIGTERM') {
      return { ran: false, results: [], summary: empty, scope, skipReason: `mutation run exceeded the ${Math.round(timeoutMs / 1000)}s budget` };
    }
    if (!fs.existsSync(strykerReportPath(workspacePath))) {
      const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
      return { ran: false, results: [], summary: empty, scope, skipReason: `Stryker run failed: ${meaningfulErrorLine(stderr) ?? String(err)}` };
    }
    log.warn('Stryker exited non-zero but a report was written; parsing it');
  }

  const reportPath = strykerReportPath(workspacePath);
  if (!fs.existsSync(reportPath)) {
    return { ran: false, results: [], summary: empty, scope, skipReason: 'Stryker produced no JSON report' };
  }
  let report: unknown;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (err) {
    throw new SwarmError('Stryker mutation.json was not valid JSON', 'mutation-report-unparseable', {
      remediation: 'Inspect the report at ' + reportPath,
      cause: err,
    });
  }
  const results = parseStrykerReport(report, changedLines);
  const summary = summarizeMutations(results);

  let rawReportPath: string | undefined;
  if (opts.evidenceDir !== undefined) {
    fs.mkdirSync(opts.evidenceDir, { recursive: true });
    rawReportPath = path.join(opts.evidenceDir, 'mutation.json');
    fs.copyFileSync(reportPath, rawReportPath);
  }

  const outcome: MutationRunOutcome = { ran: true, results, summary, scope };
  if (rawReportPath !== undefined) outcome.rawReportPath = rawReportPath;
  return outcome;
}
