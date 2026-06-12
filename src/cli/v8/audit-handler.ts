/**
 * Implementation of `swarm audit` (and `swarm v8 audit`).
 *
 * The v10 auditor entry point. Runs the cheat-detector engine against a
 * unified diff, optionally fingerprints the AI agent that opened the
 * PR, writes findings to the run ledger as v10 audit entries, and (when
 * --emit-aibom is passed) writes a CycloneDX-ML or SPDX-AI artifact.
 *
 * Three input modes are supported:
 *
 *   1. --diff-file <path>     read unified diff from disk
 *   2. --diff-stdin           read unified diff from stdin
 *   3. --pr <url|owner/repo#N> fetch the PR's diff via GitHub API (uses
 *                              GITHUB_TOKEN if available)
 *
 * Exit code:
 *   0 — no blocking findings, or any result in `advise` mode
 *   1 — at least one blocking finding in `gate` mode (the merge gate)
 *   2 — usage error or unrecoverable failure
 *
 * The `--mode` flag toggles between `advise` (default, suspicion-score
 * only) and `gate` (the v10.1 merge-blocking contract). In `advise`
 * the rendered comment is unchanged in content (every finding is still
 * surfaced with its measured precision), but the exit code never goes
 * to 1 on a blocking finding — the audit's role is signal, not refusal.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { getLogger } from '../../logger';
import { runParseArgs, readBoolean, readString, type ParseArgsOptions } from './argv-schema';
import { runCheatDetectors } from '../../audit/cheat-detector';
import { parseDetectorSet } from '../../audit/cheat-detector/detector-sets';
import { detectAgent } from '../../audit/pr-source';
import { renderPrComment } from '../../audit/report-comment';
import { writeCycloneDxMlBom } from '../../audit/aibom/cyclonedx-ml';
import { writeSpdxAiProfileBom } from '../../audit/aibom/spdx-ai-profile';
import { HashChainedLedger } from '../../ledger/ledger';
import { SwarmError } from '../../errors';
import type {
  AuditInput,
  AuditMode,
  AuditResult,
  AuditAgentAttribution,
  DetectorSetName,
  Finding,
  JudgeLedgerEntry,
  JudgeLedgerSink,
} from '../../audit/types';
import type {
  LedgerAgentAttribution,
  LlmJudgeResultEntry,
  PrAuditStartedEntry,
  PrAuditFindingEntry,
  PrAuditCompletedEntry,
  PrAuditJudgePrimaryEntry,
  PrAuditMutationFindingEntry,
  PrAuditIssueReproFindingEntry,
  PrAuditCoverageFindingEntry,
  PrAuditRestorationEntry,
  PrAuditMockRestorationEntry,
  PrAuditNoOpFixRestorationEntry,
  PrAuditTypeSuppressionRestorationEntry,
  PrAuditFakeRefactorRestorationEntry,
  PrAuditDeadBranchRestorationEntry,
} from '../../ledger/types';
import { isExecutionGroundedCategory } from '../../audit/types';
import { loadAuditConfig, type ExecutionGroundedConfig } from '../../audit/cheat-detector/audit-config';
import { runExecutionGrounded, type ExecutionGroundedOutcome } from '../../audit/execution-grounded';
import type { RestorationProofRecord } from '../../audit/execution-grounded/test-restoration';
import type { MockRestorationProofRecord } from '../../audit/execution-grounded/mock-restoration';
import type { NoOpFixProofRecord } from '../../audit/execution-grounded/no-op-fix-restoration';
import type { TypeSuppressionProofRecord } from '../../audit/execution-grounded/type-suppression-restoration';
import type { FakeRefactorProofRecord } from '../../audit/execution-grounded/fake-refactor-restoration';
import type { DeadBranchProofRecord } from '../../audit/execution-grounded/dead-branch-restoration';
import {
  corroborateStructuralFindings,
  executionSignalsFromOutcome,
} from '../../audit/execution-grounded/corroborate';
import { parsePrIntent } from '../../audit/cheat-detector/pr-intent';
import { parseIssueReferences } from '../../audit/execution-grounded/issue-repro';
import { detectBlockTriggers, type BlockTrigger } from '../../audit/gate/block-triggers';
import { appendBlockTriggerEntry } from '../../audit/gate/block-trigger-ledger';
import { decideBlock, isBlockEligible } from '../../audit/gate/gate-decision';
import { fetchPrDiffViaGithub, parsePrRef, type GithubPrRef } from './pr-fetch';
import { fetchPrManifests } from './pr-manifest-fetch';
import { writeShadowEntry } from '../../audit/shadow';
import { buildShadowOutput, writeShadowOutputFile } from '../../audit/shadow-output';

const logger = getLogger('cli:v8:audit');

interface AuditFlags {
  diffFile?: string;
  diffStdin: boolean;
  prRef?: string;
  repoRoot: string;
  output: 'text' | 'json' | 'markdown';
  emitAibom?: 'cyclonedx-ml' | 'spdx-ai' | 'both';
  aibomPath: string;
  ledgerPath?: string;
  helpRequested: boolean;
  mode: AuditMode;
  detectorSet: DetectorSetName;
  shadow?: string;
  shadowDir: string;
  shadowOutput?: string;
  enableLlmJudge: boolean;
}

const AUDIT_SCHEMA: ParseArgsOptions = {
  'diff-file': { type: 'string' },
  'diff-stdin': { type: 'boolean' },
  pr: { type: 'string' },
  'repo-root': { type: 'string' },
  output: { type: 'string' },
  'emit-aibom': { type: 'string' },
  'aibom-out': { type: 'string' },
  'ledger-path': { type: 'string' },
  mode: { type: 'string' },
  detectors: { type: 'string' },
  shadow: { type: 'string' },
  'shadow-dir': { type: 'string' },
  'shadow-output': { type: 'string' },
  'enable-llm-judge': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const USAGE = [
  'usage: swarm audit [<pr-ref>] [flags]',
  '',
  'inputs (exactly one required):',
  '  <pr-ref>                  positional: <owner>/<repo>#<number> or PR URL',
  '  --pr <ref>                same as positional <pr-ref>',
  '  --diff-file <path>        unified diff on disk',
  '  --diff-stdin              read unified diff from stdin',
  '',
  'options:',
  '  --mode <advise|gate>      advise (default): report only, never block merge;',
  '                            gate: exit 1 on any blocking finding',
  '  --detectors <set>         default (the four advisory-grade detectors) |',
  "                            experimental (default + six retired) | all (alias)",
  '  --repo-root <path>        repo checkout for manifest / test-import lookups (default: cwd)',
  "  --output <fmt>            text (default) | json | markdown",
  '  --emit-aibom <fmt>        cyclonedx-ml | spdx-ai | both',
  '  --aibom-out <path>        directory for AIBOM artifacts (default: .swarm/aibom)',
  '  --ledger-path <path>      override audit ledger file (default: .swarm/ledger/audit-<runId>.jsonl)',
  '  --shadow <repo-label>     shadow-mode dogfood: record findings under <dir>/<repo>/<run-id>.json,',
  '                            no comment post, no gate',
  '  --shadow-dir <path>       shadow output directory for --shadow (default: .swarm/shadow)',
  '  --shadow-output <path>    single-file shadow output (one JSON object: detector verdicts, judge',
  '                            invocation count, rendered comment). No comment post, no gate.',
  '  --enable-llm-judge        opt into the Anthropic Haiku judge for detectors that integrate it',
  '                            (also enabled by SWARM_AUDIT_LLM_JUDGE=1). Requires ANTHROPIC_API_KEY.',
  '  --help, -h                show this message',
  '',
  'exit codes:',
  '  0 — pass, or any result in advise mode',
  '  1 — block (one or more blocking findings, gate mode only)',
  '  2 — usage error or unrecoverable failure',
  '',
].join('\n');

function parseFlags(argv: string[]): AuditFlags {
  const { values, positionals } = runParseArgs(argv, AUDIT_SCHEMA);
  const helpRequested = readBoolean(values, 'help');
  if (helpRequested) {
    process.stderr.write(USAGE);
    return makeMinimalFlags(true);
  }

  const judgeFromEnv = (process.env.SWARM_AUDIT_LLM_JUDGE ?? '').trim() === '1';
  const judgeFromFlag = readBoolean(values, 'enable-llm-judge');
  const flags: AuditFlags = {
    diffStdin: readBoolean(values, 'diff-stdin'),
    repoRoot: readString(values, 'repo-root') ?? process.cwd(),
    output: parseOutput(readString(values, 'output')),
    aibomPath: readString(values, 'aibom-out') ?? '.swarm/aibom',
    helpRequested: false,
    mode: parseMode(readString(values, 'mode')),
    detectorSet: parseDetectorsFlag(readString(values, 'detectors')),
    shadowDir: readString(values, 'shadow-dir') ?? '.swarm/shadow',
    enableLlmJudge: judgeFromFlag || judgeFromEnv,
  };
  const diffFile = readString(values, 'diff-file');
  if (diffFile !== undefined) flags.diffFile = diffFile;
  const prFlag = readString(values, 'pr');
  const prPositional = positionals[0];
  if (prFlag !== undefined) flags.prRef = prFlag;
  else if (prPositional !== undefined) flags.prRef = prPositional;
  const aibom = readString(values, 'emit-aibom');
  if (aibom !== undefined) flags.emitAibom = parseAibom(aibom);
  const ledgerPath = readString(values, 'ledger-path');
  if (ledgerPath !== undefined) flags.ledgerPath = ledgerPath;
  const shadowLabel = readString(values, 'shadow');
  if (shadowLabel !== undefined) flags.shadow = shadowLabel;
  const shadowOutput = readString(values, 'shadow-output');
  if (shadowOutput !== undefined) flags.shadowOutput = shadowOutput;
  validateFlags(flags);
  return flags;
}

function makeMinimalFlags(helpRequested: boolean): AuditFlags {
  return {
    diffStdin: false,
    repoRoot: process.cwd(),
    output: 'text',
    aibomPath: '.swarm/aibom',
    helpRequested,
    mode: 'advise',
    detectorSet: 'default',
    shadowDir: '.swarm/shadow',
    enableLlmJudge: false,
  };
}

function parseOutput(raw: string | undefined): 'text' | 'json' | 'markdown' {
  if (raw === undefined) return 'text';
  if (raw === 'text' || raw === 'json' || raw === 'markdown') return raw;
  throw new SwarmError(
    `invalid --output value "${raw}"; expected text | json | markdown`,
    'AUDIT_USAGE',
    { remediation: 'Try: --output text | --output json | --output markdown' },
  );
}

function parseAibom(raw: string): 'cyclonedx-ml' | 'spdx-ai' | 'both' {
  if (raw === 'cyclonedx-ml' || raw === 'spdx-ai' || raw === 'both') return raw;
  throw new SwarmError(
    `invalid --emit-aibom value "${raw}"; expected cyclonedx-ml | spdx-ai | both`,
    'AUDIT_USAGE',
    { remediation: 'Try: --emit-aibom cyclonedx-ml' },
  );
}

function parseMode(raw: string | undefined): AuditMode {
  if (raw === undefined) return 'advise';
  if (raw === 'advise' || raw === 'gate') return raw;
  throw new SwarmError(
    `invalid --mode value "${raw}"; expected advise | gate`,
    'AUDIT_USAGE',
    { remediation: 'Try: --mode advise | --mode gate' },
  );
}

function parseDetectorsFlag(raw: string | undefined): DetectorSetName {
  try {
    return parseDetectorSet(raw);
  } catch (err) {
    throw new SwarmError(
      err instanceof Error ? err.message : String(err),
      'AUDIT_USAGE',
      { remediation: 'Try: --detectors default | --detectors experimental' },
    );
  }
}

function validateFlags(flags: AuditFlags): void {
  const sources = [flags.diffFile, flags.prRef, flags.diffStdin ? 'stdin' : undefined].filter(
    (x) => x !== undefined,
  );
  if (sources.length !== 1) {
    throw new SwarmError(
      'exactly one of --diff-file, --diff-stdin, or --pr/<pr-ref> must be provided',
      'AUDIT_USAGE',
      { remediation: 'Try: swarm audit --diff-stdin < my.patch' },
    );
  }
  // --repo-root is the trust boundary for filesystem reads. A workflow
  // author can pass `--diff-file ../../etc/passwd` via the Action's
  // extra-args input; resolve it against the repo root and reject when
  // it lands outside. `SWARM_DIFF_FILE_ALLOW_OUTSIDE=1` opts an operator
  // back into the old behavior for local dev flows that diff against an
  // out-of-tree patch file.
  if (
    flags.diffFile !== undefined &&
    (process.env.SWARM_DIFF_FILE_ALLOW_OUTSIDE ?? '').trim() !== '1'
  ) {
    const repoRoot = path.resolve(flags.repoRoot);
    const resolved = path.resolve(repoRoot, flags.diffFile);
    const rel = path.relative(repoRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new SwarmError(
        `--diff-file "${flags.diffFile}" resolves outside --repo-root "${repoRoot}"`,
        'AUDIT_USAGE',
        {
          remediation:
            'Move the diff inside the repo root, or set SWARM_DIFF_FILE_ALLOW_OUTSIDE=1 to allow out-of-tree paths',
        },
      );
    }
    flags.diffFile = resolved;
  }
}

export async function handleAudit(argv: string[]): Promise<number> {
  let flags: AuditFlags;
  try {
    flags = parseFlags(argv);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    if (err instanceof SwarmError && err.remediation !== undefined) {
      logger.error(err.remediation);
    }
    return 2;
  }
  if (flags.helpRequested) return 0;
  return await runAudit(flags);
}

interface ExecutionGroundedLayerArgs {
  result: AuditResult;
  prContext: PrContext;
  unifiedDiff: string;
  config: ExecutionGroundedConfig;
  ledger: HashChainedLedger;
  attribution: LedgerAgentAttribution | undefined;
}

/** Run the execution-grounded layer for a --pr audit and fold its advisory
 *  findings into the result and the ledger (under dedicated entry kinds).
 *  Returns the run outcome so the caller can build block triggers from its
 *  signals, or undefined when the layer did not run. */
