// Coverage on the lines a PR changed. A changed line that no test executes is
// a near-certain blind spot: a mutation there could not be killed by any test
// (so a surviving mutation on it is uninformative on its own), but the
// uncovered changed line is itself a real signal, and it sharpens the
// mutation result on covered lines (tests run the line but do not constrain
// it). This runs the post-PR suite under coverage, parses the Istanbul
// coverage-final.json, and reports per changed line whether a test reached it.

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../logger';
import type { ChangedLineRanges } from '../cheat-detector/diff-walker';
import type { DockerContext } from './docker-runner';
import { computeEgCacheKey, egCacheEnabled, readEgCache, writeEgCache, type EgCacheContext } from './eg-cache';
import { execBin, execEnv, execFileGuarded, isGuardedTimeout } from './exec-env';
import { addDevTools, type PackageManager, type TestRunner } from './sandbox';

const log = getLogger('audit:execution-grounded:coverage');

export interface CoverageDelta {
  file: string;
  line: number;
  /** Always true here: every line reported is one the PR added or modified. */
  addedOrModified: boolean;
  /** Did the post-PR test suite execute this line at least once. */
  coveredAfter: boolean;
}

/** Per file, the executable lines the instrumenter saw and the subset a test
 *  actually hit. A changed line is "uncovered" only when it is instrumented
 *  (real code) but absent from `covered`; non-code changed lines (blank,
 *  comment) are never instrumented and never flagged. */
export interface FileCoverage {
  instrumented: Set<number>;
  covered: Set<number>;
}
export type CoverageMap = Map<string, FileCoverage>;

interface IstanbulStatementMap {
  [id: string]: { start: { line?: number }; end: { line?: number } };
}
interface IstanbulFileEntry {
  path?: string;
  statementMap?: IstanbulStatementMap;
  s?: Record<string, number>;
}

/**
 * Parse an Istanbul coverage-final.json into a CoverageMap keyed by
 * workspace-relative path. Every line spanned by a statement is instrumented;
 * a line is covered when any statement touching it has a non-zero hit count.
 */
export function parseIstanbulCoverage(report: unknown, workspacePath: string): CoverageMap {
  const map: CoverageMap = new Map();
  if (report === null || typeof report !== 'object') return map;
  for (const [absPath, rawEntry] of Object.entries(report as Record<string, unknown>)) {
    const entry = rawEntry as IstanbulFileEntry;
    const filePath = entry.path ?? absPath;
    const rel = path.isAbsolute(filePath) ? path.relative(workspacePath, filePath) : filePath;
    const normalized = rel.split(path.sep).join('/');
    const fileCov: FileCoverage = { instrumented: new Set(), covered: new Set() };
    const stmtMap = entry.statementMap ?? {};
    const hits = entry.s ?? {};
    for (const [id, loc] of Object.entries(stmtMap)) {
      const startLine = loc.start?.line;
      const endLine = loc.end?.line ?? startLine;
      if (startLine === undefined) continue;
      const hit = (hits[id] ?? 0) > 0;
      for (let ln = startLine; ln <= (endLine ?? startLine); ln += 1) {
        fileCov.instrumented.add(ln);
        if (hit) fileCov.covered.add(ln);
      }
    }
    map.set(normalized, fileCov);
  }
  return map;
}

/**
 * Project a CoverageMap onto the changed lines. Only instrumented changed
 * lines are reported, so blank/comment/non-executable changes are excluded.
 */
export function coverageDeltaForChanges(coverage: CoverageMap, changed: ChangedLineRanges): CoverageDelta[] {
  const out: CoverageDelta[] = [];
  for (const [file, ranges] of Object.entries(changed)) {
    const fileCov = coverage.get(file);
    if (fileCov === undefined) continue;
    for (const range of ranges) {
      for (let line = range.start; line <= range.end; line += 1) {
        if (!fileCov.instrumented.has(line)) continue;
        out.push({ file, line, addedOrModified: true, coveredAfter: fileCov.covered.has(line) });
      }
    }
  }
  return out;
}

/** True when the line is instrumented and executed. Used to sharpen a
 *  surviving-mutation finding: a survivor on a covered line is the higher
 *  signal (the test runs the line but does not constrain it). */
export function isLineCovered(coverage: CoverageMap, file: string, line: number): boolean {
  const fileCov = coverage.get(file);
  return fileCov !== undefined && fileCov.covered.has(line);
}

/** Changed lines that are instrumented but not covered by any test. */
export function uncoveredChangedLines(deltas: CoverageDelta[]): CoverageDelta[] {
  return deltas.filter((d) => !d.coveredAfter);
}

