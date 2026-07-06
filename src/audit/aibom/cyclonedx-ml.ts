// CycloneDX 1.6 ML-BOM emitter.
//
// Each audit run becomes one CycloneDX document. The audited agent (when
// known) is a `component` of type `machine-learning-model`; each cheat
// finding is encoded as a `vulnerability` with `affects` pointing to the
// agent component. The full evidence ledger is referenced via the
// document's `externalReferences` so a downstream procurement reviewer
// can verify the hash chain.
//
// We hand-roll the JSON rather than pull in a CycloneDX npm package —
// the schema is stable, the document is small, and the project policy
// is "no new runtime deps in Phase 1".

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { readAuditLedger, type AuditLedgerSummary } from './ledger-reader';
import type { BomIdentity } from './bom-identity';
import type { PrAuditFindingEntry, LedgerAgentAttribution } from '../../ledger/types';

export const CYCLONEDX_SPEC_VERSION = '1.6';
export const CYCLONEDX_FORMAT = 'CycloneDX';
const TOOL_NAME = 'swarm-audit';

interface ToolEntry {
  name: string;
  vendor: string;
  version: string;
}

interface ComponentEntry {
  'bom-ref': string;
  type: 'machine-learning-model' | 'application';
  name: string;
  version?: string;
  group?: string;
  description?: string;
  modelCard?: {
    properties?: Array<{ name: string; value: string }>;
  };
}

interface VulnerabilityEntry {
  'bom-ref': string;
  id: string;
  source: { name: string };
  ratings: Array<{ severity: 'critical' | 'high' | 'medium' | 'low' | 'info' }>;
  description: string;
  detail: string;
  affects: Array<{ ref: string }>;
  properties: Array<{ name: string; value: string }>;
}

interface CycloneDxDocument {
  bomFormat: typeof CYCLONEDX_FORMAT;
  specVersion: typeof CYCLONEDX_SPEC_VERSION;
  serialNumber: string;
  version: number;
  metadata: {
    timestamp: string;
    tools: ToolEntry[];
    component: ComponentEntry;
    properties?: Array<{ name: string; value: string }>;
  };
  components: ComponentEntry[];
  vulnerabilities: VulnerabilityEntry[];
  externalReferences: Array<{ type: string; url: string; hashes?: Array<{ alg: string; content: string }> }>;
}

/**
 * How the document references the audit ledger. In the default (non-pack) mode
 * the reference is the ledger's absolute file:// URL plus its content hash. In
 * an evidence pack the ledger is a per-run record (wall-clock timestamps, a
 * random runId), so pinning its varying hash inside the AIBOM would break the
 * AIBOM's replay-identity; the pack references it by a stable relative path and
 * the pack's MANIFEST pins the ledger's sha instead.
 */
export interface LedgerRefOverride {
  /** The URL to record (e.g. a relative "ledger.jsonl"). */
  readonly url: string;
  /** Whether to embed the ledger's content hash in the reference. */
  readonly pinHash: boolean;
}

/**
 * Build a CycloneDX 1.6 ML-BOM document from an audit ledger summary.
 *
 * @param summary the projected audit ledger.
 * @param ledgerFilePath path to the ledger, referenced (and hashed) as an
 *   external attestation.
 * @param toolVersion the swarm-audit version to stamp.
 * @param identity optional replay-identical identity (serialNumber, timestamp).
 *   When provided the document is a pure function of the run inputs; when
 *   omitted the serialNumber is random and the timestamp is the ledger's
 *   wall-clock time (the default, non-reproducible mode).
 * @param ledgerRef optional ledger-reference override for evidence packs; see
 *   LedgerRefOverride. Omit to reference the ledger by absolute path + hash.
 * @returns the CycloneDX document.
 */