async function runExecutionGroundedLayer(
  args: ExecutionGroundedLayerArgs,
): Promise<ExecutionGroundedOutcome | undefined> {
  const { result, prContext, unifiedDiff, config, ledger, attribution } = args;
  const pr = prContext.prMetadata;
  const evidenceDir = path.join('.swarm', 'execution-grounded', `${pr.repository.replace('/', '-')}-${pr.number}`);
  const aiAgent = attribution !== undefined ? { aiAgent: attribution } : undefined;
  let outcome;
  try {
    outcome = await runExecutionGrounded({
      prDiff: unifiedDiff,
      repo: pr.repository,
      prNumber: pr.number,
      prHeadSha: pr.headSha,
      ...(pr.baseSha.length > 0 ? { prBaseSha: pr.baseSha } : {}),
      prText: `${pr.title}\n\n${pr.body}`,
      prTitle: pr.title,
      prBody: pr.body,
      config,
      baseDir: path.join(os.tmpdir(), 'swarm-eg'),
      evidenceDir,
      issueCacheDir: path.join(evidenceDir, 'issue-cache'),
      ...(process.env.GITHUB_TOKEN !== undefined && process.env.GITHUB_TOKEN.length > 0
        ? { githubToken: process.env.GITHUB_TOKEN }
        : {}),
      // The restoration phase consumes the structural detector findings, not
      // the layer's own (outcome.findings only ever holds execution-grounded
      // categories), and mutates the qualifying ones in place.
      structuralFindings: result.findings,
    });
  } catch (err) {
    logger.warn(`execution-grounded layer failed for ${pr.repository}#${pr.number}: ${String(err)}`);
    return undefined;
  }
  if (outcome.skipped.length > 0) {
    logger.info(`execution-grounded skipped: ${outcome.skipped.join('; ')}`);
  }

  const coverageReport = outcome.coverageRuns.find((r) => r.outcome.rawReportPath !== undefined)?.outcome.rawReportPath;
  const survivorAt = new Map<string, { mutator: string; status: string; evidencePath?: string }>();
  for (const run of outcome.mutationRuns) {
    for (const m of run.outcome.results) {
      const repoFile = run.packageDir.length > 0 ? `${run.packageDir}/${m.file}` : m.file;
      survivorAt.set(`${repoFile}:${m.line}`, {
        mutator: m.mutator,
        status: m.status,
        ...(run.outcome.rawReportPath !== undefined ? { evidencePath: run.outcome.rawReportPath } : {}),
      });
    }
  }

  for (const finding of outcome.findings) {
    if (finding.category.startsWith('mutation-survives')) {
      const detail = survivorAt.get(`${finding.location.file}:${finding.location.line}`);
      const payload: Omit<PrAuditMutationFindingEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
        type: 'pr-audit-mutation-finding',
        category: finding.category,
        severity: finding.severity,
        file: finding.location.file,
        line: finding.location.line,
        mutator: detail?.mutator ?? 'unknown',
        status: detail?.status ?? 'Survived',
      };
      if (detail?.evidencePath !== undefined) (payload as PrAuditMutationFindingEntry).evidencePath = detail.evidencePath;
      ledger.append<PrAuditMutationFindingEntry>(payload, aiAgent);
    } else if (finding.category === 'uncovered-changed-line') {
      const payload: Omit<PrAuditCoverageFindingEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
        type: 'pr-audit-coverage-finding',
        category: finding.category,
        severity: finding.severity,
        file: finding.location.file,
        line: finding.location.line,
      };
      if (coverageReport !== undefined) (payload as PrAuditCoverageFindingEntry).evidencePath = coverageReport;
      ledger.append<PrAuditCoverageFindingEntry>(payload, aiAgent);
    } else {
      const payload: Omit<PrAuditIssueReproFindingEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
        type: 'pr-audit-issue-repro-finding',
        category: finding.category,
        severity: finding.severity,
        issueRef: finding.location.file,
        verdict: finding.category === 'issue-repro-still-fails' ? 'fix-not-delivered' : 'pr-broke-repro',
      };
      ledger.append<PrAuditIssueReproFindingEntry>(payload, aiAgent);
    }
    result.findings.push(finding);
  }

  appendRestorationEntries(ledger, outcome.restorations, attribution);
  appendMockRestorationEntries(ledger, outcome.mockRestorations, attribution);
  appendNoOpRestorationEntries(ledger, outcome.noOpRestorations, attribution);
  appendTypeSuppressionRestorationEntries(ledger, outcome.typeSuppressionRestorations, attribution);
  appendFakeRefactorRestorationEntries(ledger, outcome.fakeRefactorRestorations, attribution);
  appendDeadBranchRestorationEntries(ledger, outcome.deadBranchRestorations, attribution);

  // Runtime corroboration (opt-in). When this run's execution layer actually
  // produced signals, mark the structural findings that a surviving mutant,
  // coverage gap, or still-failing repro backs on the same line. Uncorroborated
  // findings are untouched and stay advisory.
  if (config.corroborateStructural) {
    const ran =
      outcome.mutationRuns.some((r) => r.outcome.ran) ||
      outcome.coverageRuns.some((r) => r.outcome.ran) ||
      outcome.repros.length > 0;
    if (ran) {
      const signals = executionSignalsFromOutcome(outcome);
      const backed = corroborateStructuralFindings(result.findings, signals);
      if (backed > 0) logger.info(`runtime corroboration backed ${backed} structural finding(s)`);
    }
  }
  return outcome;
}