interface CoverageCommand {
  cmd: string;
  args: string[];
  /** Extra package to install into the workspace for coverage support. */
  install?: string;
}

function coverageCommand(runner: TestRunner): CoverageCommand | null {
  switch (runner) {
    case 'jest':
      // Jest instruments with babel/istanbul out of the box.
      return { cmd: 'npx', args: ['jest', '--coverage', '--coverageReporters', 'json', '--coverageDirectory', 'coverage'] };
    case 'vitest':
      return {
        cmd: 'npx',
        // --browser.enabled=false forces the node environment: some corpus
        // repos (tldraw, vite) enable vitest browser mode in their config,
        // which launches a real browser. We want changed-line unit coverage,
        // not browser tests, and never a window on the auditor's desktop.
        args: [
          'vitest',
          'run',
          '--browser.enabled=false',
          '--coverage.enabled',
          '--coverage.provider',
          'v8',
          '--coverage.reporter',
          'json',
          '--coverage.reportsDirectory',
          'coverage',
        ],
        install: '@vitest/coverage-v8',
      };
    case 'mocha':
      return { cmd: 'npx', args: ['c8', '--reporter', 'json', '--reports-dir', 'coverage', 'mocha'], install: 'c8' };
    default:
      // ava and node-test: no standard one-shot Istanbul JSON path here.
      return null;
  }
}

export interface CoverageRunOptions {
  workspacePath: string;
  testRunner: TestRunner | null;
  changedLines: ChangedLineRanges;
  packageManager?: PackageManager;
  timeoutMs?: number;
  evidenceDir?: string;
  cacheDir?: string;
  /** Where to install the coverage tool (c8 / @vitest/coverage-v8). Defaults
   *  to workspacePath; pass the workspace root for a monorepo package so the
   *  tool lands in the hoisted node_modules. The run uses workspacePath as cwd. */
  installDir?: string;
  /** When set, run the coverage suite (untrusted PR code) inside this container
   *  instead of on the host. The coverage tool is installed on the host; only
   *  the suite execution is containerized. */
  docker?: DockerContext;
  /** When set (and SWARM_EG_NO_CACHE is not), look up and store the run by its
   *  content hash, so an identical re-audit skips the install and the spawn. */
  cache?: EgCacheContext;
}

/** JSON-friendly form of a coverage outcome. The CoverageMap holds Sets, which
 *  do not survive JSON, so it is flattened to sorted arrays for the cache and
 *  rebuilt on read. */
interface SerializedCoverageOutcome {
  ran: boolean;
  deltas: CoverageDelta[];
  coverage?: Array<[string, { instrumented: number[]; covered: number[] }]>;
  rawReportPath?: string;
  skipReason?: string;
}

function serializeCoverageOutcome(outcome: CoverageRunOutcome): SerializedCoverageOutcome {
  const out: SerializedCoverageOutcome = { ran: outcome.ran, deltas: outcome.deltas };
  if (outcome.coverage !== undefined) {
    out.coverage = [...outcome.coverage.entries()].map(([file, cov]) => [
      file,
      { instrumented: [...cov.instrumented], covered: [...cov.covered] },
    ]);
  }
  if (outcome.rawReportPath !== undefined) out.rawReportPath = outcome.rawReportPath;
  if (outcome.skipReason !== undefined) out.skipReason = outcome.skipReason;
  return out;
}

function deserializeCoverageOutcome(serialized: SerializedCoverageOutcome): CoverageRunOutcome {
  const out: CoverageRunOutcome = { ran: serialized.ran, deltas: serialized.deltas };
  if (serialized.coverage !== undefined) {
    const map: CoverageMap = new Map();
    for (const [file, cov] of serialized.coverage) {
      map.set(file, { instrumented: new Set(cov.instrumented), covered: new Set(cov.covered) });
    }
    out.coverage = map;
  }
  if (serialized.rawReportPath !== undefined) out.rawReportPath = serialized.rawReportPath;
  if (serialized.skipReason !== undefined) out.skipReason = serialized.skipReason;
  return out;
}

export interface CoverageRunOutcome {
  ran: boolean;
  deltas: CoverageDelta[];
  coverage?: CoverageMap;
  rawReportPath?: string;
  skipReason?: string;
}

const DEFAULT_COVERAGE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Run the post-PR suite under coverage and compute the changed-line deltas.
 * Returns `ran: false` with a skipReason when the runner has no supported
 * coverage path or the suite produces no report.
 */
/** Pin @vitest/coverage-v8 to the installed vitest version (it must match
 *  exactly); other tools are installed unpinned. */
