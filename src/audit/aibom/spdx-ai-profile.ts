// SPDX 3.0 AI-Profile emitter.
//
// Each audit run becomes one SPDX document carrying:
//   - one SoftwareApplication for the audited patch
//   - one AIPackage element for the detected agent (when known)
//   - one Annotation per cheat finding, AI-Profile-compliant
//   - one Relationship of type `audited` from the agent to the patch
//
// Hand-rolled JSON to match the project's no-new-runtime-deps stance.
// Tracks the SPDX 3.0 spec field names: `spdxId`, `creationInfo`,
// `type`, `name`, `releaseTime`, etc. Documents emit valid against the
// SPDX 3.0 JSON-LD context.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { readAuditLedger, type AuditLedgerSummary } from './ledger-reader';
import type { PrAuditFindingEntry, LedgerAgentAttribution } from '../../ledger/types';

export const SPDX_SPEC_VERSION = 'SPDX-3.0';
export const SPDX_AI_PROFILE = 'AI';

interface SpdxCreationInfo {
  '@id': string;
  '@type': 'CreationInfo';
  specVersion: typeof SPDX_SPEC_VERSION;
  created: string;
  createdBy: Array<{ '@id': string; '@type': 'Tool'; name: string; version: string }>;
  profile: string[];
}

interface SpdxElement {
  '@id': string;
  '@type': string;
  name: string;
  creationInfo: string;
  releaseTime?: string;
  summary?: string;
  description?: string;
  packageVersion?: string;
}

interface SpdxAnnotation {
  '@id': string;
  '@type': 'Annotation';
  annotationType: 'review' | 'other';
  contentType: 'text/plain';
  statement: string;
  subject: { '@id': string };
  creationInfo: string;
}

interface SpdxRelationship {
  '@id': string;
  '@type': 'Relationship';
  relationshipType: string;
  from: { '@id': string };
  to: Array<{ '@id': string }>;
  creationInfo: string;
}

interface SpdxDocument {
  '@context': string[];
  '@graph': Array<SpdxCreationInfo | SpdxElement | SpdxAnnotation | SpdxRelationship>;
}

const SPDX_CONTEXT = [
  'https://spdx.org/rdf/3.0.0/spdx-context.jsonld',
  'https://spdx.org/rdf/3.0.0/ai-profile-context.jsonld',
];

export function buildSpdxAiProfileBom(
  summary: AuditLedgerSummary,
  toolVersion: string,
): SpdxDocument {
  const creationInfoId = `_:creation-${summary.runId}`;
  const creationInfo: SpdxCreationInfo = {
    '@id': creationInfoId,
    '@type': 'CreationInfo',
    specVersion: SPDX_SPEC_VERSION,
    created: summary.generatedAt,
    createdBy: [
      {
        '@id': `_:tool-swarm-audit`,
        '@type': 'Tool',
        name: 'swarm-audit',
        version: toolVersion,
      },
    ],
    profile: ['core', SPDX_AI_PROFILE],
  };

  const subject = renderSubject(summary, creationInfoId);
  const graph: SpdxDocument['@graph'] = [creationInfo, subject];

  if (summary.agent !== undefined) {
    const agentElement = renderAgent(summary.agent, creationInfoId);
    graph.push(agentElement);
    graph.push(renderRelationship('audited', agentElement['@id'], subject['@id'], creationInfoId, summary.runId, 0));
  }

  let idx = 0;
  for (const finding of summary.findings) {
    graph.push(renderFindingAnnotation(finding, subject['@id'], creationInfoId, summary.runId, idx));
    idx += 1;
  }

  return { '@context': SPDX_CONTEXT, '@graph': graph };
}

export function writeSpdxAiProfileBom(
  ledgerFilePath: string,
  outFilePath: string,
  toolVersion: string = readPackageVersion(),
): void {
  const summary = readAuditLedger(ledgerFilePath);
  const doc = buildSpdxAiProfileBom(summary, toolVersion);
  fs.mkdirSync(path.dirname(outFilePath), { recursive: true });
  fs.writeFileSync(outFilePath, JSON.stringify(doc, null, 2) + '\n', { encoding: 'utf8' });
}

function renderSubject(summary: AuditLedgerSummary, creationInfoId: string): SpdxElement {
  const repo = summary.started.prRepository ?? 'unknown-repository';
  const prNum = summary.started.prNumber ?? -1;
  return {
    '@id': `spdx:subject:${summary.runId}`,
    '@type': 'SoftwareApplication',
    name: `${repo}#${prNum}`,
    creationInfo: creationInfoId,
    releaseTime: summary.started.ts,
    summary: `PR audit subject ${repo}#${prNum} at head ${summary.started.prHeadSha}.`,
  };
}

function renderAgent(agent: LedgerAgentAttribution, creationInfoId: string): SpdxElement {
  const element: SpdxElement = {
    '@id': `spdx:agent:${agent.vendor}`,
    '@type': 'AIPackage',
    name: agent.vendor,
    creationInfo: creationInfoId,
    description: `AI coding agent attributed by signal "${agent.source ?? 'unknown'}" with ${agent.confidence ?? 'unknown'} confidence.`,
  };
  if (agent.version !== undefined) element.packageVersion = agent.version;
  return element;
}

function renderFindingAnnotation(
  finding: PrAuditFindingEntry,
  subjectId: string,
  creationInfoId: string,
  runId: string,
  idx: number,
): SpdxAnnotation {
  return {
    '@id': `spdx:annotation:${runId}:${idx}`,
    '@type': 'Annotation',
    annotationType: finding.severity === 'block' ? 'review' : 'other',
    contentType: 'text/plain',
    statement:
      `[${finding.severity.toUpperCase()}] ${finding.category}: ${finding.file}:${finding.line} — ` +
      `${finding.message} (evidence sha256: ${finding.evidenceSha256})`,
    subject: { '@id': subjectId },
    creationInfo: creationInfoId,
  };
}

function renderRelationship(
  relationshipType: string,
  fromId: string,
  toId: string,
  creationInfoId: string,
  runId: string,
  idx: number,
): SpdxRelationship {
  return {
    '@id': `spdx:relationship:${runId}:${idx}`,
    '@type': 'Relationship',
    relationshipType,
    from: { '@id': fromId },
    to: [{ '@id': toId }],
    creationInfo: creationInfoId,
  };
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

// Crypto reference kept for future inline-evidence-hash use.
void crypto;