/** One pr-audit-restoration entry per proof record, so the ledger carries the
 *  full restoration funnel with the run's agent attribution. */
export function appendRestorationEntries(
  ledger: HashChainedLedger,
  restorations: readonly RestorationProofRecord[],
  attribution: LedgerAgentAttribution | undefined,
): void {
  const opts = attribution !== undefined ? { aiAgent: attribution } : undefined;
  for (const restoration of restorations) {
    const payload: Omit<PrAuditRestorationEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
      type: 'pr-audit-restoration',
      category: restoration.category,
      verdict: restoration.verdict,
      findingFile: restoration.findingFile,
      testFiles: restoration.testFiles,
      failingTests: restoration.failingTests,
      controls: restoration.controls,
      reproduceCommand: restoration.reproduceCommand,
    };
    ledger.append<PrAuditRestorationEntry>(payload, opts);
  }
}

/** One pr-audit-mock-restoration entry per mock-mutation proof record, every
 *  verdict included, so the ledger carries the full mock proof funnel. */
export function appendMockRestorationEntries(
  ledger: HashChainedLedger,
  records: readonly MockRestorationProofRecord[],
  attribution: LedgerAgentAttribution | undefined,
): void {
  const opts = attribution !== undefined ? { aiAgent: attribution } : undefined;
  for (const r of records) {
    const payload: Omit<PrAuditMockRestorationEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
      type: 'pr-audit-mock-restoration',
      category: r.category,
      verdict: r.verdict,
      findingFile: r.findingFile,
      testFiles: r.testFiles,
      failingTests: r.failingTests,
      mockedReturnValues: r.mockedReturnValues,
      controls: r.controls,
      reproduceCommand: r.reproduceCommand,
    };
    ledger.append<PrAuditMockRestorationEntry>(payload, opts);
  }
}

