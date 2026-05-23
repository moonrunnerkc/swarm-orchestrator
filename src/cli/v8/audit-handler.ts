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
 *   0 — no blocking findings
 *   1 — at least one blocking finding (the merge gate)
 *   2 — usage error or unrecoverable failure
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getLogger } from '../../logger';
import { runParseArgs, readBoolean, readString, type ParseArgsOptions } from './argv-schema';
import { runCheatDetectors } from '../../audit/cheat-detector';
import { detectAgent } from '../../audit/pr-source';
import { renderPrComment } from '../../audit/report-comment';
import { writeCycloneDxMlBom } from '../../audit/aibom/cyclonedx-ml';
import { writeSpdxAiProfileBom } from '../../audit/aibom/spdx-ai-profile';
import { HashChainedLedger } from '../../ledger/ledger';
import { SwarmError } from '../../errors';
import type { AuditInput, AuditResult, AuditAgentAttribution } from '../../audit/types';
import type {
  LedgerAgentAttribution,
  PrAuditStartedEntry,
  PrAuditFindingEntry,
  PrAuditCompletedEntry,
} from '../../ledger/types';
import { fetchPrDiffViaGithub, parsePrRef, type GithubPrRef } from './pr-fetch';

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
  '  --repo-root <path>        repo checkout for manifest / test-import lookups (default: cwd)',
  "  --output <fmt>            text (default) | json | markdown",
  '  --emit-aibom <fmt>        cyclonedx-ml | spdx-ai | both',
  '  --aibom-out <path>        directory for AIBOM artifacts (default: .swarm/aibom)',
  '  --ledger-path <path>      override audit ledger file (default: .swarm/ledger/audit-<runId>.jsonl)',
  '  --help, -h                show this message',
  '',
  'exit codes:',
  '  0 — pass (no blocking findings)',
  '  1 — block (one or more blocking findings)',
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

  const flags: AuditFlags = {
    diffStdin: readBoolean(values, 'diff-stdin'),
    repoRoot: readString(values, 'repo-root') ?? process.cwd(),
    output: parseOutput(readString(values, 'output')),
    aibomPath: readString(values, 'aibom-out') ?? '.swarm/aibom',
    helpRequested: false,
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

async function runAudit(flags: AuditFlags): Promise<number> {
  const startedAt = Date.now();
  const unifiedDiff = await loadDiff(flags);
  const prContext = await loadPrContext(flags);
  const agent = prContext !== undefined ? detectAgent(prContext.fingerprintInput) : undefined;

  const auditInput: AuditInput = {
    unifiedDiff,
    repoRoot: flags.repoRoot,
  };
  if (agent !== undefined) auditInput.agent = agent;
  if (prContext !== undefined) auditInput.pr = prContext.prMetadata;

  const result = runCheatDetectors(auditInput);
  const wallTimeMs = Date.now() - startedAt;

  const runId = `audit-${crypto.randomUUID()}`;
  const ledgerPath =
    flags.ledgerPath !== undefined
      ? flags.ledgerPath
      : path.join('.swarm', 'ledger', `${runId}.jsonl`);
  const ledger = new HashChainedLedger(ledgerPath, runId);
  const attribution = agentToLedger(agent);

  ledger.append<PrAuditStartedEntry>(
    {
      type: 'pr-audit-started',
      prNumber: prContext?.prMetadata.number ?? null,
      prRepository: prContext?.prMetadata.repository ?? null,
      prHeadSha: prContext?.prMetadata.headSha ?? '',
      prBaseSha: prContext?.prMetadata.baseSha ?? '',
      detectorsScheduled: Object.keys(result.detectorVersions),
    },
    attribution !== undefined ? { aiAgent: attribution } : undefined,
  );

  for (const finding of result.findings) {
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
    ledger.append<PrAuditFindingEntry>(
      payload,
      attribution !== undefined ? { aiAgent: attribution } : undefined,
    );
  }

  ledger.append<PrAuditCompletedEntry>(
    {
      type: 'pr-audit-completed',
      prNumber: prContext?.prMetadata.number ?? null,
      prRepository: prContext?.prMetadata.repository ?? null,
      pass: result.pass,
      findingCount: result.findings.length,
      blockingCount: result.findings.filter((f) => f.severity === 'block').length,
      warningCount: result.findings.filter((f) => f.severity === 'warn').length,
      detectorVersions: result.detectorVersions,
      wallTimeMs,
      detail: result.pass
        ? `audit pass — ${result.findings.length} non-blocking finding(s)`
        : `audit block — ${result.findings.filter((f) => f.severity === 'block').length} blocking finding(s)`,
    },
    attribution !== undefined ? { aiAgent: attribution } : undefined,
  );

  if (flags.emitAibom !== undefined) {
    await emitAibom(flags.emitAibom, flags.aibomPath, ledgerPath, runId);
  }

  emitOutput(flags.output, result, ledgerPath);

  return result.pass ? 0 : 1;
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

function emitOutput(format: AuditFlags['output'], result: AuditResult, ledgerPath: string): void {
  if (format === 'json') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (format === 'markdown') {
    process.stdout.write(renderPrComment(result, { ledgerUrl: ledgerPath }));
    return;
  }
  const header = result.pass ? 'PASS' : 'BLOCK';
  const blocking = result.findings.filter((f) => f.severity === 'block').length;
  const warnings = result.findings.filter((f) => f.severity === 'warn').length;
  logger.info(`audit ${header}: ${blocking} blocking, ${warnings} warning (ledger: ${ledgerPath})`);
  for (const finding of result.findings) {
    logger.info(`  [${finding.severity}] ${finding.category}: ${finding.location.file}:${finding.location.line} — ${finding.message}`);
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
