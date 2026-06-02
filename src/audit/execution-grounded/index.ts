// Orchestrator for the execution-grounded audit layer. Given a PR, it
// provisions the pre/post workspaces once, runs the enabled checks (mutation,
// coverage, issue-repro) against them within a per-PR wall-clock budget, and
// turns their outcomes into advisory Findings. The finding builders are pure
// and unit-tested; runExecutionGrounded wires them to the live workspaces and
// is exercised by the evidence run.

import * as path from 'path';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';
import type { Finding } from '../types';
import { extractChangedLineRanges, isPlausiblyTestReachable, isTestFile } from '../cheat-detector/diff-walker';
import type { ChangedLineRanges } from '../cheat-detector/diff-walker';
import type { ExecutionGroundedConfig } from '../cheat-detector/audit-config';
import { provisionPRWorkspaces } from './sandbox';
import { detectTestRunner, type TestRunner } from './sandbox';
import { groupChangedLinesByPackage, rerootToRepo } from './monorepo';
import { runMutationCheck, type MutationResult, type MutationRunOutcome } from './mutation-check';
import {
  computeCoverageDelta,
  type CoverageDelta,
  type CoverageMap,
  type CoverageRunOutcome,
} from './coverage-delta';
import {
  classifyComparison,
  executeIssueRepro,
  extractRepros,
  fetchIssue,
  parseIssueReferences,
  type Repro,
  type ReproVerdict,
} from './issue-repro';

const log = getLogger('audit:execution-grounded');

const MUTABLE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;

/** Source files a mutation/coverage tool can target: changed, non-test JS/TS
 *  that a test could plausibly reach. */
export function mutableSourceFilter(filePath: string): boolean {
  return !isTestFile(filePath) && isPlausiblyTestReachable(filePath) && MUTABLE_EXTENSIONS.test(filePath);
}

function shortEvidence(text: string, limit = 1200): string {
  const t = text.trim();
  return t.length <= limit ? t : `${t.slice(0, limit)}\n... [truncated]`;
}

/**
 * Build mutation findings from surviving mutants. A survivor on a line a test
 * executes (covered) is `mutation-survives-on-changed-line`; one on a line no
 * test executes (NoCoverage, or coverage says uncovered) is
 * `mutation-survives-on-uncovered-changed-line`. The covered-survivor category
 * is only emitted when the run killed at least one mutant: a zero-kill run is
 * non-discriminating, so its covered survivors are an artifact, not signal.
 */
export function mutationFindings(results: MutationResult[]): Finding[] {
  const findings: Finding[] = [];
  // Coverage is read from Stryker's own per-test analysis, not a separate
  // istanbul run: a `Survived` mutant was executed by the suite (that is why it
  // is not `NoCoverage`), so the line is covered by definition. A separate
  // coverage run selects different tests and disagrees, so it must not override
  // Stryker here.
  //
  // A "covered line whose mutant survived" only means the tests run past it
  // without constraining it when the suite is actually discriminating, i.e. it
  // kills at least one mutant. A run that kills nothing (the changed package's
  // tests pass but assert nothing about this code, or the wrong runner ran) is
  // non-validating: its covered survivors are an artifact, not signal. Require a
  // kill before emitting the covered-survivor category; genuinely uncovered
  // lines (NoCoverage) are a coverage fact and stand regardless.
  const killedAny = results.some((m) => m.killed);
  for (const m of results) {
    if (m.killed) continue;
    if (m.status !== 'Survived' && m.status !== 'NoCoverage') continue;
    const uncovered = m.status === 'NoCoverage';
    if (!uncovered && !killedAny) continue;
    const category = uncovered
      ? 'mutation-survives-on-uncovered-changed-line'
      : 'mutation-survives-on-changed-line';
    const message = uncovered
      ? `A \`${m.mutator}\` mutation on this changed line survived because no test executes the line. ` +
        `The suite cannot catch a regression here.`
      : `A \`${m.mutator}\` mutation on this changed line survived: a test runs the line but does not ` +
        `constrain its behavior, so a regression on it would pass the suite.`;
    findings.push({
      category,
      severity: 'warn',
      message,
      location: { file: m.file, line: m.line },
      evidence: `mutation ${m.mutator} @ ${m.file}:${m.line} -> ${m.status}`,
    });
  }
  return findings;
}