/** One pr-audit-no-op-fix-restoration entry per no-op proof record (PR-level,
 *  so at most one), every verdict included. */
export function appendNoOpRestorationEntries(
  ledger: HashChainedLedger,
  records: readonly NoOpFixProofRecord[],
  attribution: LedgerAgentAttribution | undefined,
): void {
  const opts = attribution !== undefined ? { aiAgent: attribution } : undefined;
  for (const r of records) {
    const payload: Omit<PrAuditNoOpFixRestorationEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
      type: 'pr-audit-no-op-fix-restoration',
      category: r.category,
      verdict: r.verdict,
      findingFile: r.findingFile,
      revertedSourceFiles: r.revertedSourceFiles,
      affectedTestFiles: r.affectedTestFiles,
      prClaim: r.prClaim,
      controls: r.controls,
      reproduceCommand: r.reproduceCommand,
    };
    ledger.append<PrAuditNoOpFixRestorationEntry>(payload, opts);
  }
}

/** One pr-audit-type-suppression-restoration entry per type-suppression proof
 *  record, every verdict included, so the ledger carries the full proof funnel. */
export function appendTypeSuppressionRestorationEntries(
  ledger: HashChainedLedger,
  records: readonly TypeSuppressionProofRecord[],
  attribution: LedgerAgentAttribution | undefined,
): void {
  const opts = attribution !== undefined ? { aiAgent: attribution } : undefined;
  for (const r of records) {
    const payload: Omit<PrAuditTypeSuppressionRestorationEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
      type: 'pr-audit-type-suppression-restoration',
      category: r.category,
      verdict: r.verdict,
      findingFile: r.findingFile,
      removedDirectives: r.removedDirectives,
      surfacedDiagnostics: r.surfacedDiagnostics,
      controls: r.controls,
      reproduceCommand: r.reproduceCommand,
    };
    ledger.append<PrAuditTypeSuppressionRestorationEntry>(payload, opts);
  }
}