function versionPinnedInstall(pkg: string, installDir: string): string {
  if (pkg !== '@vitest/coverage-v8') return pkg;
  try {
    const vitestPkg = path.join(installDir, 'node_modules', 'vitest', 'package.json');
    const version = (JSON.parse(fs.readFileSync(vitestPkg, 'utf8')) as { version?: string }).version;
    return version !== undefined ? `${pkg}@${version}` : pkg;
  } catch {
    return pkg;
  }
}

export function computeCoverageDelta(opts: CoverageRunOptions): CoverageRunOutcome {
  const { workspacePath, testRunner, changedLines } = opts;
  if (testRunner === null) {
    return { ran: false, deltas: [], skipReason: 'no test runner detected' };
  }
  const command = coverageCommand(testRunner);
  if (command === null) {
    return { ran: false, deltas: [], skipReason: `no coverage path for runner ${testRunner}` };
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_COVERAGE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const env = execEnv(opts.cacheDir);

  // Content-addressed cache: an identical re-audit skips the install and the
  // coverage spawn. Keyed on (repo, head sha, changed lines, toolchain).
  const useCache = opts.cache !== undefined && egCacheEnabled();
  const cacheKey = useCache
    ? computeEgCacheKey({
        repo: opts.cache!.repo,
        headSha: opts.cache!.headSha,
        changedLines,
        toolchain: `${opts.packageManager ?? 'npm'}/${testRunner}`,
        check: 'coverage',
      })
    : undefined;
  if (useCache && cacheKey !== undefined) {
    const cached = readEgCache<SerializedCoverageOutcome>(opts.cache!, cacheKey);
    if (cached !== undefined) {
      log.debug(`coverage cache hit for ${opts.cache!.repo}@${opts.cache!.headSha.slice(0, 10)}; skipping run`);
      return deserializeCoverageOutcome(cached);
    }
  }

  if (command.install !== undefined) {
    try {
      // @vitest/coverage-v8 must match the project's vitest version exactly or
      // vitest reports it as a missing dependency. Pin it to the installed
      // vitest version when we can read it.
      const pkg = versionPinnedInstall(command.install, opts.installDir ?? workspacePath);
      addDevTools(opts.packageManager ?? 'npm', opts.installDir ?? workspacePath, [pkg], {
        timeoutMs: Math.max(1, Math.min(5 * 60 * 1000, deadline - Date.now())),
        ...(opts.cacheDir !== undefined ? { cacheDir: opts.cacheDir } : {}),
      });
    } catch (err) {
      return { ran: false, deltas: [], skipReason: `coverage tool install (${command.install}) failed: ${String(err).slice(-200)}` };
    }
  }

  try {
    execFileGuarded(execBin(command.cmd), command.args, {
      cwd: workspacePath,
      env,
      timeoutMs: Math.max(1, deadline - Date.now()),
      maxBuffer: 64 * 1024 * 1024,
      ...(opts.docker !== undefined ? { docker: opts.docker } : {}),
    });
  } catch (err) {
    // A failing suite still emits coverage; only bail when there is no report.
    if (isGuardedTimeout(err)) {
      return { ran: false, deltas: [], skipReason: `coverage run exceeded the ${Math.round(timeoutMs / 1000)}s budget` };
    }
    log.debug(`coverage command exited non-zero, will read any partial report: ${String(err).slice(-200)}`);
  }

  const reportPath = path.join(workspacePath, 'coverage', 'coverage-final.json');
  if (!fs.existsSync(reportPath)) {
    return { ran: false, deltas: [], skipReason: 'no coverage-final.json produced' };
  }
  let report: unknown;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (err) {
    return { ran: false, deltas: [], skipReason: `coverage-final.json unparseable: ${String(err).slice(-120)}` };
  }
  const coverage = parseIstanbulCoverage(report, workspacePath);
  const deltas = coverageDeltaForChanges(coverage, changedLines);

  let rawReportPath: string | undefined;
  if (opts.evidenceDir !== undefined) {
    fs.mkdirSync(opts.evidenceDir, { recursive: true });
    rawReportPath = path.join(opts.evidenceDir, 'coverage-final.json');
    fs.copyFileSync(reportPath, rawReportPath);
  }

  const outcome: CoverageRunOutcome = { ran: true, deltas, coverage };
  if (rawReportPath !== undefined) outcome.rawReportPath = rawReportPath;
  if (useCache && cacheKey !== undefined) writeEgCache(opts.cache!, cacheKey, serializeCoverageOutcome(outcome));
  return outcome;
}