export function buildCycloneDxMlBom(
  summary: AuditLedgerSummary,
  ledgerFilePath: string,
  toolVersion: string,
  identity?: BomIdentity,
  ledgerRef?: LedgerRefOverride,
): CycloneDxDocument {
  const subject = renderSubjectComponent(summary);
  const components: ComponentEntry[] = [subject];
  if (summary.agent !== undefined) {
    components.push(renderAgentComponent(summary.agent));
  }
  const vulnerabilities = summary.findings.map((f, idx) => renderVulnerability(f, idx, subject));
  const metadata: CycloneDxDocument['metadata'] = {
    timestamp: identity !== undefined ? identity.timestamp : summary.generatedAt,
    tools: [{ name: TOOL_NAME, vendor: 'moonrunnerkc', version: toolVersion }],
    component: subject,
  };
  if (identity !== undefined) {
    metadata.properties = [{ name: 'swarm.timestamp.basis', value: identity.timestampBasis }];
  }
  return {
    bomFormat: CYCLONEDX_FORMAT,
    specVersion: CYCLONEDX_SPEC_VERSION,
    serialNumber: identity !== undefined ? identity.serialNumber : `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata,
    components,
    vulnerabilities,
    externalReferences: renderExternalRefs(ledgerFilePath, ledgerRef),
  };
}

/**
 * Render a CycloneDX ML-BOM to disk.
 *
 * @param ledgerFilePath the audit ledger to project.
 * @param outFilePath the output path.
 * @param toolVersion the swarm-audit version (defaults to package.json).
 * @param identity optional replay-identical identity; see buildCycloneDxMlBom.
 * @param ledgerRef optional ledger-reference override for evidence packs.
 */
export function writeCycloneDxMlBom(
  ledgerFilePath: string,
  outFilePath: string,
  toolVersion: string = readPackageVersion(),
  identity?: BomIdentity,
  ledgerRef?: LedgerRefOverride,
): void {
  const summary = readAuditLedger(ledgerFilePath);
  const doc = buildCycloneDxMlBom(summary, ledgerFilePath, toolVersion, identity, ledgerRef);
  fs.mkdirSync(path.dirname(outFilePath), { recursive: true });
  fs.writeFileSync(outFilePath, JSON.stringify(doc, null, 2) + '\n', { encoding: 'utf8' });
}

function renderSubjectComponent(summary: AuditLedgerSummary): ComponentEntry {
  const repo = summary.started.prRepository ?? 'unknown-repository';
  const prNum = summary.started.prNumber ?? -1;
  const subject: ComponentEntry = {
    'bom-ref': `audit:${summary.runId}`,
    type: 'application',
    name: `${repo}#${prNum}`,
    description: `Patch audit subject for PR ${repo}#${prNum} at head ${summary.started.prHeadSha}.`,
  };
  return subject;
}

function renderAgentComponent(agent: LedgerAgentAttribution): ComponentEntry {
  const entry: ComponentEntry = {
    'bom-ref': `agent:${agent.vendor}`,
    type: 'machine-learning-model',
    name: agent.vendor,
    group: 'ai-coding-agent',
    description: `AI coding agent that opened the audited patch (signal: ${agent.source ?? 'unknown'}).`,
    modelCard: {
      properties: [
        { name: 'attribution.confidence', value: agent.confidence ?? 'unknown' },
        { name: 'attribution.source', value: agent.source ?? 'unknown' },
      ],
    },
  };
  if (agent.version !== undefined) entry.version = agent.version;
  return entry;
}

function renderVulnerability(
  finding: PrAuditFindingEntry,
  idx: number,
  subject: ComponentEntry,
): VulnerabilityEntry {
  return {
    'bom-ref': `finding:${finding.runId}:${finding.seq}`,
    id: `SWARM-${idx + 1}-${finding.category}`,
    source: { name: 'swarm-audit' },
    ratings: [{ severity: mapSeverity(finding.severity) }],
    description: finding.message,
    detail: `Detected cheat pattern: ${finding.category} (severity ${finding.severity}).`,
    affects: [{ ref: subject['bom-ref'] }],
    properties: [
      { name: 'swarm.location.file', value: finding.file },
      { name: 'swarm.location.line', value: String(finding.line) },
      { name: 'swarm.evidence.sha256', value: finding.evidenceSha256 },
      { name: 'swarm.category', value: finding.category },
    ],
  };
}

function mapSeverity(s: 'block' | 'warn' | 'info'): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (s === 'block') return 'high';
  if (s === 'warn') return 'medium';
  return 'info';
}

function renderExternalRefs(
  ledgerFilePath: string,
  ledgerRef?: LedgerRefOverride,
): CycloneDxDocument['externalReferences'] {
  // Evidence-pack mode: reference the ledger by a stable relative URL and skip
  // its per-run content hash so the AIBOM stays replay-identical.
  if (ledgerRef !== undefined) {
    if (!ledgerRef.pinHash) {
      return [{ type: 'attestation', url: ledgerRef.url }];
    }
    const content = fs.readFileSync(path.resolve(ledgerFilePath));
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    return [{ type: 'attestation', url: ledgerRef.url, hashes: [{ alg: 'SHA-256', content: sha256 }] }];
  }
  const abs = path.resolve(ledgerFilePath);
  if (!fs.existsSync(abs)) {
    return [{ type: 'attestation', url: `file://${abs}` }];
  }
  const content = fs.readFileSync(abs);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  return [
    {
      type: 'attestation',
      url: `file://${abs}`,
      hashes: [{ alg: 'SHA-256', content: sha256 }],
    },
  ];
}

function readPackageVersion(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', '..', '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: string };
      if (typeof parsed.version === 'string') return parsed.version;
    } catch (err) {
      throw new Error(`failed to read package.json at ${candidate}: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }
  return '0.0.0';
}