/** One pr-audit-fake-refactor-restoration entry per fake-refactor proof record,
 *  every verdict included, so the ledger carries the full proof funnel. */
export function appendFakeRefactorRestorationEntries(
  ledger: HashChainedLedger,
  records: readonly FakeRefactorProofRecord[],
  attribution: LedgerAgentAttribution | undefined,
): void {
  const opts = attribution !== undefined ? { aiAgent: attribution } : undefined;
  for (const r of records) {
    const payload: Omit<PrAuditFakeRefactorRestorationEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
      type: 'pr-audit-fake-refactor-restoration',
      category: r.category,
      verdict: r.verdict,
      findingFile: r.findingFile,
      oldName: r.oldName,
      newName: r.newName,
      references: r.references,
      controls: r.controls,
      reproduceCommand: r.reproduceCommand,
    };
    ledger.append<PrAuditFakeRefactorRestorationEntry>(payload, opts);
  }
}

/** One pr-audit-dead-branch-restoration entry per dead-branch proof record,
 *  every verdict included, so the ledger carries the full proof funnel. */
export function appendDeadBranchRestorationEntries(
  ledger: HashChainedLedger,
  records: readonly DeadBranchProofRecord[],
  attribution: LedgerAgentAttribution | undefined,
): void {
  const opts = attribution !== undefined ? { aiAgent: attribution } : undefined;
  for (const r of records) {
    const payload: Omit<PrAuditDeadBranchRestorationEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
      type: 'pr-audit-dead-branch-restoration',
      category: r.category,
      verdict: r.verdict,
      findingFile: r.findingFile,
      branchCondition: r.branchCondition,
      branchLine: r.branchLine,
      affectedTestFiles: r.affectedTestFiles,
      controls: r.controls,
      reproduceCommand: r.reproduceCommand,
    };
    ledger.append<PrAuditDeadBranchRestorationEntry>(payload, opts);
  }
}

/**
 * Recompute the published pass flag from the findings' final severities.
 * `runCheatDetectors` computes `pass` before the execution-grounded layer can
 * demote a blocking finding (a refuted restoration), so the flag must be
 * recomputed after that layer or the gate decision, the completed ledger
 * entry, and the rendered comment would all publish a stale BLOCK. Safe over
 * the merged findings list: the execution-grounded builders only ever emit
 * warn/info severities, never block, so they cannot flip the flag themselves.
 */
export function recomputeAuditPass(result: AuditResult): void {
  result.pass = result.findings.every((f) => f.severity !== 'block');
}

/**
 * Append one ledger entry per finding, reflecting each finding's final
 * published state. A judge-primary finding has no deterministic candidate
 * behind it, so it is recorded under its own kind to stay distinguishable
 * from a detector finding the judge merely confirmed; execution-grounded
 * findings are skipped because the execution-grounded layer records them
 * under their dedicated kinds when it runs. Called after that layer so a
 * demoted finding's entry carries the demoted severity and a hash of the
 * evidence as published (the demotion note included).
 */
export function appendFindingEntries(
  ledger: HashChainedLedger,
  findings: readonly Finding[],
  attribution: LedgerAgentAttribution | undefined,
): void {
  const opts = attribution !== undefined ? { aiAgent: attribution } : undefined;
  for (const finding of findings) {
    if (isExecutionGroundedCategory(finding.category)) continue;
    if (finding.judgePrimary === true) {
      const primaryPayload: Omit<
        PrAuditJudgePrimaryEntry,
        'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'
      > = {
        type: 'pr-audit-judge-primary',
        category: finding.category,
        modelId: finding.judgeModelId ?? 'unknown',
        answer: 'yes',
        file: finding.location.file,
        line: finding.location.line,
      };
      if (finding.judgeReasoning !== undefined) {
        (primaryPayload as PrAuditJudgePrimaryEntry).reason = finding.judgeReasoning;
      }
      ledger.append<PrAuditJudgePrimaryEntry>(primaryPayload, opts);
      continue;
    }
    const evidenceSha256 = crypto.createHash('sha256').update(finding.evidence).digest('hex');
    const payload: Omit<PrAuditFindingEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> = {
      type: 'pr-audit-finding',
      category: finding.category,
      severity: finding.severity,
      file: finding.location.file,
      line: finding.location.line,
      message: finding.message,
      evidenceSha256,
    };
    if (finding.location.endLine !== undefined) {
      (payload as PrAuditFindingEntry).endLine = finding.location.endLine;
    }
    ledger.append<PrAuditFindingEntry>(payload, opts);
  }
}

/** The completed-entry payload. Pass, blockingCount, and detail all derive
 *  from the same findings array, so the published verdict cannot contradict
 *  its own counts. */
export function buildCompletedEntry(
  result: AuditResult,
  pr: { number: number; repository: string } | undefined,
  wallTimeMs: number,
): Omit<PrAuditCompletedEntry, 'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'> {
  const blockingCount = result.findings.filter((f) => f.severity === 'block').length;
  return {
    type: 'pr-audit-completed',
    prNumber: pr?.number ?? null,
    prRepository: pr?.repository ?? null,
    pass: result.pass,
    findingCount: result.findings.length,
    blockingCount,
    warningCount: result.findings.filter((f) => f.severity === 'warn').length,
    detectorVersions: result.detectorVersions,
    wallTimeMs,
    detail: result.pass
      ? `audit pass — ${result.findings.length} non-blocking finding(s)`
      : `audit block — ${blockingCount} blocking finding(s)`,
  };
}