/** Build `uncovered-changed-line` (info) findings for uncovered changed lines,
 *  skipping lines a mutation finding already covers (no double-flagging). */
export function coverageFindings(deltas: CoverageDelta[], suppress: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  for (const d of deltas) {
    if (d.coveredAfter) continue;
    if (suppress.has(`${d.file}:${d.line}`)) continue;
    findings.push({
      category: 'uncovered-changed-line',
      severity: 'info',
      message: `This changed line is not executed by any test in the post-PR suite.`,
      location: { file: d.file, line: d.line },
      evidence: `uncovered changed line ${d.file}:${d.line}`,
    });
  }
  return findings;
}

export interface ReproComparison {
  issue: { owner: string; repo: string; number: number };
  repro: Repro;
  verdict: ReproVerdict;
  preStatus: string;
  postStatus: string;
  preOutput: string;
  postOutput: string;
}

/** Build repro findings: a fix that did not deliver (still fails) or a PR that
 *  broke a previously-passing repro. */
export function reproFindings(comparisons: ReproComparison[]): Finding[] {
  const findings: Finding[] = [];
  for (const c of comparisons) {
    const ref = `${c.issue.owner}/${c.issue.repo}#${c.issue.number}`;
    if (c.verdict === 'fix-not-delivered') {
      findings.push({
        category: 'issue-repro-still-fails',
        severity: 'warn',
        message:
          `The repro from issue ${ref}, which this PR claims to fix, still fails against the post-PR code ` +
          `(it also failed before, confirming it reproduces). The fix did not deliver its claim.`,
        location: { file: `issue-${c.issue.number}-repro`, line: 1 },
        evidence: shortEvidence(`post-PR repro output:\n${c.postOutput}`),
      });
    } else if (c.verdict === 'pr-broke-repro') {
      findings.push({
        category: 'pr-breaks-issue-repro',
        severity: 'warn',
        message:
          `The repro from issue ${ref} passed against the pre-PR code but fails after this PR. ` +
          `The change introduced a new failure on a path the issue exercises.`,
        location: { file: `issue-${c.issue.number}-repro`, line: 1 },
        evidence: shortEvidence(`post-PR repro output:\n${c.postOutput}`),
      });
    }
  }
  return findings;
}

export interface ExecutionGroundedInput {
  prDiff: string;
  repo: string;
  prNumber: number;
  prHeadSha: string;
  prBaseSha?: string;
  /** PR body plus commit messages, scanned for issue references. */
  prText?: string;
  config: ExecutionGroundedConfig;
  baseDir: string;
  cacheDir?: string;
  evidenceDir?: string;
  issueCacheDir?: string;
  githubToken?: string;
  /** Per-workspace dependency-install cap. The corpus monorepos can take
   *  well over the 5-minute sandbox default to install, so the evidence run
   *  raises it. */
  installTimeoutMs?: number;
  /** Build the repo after install (self-hosting / compiled repos). */
  runBuild?: boolean;
}

export interface PackagedMutationRun {
  packageDir: string;
  outcome: MutationRunOutcome;
}
export interface PackagedCoverageRun {
  packageDir: string;
  outcome: CoverageRunOutcome;
}

export interface ExecutionGroundedOutcome {
  findings: Finding[];
  /** Per-package check status for the evidence run and the report. A PR can
   *  touch more than one package; each is run in its own package directory. */
  mutationRuns: PackagedMutationRun[];
  coverageRuns: PackagedCoverageRun[];
  repros: ReproComparison[];
  skipped: string[];
}

/**
 * Run the enabled execution-grounded checks against a PR and return advisory
 * findings. Provisioning or a single check failing is an obstacle, not a
 * throw: it is recorded in `skipped` and the run continues with whatever the
 * other checks produced.
 */
