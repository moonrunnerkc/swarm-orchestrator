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
import { runMutationCheck, type MutationResult, type MutationRunOutcome } from './mutation-check';
import {
  computeCoverageDelta,
  isLineCovered,
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
 * test executes (NoCoverage, or coverage says uncovered) is the higher-signal
 * `mutation-survives-on-uncovered-changed-line`.
 */
export function mutationFindings(results: MutationResult[], coverage?: CoverageMap): Finding[] {
  const findings: Finding[] = [];
  for (const m of results) {
    if (m.killed) continue;
    if (m.status !== 'Survived' && m.status !== 'NoCoverage') continue;
    const uncovered =
      m.status === 'NoCoverage' || (coverage !== undefined && !isLineCovered(coverage, m.file, m.line));
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
}

export interface ExecutionGroundedOutcome {
  findings: Finding[];
  /** Per-check status for the evidence run and the report. */
  mutation?: MutationRunOutcome;
  coverage?: CoverageRunOutcome;
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
  const empty: ExecutionGroundedOutcome = { findings: [], repros: [], skipped };
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
    });
  } catch (err) {
    const reason = err instanceof SwarmError ? `${err.code}: ${err.message}` : String(err);
    log.warn(`provisioning failed for ${input.repo}#${input.prNumber}: ${reason}`);
    skipped.push(`provision: ${reason}`);
    return empty;
  }

  const deadline = Date.now() + input.config.maxWallClockPerPrMs;
  const findings: Finding[] = [];
  const outcome: ExecutionGroundedOutcome = { findings, repros: [], skipped };
  const cacheArg = input.cacheDir !== undefined ? { cacheDir: input.cacheDir } : {};

  try {
    let coverageMap: CoverageMap | undefined;
    if (input.config.coverage && Date.now() < deadline) {
      const cov = computeCoverageDelta({
        workspacePath: workspaces.post.workspacePath,
        testRunner: workspaces.post.testRunner,
        changedLines: changed,
        timeoutMs: Math.max(1, deadline - Date.now()),
        ...(input.evidenceDir !== undefined ? { evidenceDir: path.join(input.evidenceDir, 'coverage') } : {}),
        ...cacheArg,
      });
      outcome.coverage = cov;
      if (cov.ran) coverageMap = cov.coverage;
      else skipped.push(`coverage: ${cov.skipReason ?? 'did not run'}`);
    }

    if (input.config.mutation && Date.now() < deadline) {
      const mut = runMutationCheck({
        workspacePath: workspaces.post.workspacePath,
        changedLines: changed,
        testRunner: workspaces.post.testRunner,
        timeoutMs: Math.max(1, deadline - Date.now()),
        ...(input.evidenceDir !== undefined ? { evidenceDir: path.join(input.evidenceDir, 'mutation') } : {}),
        ...cacheArg,
      });
      outcome.mutation = mut;
      if (mut.ran) {
        const mf = mutationFindings(mut.results, coverageMap);
        findings.push(...mf);
      } else {
        skipped.push(`mutation: ${mut.skipReason ?? 'did not run'}`);
      }
    }

    // Coverage findings, suppressing lines a mutation finding already raised.
    if (outcome.coverage?.ran === true) {
      const mutationLines = new Set(
        findings
          .filter((f) => f.category.startsWith('mutation-survives'))
          .map((f) => `${f.location.file}:${f.location.line}`),
      );
      findings.push(...coverageFindings(outcome.coverage.deltas, mutationLines));
    }

    if (input.config.issueRepro && input.prText !== undefined && Date.now() < deadline) {
      const repros = await runIssueRepros(input, workspaces, deadline);
      outcome.repros = repros;
      findings.push(...reproFindings(repros));
    }
  } finally {
    workspaces.cleanup();
  }

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