/**
 * The single post-execution publication seam. The execution-grounded layer
 * can demote a blocking finding (a refuted restoration) and appends its own
 * advisory findings, so everything published afterwards must work from the
 * findings' final state, in this order: recompute the pass flag, append the
 * finding entries (each reflecting its finding as published, judge-primary
 * routed to its own kind), take the gate decision against the recomputed
 * pass, then append the completed entry derived from the same findings. The
 * ordering lives in one function so it cannot regress by a call-site move:
 * runAudit calls this exactly once, after the execution-grounded layer.
 * `recordGateDecision` runs between the finding entries and the completed
 * entry (where the block-trigger entries land on the ledger today) and its
 * result is returned to the caller.
 */
export function publishAuditVerdict<T>(
  args: {
    ledger: HashChainedLedger;
    result: AuditResult;
    attribution: LedgerAgentAttribution | undefined;
    pr: { number: number; repository: string } | undefined;
    wallTimeMs: number;
  },
  recordGateDecision: (pass: boolean) => T,
): T {
  const { ledger, result, attribution, pr, wallTimeMs } = args;
  recomputeAuditPass(result);
  appendFindingEntries(ledger, result.findings, attribution);
  const decision = recordGateDecision(result.pass);
  ledger.append<PrAuditCompletedEntry>(
    buildCompletedEntry(result, pr, wallTimeMs),
    attribution !== undefined ? { aiAgent: attribution } : undefined,
  );
  return decision;
}

/**
 * Build the verifiable-evidence block triggers for a --pr audit from the
 * execution-grounded outcome: a falsified fix claim (T1), a structural
 * finding a surviving mutant or coverage gap corroborates on the same line
 * (T2), a fully-controlled test-restoration proof (T4), a mock-mutation proof
 * (T5), and a no-op-fix proof (T6). The audit surface declares no obligations,
 * so T3 does not apply here.
 */
function buildBlockTriggers(
  outcome: ExecutionGroundedOutcome,
  result: AuditResult,
  prContext: PrContext,
  prRef: string | undefined,
): BlockTrigger[] {
  const pr = prContext.prMetadata;
  const prText = `${pr.title}\n\n${pr.body}`;
  const structural = result.findings.filter(
    (f) => !isExecutionGroundedCategory(f.category) && f.judgePrimary !== true,
  );
  return detectBlockTriggers({
    claimFalsified: {
      prIntent: parsePrIntent({ title: pr.title, body: pr.body }),
      linkedIssues: parseIssueReferences(prText),
      repros: outcome.repros,
      testRunner: null,
    },
    corroborated: {
      findings: structural,
      signals: executionSignalsFromOutcome(outcome),
      prRef: prRef ?? `${pr.repository}#${pr.number}`,
    },
    restorations: { restorations: outcome.restorations },
    mockRestorations: { mockRestorations: outcome.mockRestorations },
    noOpRestorations: { noOpRestorations: outcome.noOpRestorations },
    typeSuppressionRestorations: {
      typeSuppressionRestorations: outcome.typeSuppressionRestorations,
    },
    fakeRefactorRestorations: {
      fakeRefactorRestorations: outcome.fakeRefactorRestorations,
    },
    deadBranchRestorations: {
      deadBranchRestorations: outcome.deadBranchRestorations,
    },
  });
}

/** Resolved audit inputs: the diff text, the optional PR context, the
 *  detected AI agent, the fetched manifest tree (when --pr), and the
 *  effective repo root the detector engine reads manifests from. */
interface AuditInputs {
  unifiedDiff: string;
  prContext: PrContext | undefined;
  agent: AuditAgentAttribution | undefined;
  fetchedManifests: Awaited<ReturnType<typeof maybeFetchManifests>>;
  effectiveRepoRoot: string;
}

async function loadAuditInputs(flags: AuditFlags): Promise<AuditInputs> {
  const unifiedDiff = await loadDiff(flags);
  const prContext = await loadPrContext(flags);
  const agent = prContext !== undefined ? detectAgent(prContext.fingerprintInput) : undefined;
  // For --pr audits, the user's cwd has no relationship to the target
  // repo, so the cheat-detector's manifest readers would otherwise see
  // swarm's own package.json instead of the PR's actual manifest(s).
  // Fetch the candidate manifests via the GitHub Contents API and run
  // the audit with repoRoot pointed at the resulting temp tree. For
  // other input modes (--diff-file, --diff-stdin), the caller's
  // --repo-root is the right answer.
  const fetchedManifests = await maybeFetchManifests(flags, unifiedDiff, prContext);
  const effectiveRepoRoot =
    fetchedManifests !== undefined ? fetchedManifests.tempRoot : flags.repoRoot;
  return { unifiedDiff, prContext, agent, fetchedManifests, effectiveRepoRoot };
}

/** The ledger plus the judge sink that writes onto the same hash chain. */
interface LedgerAndSink {
  runId: string;
  ledgerPath: string;
  ledger: HashChainedLedger;
  attribution: LedgerAgentAttribution | undefined;
  judgeLedgerSink: JudgeLedgerSink;
}

function buildLedgerAndSink(
  flags: AuditFlags,
  agent: AuditAgentAttribution | undefined,
): LedgerAndSink {
  const runId = `audit-${crypto.randomUUID()}`;
  const ledgerPath =
    flags.ledgerPath !== undefined
      ? flags.ledgerPath
      : path.join('.swarm', 'ledger', `${runId}.jsonl`);
  const ledger = new HashChainedLedger(ledgerPath, runId);
  const attribution = agentToLedger(agent);
  const judgeLedgerSink: JudgeLedgerSink = {
    appendJudgeEntry(entry: JudgeLedgerEntry): void {
      const payload: Omit<
        LlmJudgeResultEntry,
        'ts' | 'runId' | 'seq' | 'prevHash' | 'entryHash' | 'aiAgent'
      > = {
        type: 'llm-judge-result',
        detector: entry.detector,
        modelId: entry.modelId,
        cacheHit: entry.cacheHit,
        diffSha: entry.diffSha,
        titleSha: entry.titleSha,
        answer: entry.answer,
      };
      if (entry.reason !== undefined) {
        (payload as LlmJudgeResultEntry).reason = entry.reason;
      }
      ledger.append<LlmJudgeResultEntry>(payload);
    },
  };
  return { runId, ledgerPath, ledger, attribution, judgeLedgerSink };
}

