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
  JudgeLedgerEntry,
  JudgeLedgerSink,
} from '../../audit/types';
import type {
  LedgerAgentAttribution,
  LlmJudgeResultEntry,
  PrAuditStartedEntry,
  PrAuditFindingEntry,
  PrAuditCompletedEntry,
} from '../../ledger/types';
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

  // For --pr audits, the user's cwd has no relationship to the target
  // repo, so the cheat-detector's manifest readers would see swarm's
  // own package.json instead of the PR's actual manifest(s). Fetch the
  // candidate manifests via the GitHub Contents API and run the audit
  // with `repoRoot` pointed at the resulting temp tree. For other
  // input modes (--diff-file, --diff-stdin), the caller's --repo-root
  // is the right answer.
  const fetchedManifests = await maybeFetchManifests(flags, unifiedDiff, prContext);
  const effectiveRepoRoot =
    fetchedManifests !== undefined ? fetchedManifests.tempRoot : flags.repoRoot;

  // Ledger is created up-front so the judge can write
  // `llm-judge-result` entries onto the same hash chain as the audit
  // metadata. We capture the started entry once we know the detector
  // versions; the judge entries are appended in between by the engine.
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

  const auditInput: AuditInput = {
    unifiedDiff,
    repoRoot: effectiveRepoRoot,
    detectorSet: flags.detectorSet,
    judgeEnabled: flags.enableLlmJudge,
    judgeLedger: judgeLedgerSink,
  };
  if (agent !== undefined) auditInput.agent = agent;
  if (prContext !== undefined) auditInput.pr = prContext.prMetadata;

  let result: AuditResult;
  try {
    result = await runCheatDetectors(auditInput);
  } finally {
    fetchedManifests?.cleanup();
  }
  const wallTimeMs = Date.now() - startedAt;

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

  emitOutput(flags.output, result, ledgerPath, flags.mode);

  if (flags.mode === 'advise') return 0;
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
): void {
  if (format === 'json') {
    process.stdout.write(JSON.stringify({ ...result, mode }, null, 2) + '\n');
    return;
  }
  if (format === 'markdown') {
    process.stdout.write(renderPrComment(result, { ledgerUrl: ledgerPath, mode }));
    return;
  }
  const header = mode === 'advise'
    ? (result.findings.length === 0 ? 'ADVISORY-CLEAN' : 'ADVISORY')
    : (result.pass ? 'PASS' : 'BLOCK');
  const blocking = result.findings.filter((f) => f.severity === 'block').length;
  const warnings = result.findings.filter((f) => f.severity === 'warn').length;
  logger.info(`audit ${header} (mode=${mode}): ${blocking} blocking, ${warnings} warning (ledger: ${ledgerPath})`);
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