export async function runExecutionGrounded(input: ExecutionGroundedInput): Promise<ExecutionGroundedOutcome> {
  const skipped: string[] = [];
  const empty: ExecutionGroundedOutcome = { findings: [], mutationRuns: [], coverageRuns: [], repros: [], skipped };
  if (!input.config.enabled) {
    skipped.push('executionGrounded disabled');
    return empty;
  }
  const changed: ChangedLineRanges = extractChangedLineRanges(input.prDiff, mutableSourceFilter);
  if (Object.keys(changed).length === 0) {
    skipped.push('no mutable source lines in diff');
    return empty;
  }

  let workspaces;
  try {
    workspaces = provisionPRWorkspaces({
      repo: input.repo,
      prNumber: input.prNumber,
      prHeadSha: input.prHeadSha,
      ...(input.prBaseSha !== undefined ? { prBaseSha: input.prBaseSha } : {}),
      baseDir: input.baseDir,
      ...(input.cacheDir !== undefined ? { cacheDir: input.cacheDir } : {}),
      ...(input.installTimeoutMs !== undefined ? { installTimeoutMs: input.installTimeoutMs } : {}),
      ...(input.runBuild !== undefined ? { runBuild: input.runBuild } : {}),
    });
  } catch (err) {
    const reason = err instanceof SwarmError ? `${err.code}: ${err.message}` : String(err);
    log.warn(`provisioning failed for ${input.repo}#${input.prNumber}: ${reason}`);
    skipped.push(`provision: ${reason}`);
    return empty;
  }

  const deadline = Date.now() + input.config.maxWallClockPerPrMs;
  const findings: Finding[] = [];
  const outcome: ExecutionGroundedOutcome = { findings, mutationRuns: [], coverageRuns: [], repros: [], skipped };
  const cacheArg = input.cacheDir !== undefined ? { cacheDir: input.cacheDir } : {};

  try {
    const installDir = workspaces.post.workspacePath;
    const pm = workspaces.post.packageManager;

    // Run mutation + coverage for one scope (a cwd plus its changed-line map,
    // keyed package-relative). Returns which checks executed.
    const runScope = (
      cwd: string,
      packageDir: string,
      scopeChanged: ChangedLineRanges,
      runner: TestRunner | null,
      doCoverage: boolean,
    ): { mutationRan: boolean; coverageRan: boolean } => {
      const evDir = (sub: string): { evidenceDir: string } | Record<string, never> =>
        input.evidenceDir !== undefined
          ? { evidenceDir: path.join(input.evidenceDir, packageDir || '_root', sub) }
          : {};
      const reroot = (f: Finding): Finding => ({
        ...f,
        location: { ...f.location, file: rerootToRepo(packageDir, f.location.file) },
      });
      let coverageMap: CoverageMap | undefined;
      let coverageRan = false;
      let mutationRan = false;
      if (input.config.coverage && doCoverage && Date.now() < deadline) {
        const cov = computeCoverageDelta({
          workspacePath: cwd,
          testRunner: runner,
          packageManager: pm,
          changedLines: scopeChanged,
          timeoutMs: Math.max(1, deadline - Date.now()),
          installDir,
          ...evDir('coverage'),
          ...cacheArg,
        });
        outcome.coverageRuns.push({ packageDir, outcome: cov });
        if (cov.ran) {
          coverageMap = cov.coverage;
          coverageRan = true;
        } else skipped.push(`coverage[${packageDir || '<root>'}]: ${cov.skipReason ?? 'did not run'}`);
      }
      const scopeFindings: Finding[] = [];
      if (input.config.mutation && Date.now() < deadline) {
        const mut = runMutationCheck({
          workspacePath: cwd,
          changedLines: scopeChanged,
          testRunner: runner,
          packageManager: pm,
          timeoutMs: Math.max(1, deadline - Date.now()),
          installDir,
          ...evDir('mutation'),
          ...cacheArg,
        });
        outcome.mutationRuns.push({ packageDir, outcome: mut });
        if (mut.ran) {
          mutationRan = true;
          scopeFindings.push(...mutationFindings(mut.results));
        } else skipped.push(`mutation[${packageDir || '<root>'}]: ${mut.skipReason ?? 'did not run'}`);
      }
      if (coverageRan && coverageMap !== undefined) {
        const lastCov = outcome.coverageRuns[outcome.coverageRuns.length - 1];
        const deltas = lastCov?.packageDir === packageDir ? lastCov.outcome.deltas : [];
        const mutationLines = new Set(
          scopeFindings.filter((f) => f.category.startsWith('mutation-survives')).map((f) => `${f.location.file}:${f.location.line}`),
        );
        scopeFindings.push(...coverageFindings(deltas, mutationLines));
      }
      findings.push(...scopeFindings.map(reroot));
      return { mutationRan, coverageRan };
    };

    // Root-first. A unified-config monorepo (one root vitest/jest config) ties
    // a package's source to tests that may live in another package (trpc keeps
    // its tests in packages/tests), so the whole change is run at the root.
    // When the root suite cannot run the change (a repo with independent
    // per-package configs, or a root suite with environment-dependent
    // failures), fall back to per-package, where the narrower suite often
    // passes. Coverage that already ran at the root is not repeated.
    let mutationRanAtRoot = false;
    let coverageRanAtRoot = false;
    if (workspaces.post.testRunner !== null && Date.now() < deadline) {
      const r = runScope(installDir, '', changed, workspaces.post.testRunner, input.config.coverage);
      mutationRanAtRoot = r.mutationRan;
      coverageRanAtRoot = r.coverageRan;
    }
    const needPackageFallback = input.config.mutation
      ? !mutationRanAtRoot
      : input.config.coverage && !coverageRanAtRoot;
    if (needPackageFallback) {
      for (const scope of groupChangedLinesByPackage(installDir, changed)) {
        if (scope.packageDir === '') continue; // already tried at the root
        if (Date.now() >= deadline) {
          skipped.push(`wall-clock budget reached before package ${scope.packageDir}`);
          break;
        }
        const pkgPath = path.join(installDir, scope.packageDir);
        const runner = detectTestRunner(pkgPath) ?? workspaces.post.testRunner;
        runScope(pkgPath, scope.packageDir, scope.changedLines, runner, input.config.coverage && !coverageRanAtRoot);
      }
    }

    if (input.config.issueRepro && input.prText !== undefined && Date.now() < deadline) {
      const repros = await runIssueRepros(input, workspaces, deadline);
      outcome.repros = repros;
      findings.push(...reproFindings(repros));
    }
  } finally {
    workspaces.cleanup();
  }

  // A root run and a package fallback can both report coverage on the same
  // line; keep one finding per (category, file, line).
  const seen = new Set<string>();
  outcome.findings = findings.filter((f) => {
    const key = `${f.category}|${f.location.file}|${f.location.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return outcome;
}

interface ProvisionedPair {
  pre: { workspacePath: string; testRunner: import('./sandbox').TestRunner | null };
  post: { workspacePath: string; testRunner: import('./sandbox').TestRunner | null };
}

async function runIssueRepros(
  input: ExecutionGroundedInput,
  workspaces: ProvisionedPair,
  deadline: number,
): Promise<ReproComparison[]> {
  const out: ReproComparison[] = [];
  const refs = parseIssueReferences(input.prText ?? '');
  const [defaultOwner, defaultRepo] = input.repo.split('/');
  for (const ref of refs) {
    if (Date.now() >= deadline) break;
    const owner = ref.owner ?? defaultOwner ?? '';
    const repo = ref.repo ?? defaultRepo ?? '';
    const issue = await fetchIssue({
      owner,
      repo,
      number: ref.number,
      ...(input.githubToken !== undefined ? { token: input.githubToken } : {}),
      ...(input.issueCacheDir !== undefined ? { cacheDir: input.issueCacheDir } : {}),
    });
    if (issue === null) continue;
    for (const repro of extractRepros(issue.body)) {
      if (Date.now() >= deadline) break;
      const pre = executeIssueRepro({ workspacePath: workspaces.pre.workspacePath, repro, testRunner: workspaces.pre.testRunner });
      const post = executeIssueRepro({ workspacePath: workspaces.post.workspacePath, repro, testRunner: workspaces.post.testRunner });
      out.push({
        issue: { owner, repo, number: ref.number },
        repro,
        verdict: classifyComparison(pre.status, post.status),
        preStatus: pre.status,
        postStatus: post.status,
        preOutput: `${pre.stdout}\n${pre.stderr}`.trim(),
        postOutput: `${post.stdout}\n${post.stderr}`.trim(),
      });
    }
  }
  return out;
}