async function runDetectors(
  flags: AuditFlags,
  inputs: AuditInputs,
  judgeLedgerSink: JudgeLedgerSink,
): Promise<AuditResult> {
  const auditInput: AuditInput = {
    unifiedDiff: inputs.unifiedDiff,
    repoRoot: inputs.effectiveRepoRoot,
    detectorSet: flags.detectorSet,
    judgeEnabled: flags.enableLlmJudge,
    judgeLedger: judgeLedgerSink,
  };
  if (inputs.agent !== undefined) auditInput.agent = inputs.agent;
  if (inputs.prContext !== undefined) auditInput.pr = inputs.prContext.prMetadata;
  try {
    return await runCheatDetectors(auditInput);
  } finally {
    inputs.fetchedManifests?.cleanup();
  }
}

/** Translate the gate decision and the resolved flags into the
 *  shadow-output, shadow, or text/json/markdown publication path and
 *  return the audit's exit code. */
function emitAuditResult(args: {
  flags: AuditFlags;
  result: AuditResult;
  prContext: PrContext | undefined;
  runId: string;
  ledgerPath: string;
  wallTimeMs: number;
  decision: { blocked: boolean; blockingTriggers: BlockTrigger[] };
}): number {
  const { flags, result, prContext, runId, ledgerPath, wallTimeMs, decision } = args;
  // --shadow-output: write the v10.3 single-file schema and exit
  // without posting a comment or affecting the merge gate. Resolved
  // before --shadow so a caller can pass both flags and get both
  // outputs from a single run.
  if (flags.shadowOutput !== undefined) {
    const entry = buildShadowOutput({
      prRef: flags.prRef ?? null,
      durationMs: wallTimeMs,
      result,
      mode: flags.mode,
      ledgerPath,
      ledgerUrl: ledgerPath,
    });
    writeShadowOutputFile(flags.shadowOutput, entry);
    logger.info(`shadow-output: wrote ${flags.shadowOutput}`);
    return 0;
  }
  // Shadow mode: record the verdict to disk for later analysis against
  // the human merge decision, suppress text output (the operator does
  // not want this surfaced as a CI signal), and never block.
  if (flags.shadow !== undefined) {
    writeShadowEntry(flags.shadowDir, flags.shadow, runId, {
      mode: flags.mode,
      detectorSet: flags.detectorSet,
      result,
      wallTimeMs,
      pr: prContext?.prMetadata,
    });
    return 0;
  }
  emitOutput(flags.output, result, ledgerPath, flags.mode, decision.blockingTriggers);
  if (flags.mode === 'advise') return 0;
  return decision.blocked ? 1 : 0;
}

async function runAudit(flags: AuditFlags): Promise<number> {
  const startedAt = Date.now();
  const inputs = await loadAuditInputs(flags);
  // Ledger is created up-front so the judge can write
  // `llm-judge-result` entries onto the same hash chain as the audit
  // metadata. We capture the started entry once we know the detector
  // versions; the judge entries are appended in between by the engine.
  const { runId, ledgerPath, ledger, attribution, judgeLedgerSink } = buildLedgerAndSink(
    flags,
    inputs.agent,
  );
  const result = await runDetectors(flags, inputs, judgeLedgerSink);
  const wallTimeMs = Date.now() - startedAt;

  ledger.append<PrAuditStartedEntry>(
    {
      type: 'pr-audit-started',
      prNumber: inputs.prContext?.prMetadata.number ?? null,
      prRepository: inputs.prContext?.prMetadata.repository ?? null,
      prHeadSha: inputs.prContext?.prMetadata.headSha ?? '',
      prBaseSha: inputs.prContext?.prMetadata.baseSha ?? '',
      detectorsScheduled: Object.keys(result.detectorVersions),
    },
    attribution !== undefined ? { aiAgent: attribution } : undefined,
  );

  // Execution-grounded layer (opt-in, advisory). Only meaningful for --pr
  // audits, where we have the repo and the head/base commits to provision a
  // sandboxed checkout. Defaults off; a failure here is logged and does not
  // fail the audit (the findings ship advisory and never gate).
  const auditConfig = loadAuditConfig(flags.repoRoot);
  let egOutcome: ExecutionGroundedOutcome | undefined;
  if (auditConfig.executionGrounded.enabled && inputs.prContext !== undefined) {
    egOutcome = await runExecutionGroundedLayer({
      result,
      prContext: inputs.prContext,
      unifiedDiff: inputs.unifiedDiff,
      config: auditConfig.executionGrounded,
      ledger,
      attribution,
    });
  }

  // Everything published from here on (the pass flag, the ledger entries,
  // the gate decision, the shadow outputs, the rendered comment) works from
  // the findings' final post-execution state; the seam owns that ordering.
  const decision = publishAuditVerdict(
    { ledger, result, attribution, pr: inputs.prContext?.prMetadata, wallTimeMs },
    (pass) => {
      // Verifiable-evidence block triggers. Built from the execution-grounded
      // outcome's runtime facts and recorded to the ledger whether or not they
      // gate. A trigger affects the exit code only in gate mode, only when its
      // kind is block-eligible, and (for the self-certifying tier) only when its
      // per-instance controls are all green; the decision owns that filter, so
      // the ledger records each trigger's actual blocking state, not just its
      // eligibility.
      const blockTriggers =
        egOutcome !== undefined && inputs.prContext !== undefined
          ? buildBlockTriggers(egOutcome, result, inputs.prContext, flags.prRef)
          : [];
      const triggerDecision = decideBlock(blockTriggers, flags.mode, pass);
      const blockedTriggers = new Set(triggerDecision.blockingTriggers);
      for (const trigger of blockTriggers) {
        appendBlockTriggerEntry(
          ledger,
          trigger,
          { eligible: isBlockEligible(trigger.kind), blocked: blockedTriggers.has(trigger) },
          attribution,
        );
      }
      return triggerDecision;
    },
  );

  if (flags.emitAibom !== undefined) {
    await emitAibom(flags.emitAibom, flags.aibomPath, ledgerPath, runId);
  }

  return emitAuditResult({
    flags,
    result,
    prContext: inputs.prContext,
    runId,
    ledgerPath,
    wallTimeMs,
    decision,
  });
}

async function loadDiff(flags: AuditFlags): Promise<string> {
  if (flags.diffFile !== undefined) {
    if (!fs.existsSync(flags.diffFile)) {
      throw new SwarmError(`diff file not found: ${flags.diffFile}`, 'AUDIT_INPUT', {
        remediation: 'Try: check the path or use --pr instead',
      });
    }
    return fs.readFileSync(flags.diffFile, 'utf8');
  }
  if (flags.diffStdin) {
    return readStdin();
  }
  if (flags.prRef !== undefined) {
    const ref = parsePrRef(flags.prRef);
    return fetchPrDiffViaGithub(ref);
  }
  throw new SwarmError('no diff source available', 'AUDIT_INPUT', {
    remediation: 'Try: --diff-file, --diff-stdin, or --pr <ref>',
  });
}

interface PrContext {
  prMetadata: NonNullable<AuditInput['pr']>;
  fingerprintInput: {
    prTitle: string;
    prBody: string;
    headRef: string;
    authors: string[];
    commitMessages: string[];
  };
}

async function loadPrContext(flags: AuditFlags): Promise<PrContext | undefined> {
  if (flags.prRef === undefined) return undefined;
  const ref = parsePrRef(flags.prRef);
  return await fetchPrContextViaGithub(ref);
}

async function maybeFetchManifests(
  flags: AuditFlags,
  unifiedDiff: string,
  prContext: PrContext | undefined,
): Promise<Awaited<ReturnType<typeof fetchPrManifests>>> {
  if (flags.prRef === undefined || prContext === undefined) return undefined;
  const ref = parsePrRef(flags.prRef);
  try {
    return await fetchPrManifests(ref, unifiedDiff, prContext.prMetadata.headSha);
  } catch (err) {
    // Manifest fetch is a best-effort optimization. A failure here
    // (rate-limit, auth, network) should not prevent the audit from
    // running — it just means the mock-of-hallucination detector
    // works from whatever `--repo-root` already had.
    logger.debug(
      `manifest fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

async function fetchPrContextViaGithub(ref: GithubPrRef): Promise<PrContext> {
  // Defer to pr-fetch which knows the @octokit/rest client.
  const fetched = await (await import('./pr-fetch')).fetchPrContext(ref);
  return fetched;
}

function agentToLedger(agent: AuditAgentAttribution | undefined): LedgerAgentAttribution | undefined {
  if (agent === undefined) return undefined;
  const out: LedgerAgentAttribution = { vendor: agent.vendor };
  if (agent.version !== undefined) out.version = agent.version;
  out.confidence = agent.confidence;
  out.source = agent.source;
  return out;
}

async function emitAibom(
  format: 'cyclonedx-ml' | 'spdx-ai' | 'both',
  outDir: string,
  ledgerPath: string,
  runId: string,
): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  if (format === 'cyclonedx-ml' || format === 'both') {
    const target = path.join(outDir, `${runId}.cdx.json`);
    writeCycloneDxMlBom(ledgerPath, target);
    logger.info(`AIBOM (CycloneDX-ML): ${target}`);
  }
  if (format === 'spdx-ai' || format === 'both') {
    const target = path.join(outDir, `${runId}.spdx.json`);
    writeSpdxAiProfileBom(ledgerPath, target);
    logger.info(`AIBOM (SPDX-AI): ${target}`);
  }
}

function emitOutput(
  format: AuditFlags['output'],
  result: AuditResult,
  ledgerPath: string,
  mode: AuditMode,
  blockingTriggers: BlockTrigger[],
): void {
  if (format === 'json') {
    process.stdout.write(JSON.stringify({ ...result, mode, blockingTriggers }, null, 2) + '\n');
    return;
  }
  if (format === 'markdown') {
    process.stdout.write(renderPrComment(result, { ledgerUrl: ledgerPath, mode, blockTriggers: blockingTriggers }));
    return;
  }
  const blockedByTrigger = mode === 'gate' && blockingTriggers.length > 0;
  const header = mode === 'advise'
    ? (result.findings.length === 0 ? 'ADVISORY-CLEAN' : 'ADVISORY')
    : (result.pass && !blockedByTrigger ? 'PASS' : 'BLOCK');
  const blocking = result.findings.filter((f) => f.severity === 'block').length;
  const warnings = result.findings.filter((f) => f.severity === 'warn').length;
  logger.info(`audit ${header} (mode=${mode}): ${blocking} blocking, ${warnings} warning (ledger: ${ledgerPath})`);
  for (const finding of result.findings) {
    logger.info(`  [${finding.severity}] ${finding.category}: ${finding.location.file}:${finding.location.line} — ${finding.message}`);
  }
  for (const trigger of blockingTriggers) {
    const verb = mode === 'gate' ? 'BLOCK' : 'advisory';
    logger.info(`  [${verb}] ${trigger.kind}: ${trigger.summary} reproduce: ${trigger.reproduce}`);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', (err) =>
      reject(new SwarmError(`failed to read stdin: ${err.message}`, 'AUDIT_INPUT', { cause: err })),
    );
  });
}
