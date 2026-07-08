// Assemble a replay-identical evidence pack for a --pr audit.
//
// A pack is a self-contained directory a procurement reviewer can archive and
// re-verify offline. Its layout:
//
//   attestation/cyclonedx.json   replay-identical CycloneDX ML-BOM
//   attestation/spdx.json        replay-identical SPDX 3.0 AI-Profile
//   evidence/<sha256><ext>       content-addressed raw execution-grounded bytes
//   MANIFEST.json                integrity index over the reproducible files
//   ledger.jsonl                 the run's hash-chained ledger (run record)
//   run-record.json              the ledger's sha + runId (run record sidecar)
//
// Everything except ledger.jsonl and run-record.json is a pure function of the
// audit's inputs and conclusions, so two audits of the same PR head produce
// byte-identical files there. The ledger is a genuine per-run artifact (real
// timestamps, a random runId); it is not claimed as reproducible, its integrity
// is its own hash chain, and its sha is pinned in run-record.json.

import * as fs from 'fs';
import * as path from 'path';
import { SwarmError } from '../../errors';
import { readEntries } from '../../ledger/ledger';
import { writeCycloneDxMlBom } from '../aibom/cyclonedx-ml';
import { writeSpdxAiProfileBom } from '../aibom/spdx-ai-profile';
import type { BomIdentity } from '../aibom/bom-identity';
import { serializeProofCoverage, type ProofCoverageAttestation } from '../attestation/proof-coverage';
import { sha256File } from './hashing';
import {
  buildManifest,
  serializeManifest,
  EVIDENCE_MANIFEST_FILENAME,
  type EvidenceManifest,
  type ManifestFileRole,
  type ManifestSubject,
  type ManifestVerdict,
} from './manifest';
import type {
  LedgerEntry,
  PrAuditStartedEntry,
  PrAuditCompletedEntry,
  PrAuditWorkVerifiedEntry,
} from '../../ledger/types';

export const RUN_RECORD_FILENAME = 'run-record.json';
const LEDGER_FILENAME = 'ledger.jsonl';

export interface AssembleEvidencePackInput {
  /** Directory to create the pack in. Created if absent; must be empty or new. */
  readonly outDir: string;
  /** The source audit ledger to project and copy. */
  readonly ledgerPath: string;
  /** The swarm-audit version to stamp. */
  readonly toolVersion: string;
  /** The replay-identical AIBOM identity derived from the run inputs. */
  readonly identity: BomIdentity;
  /** The proof-coverage attestation (what the proof engines proved, exonerated,
   *  or abstained on). Written into the pack as a content-addressed attestation
   *  file. A pure function of the audit inputs, so it stays replay-identical. */
  readonly proofCoverage?: ProofCoverageAttestation;
}

export interface EvidencePackResult {
  readonly packDir: string;
  readonly manifest: EvidenceManifest;
  /** Distinct content-addressed evidence files copied in. */
  readonly evidenceFileCount: number;
  readonly runRecordPath: string;
}

/**
 * Assemble an evidence pack from an audit ledger.
 *
 * @param input the output dir, source ledger, tool version, and pinned identity.
 * @returns the pack directory, the written MANIFEST, and counts.
 * @throws {SwarmError} if the ledger lacks a pr-audit-started entry (nothing to
 *   attest) or an evidence file it references cannot be read.
 */
export function assembleEvidencePack(input: AssembleEvidencePackInput): EvidencePackResult {
  const entries = readEntries(input.ledgerPath);
  const started = entries.find((e): e is PrAuditStartedEntry => e.type === 'pr-audit-started');
  if (started === undefined) {
    throw new SwarmError(
      `ledger ${input.ledgerPath} has no pr-audit-started entry; nothing to attest`,
      'EVIDENCE_PACK_NO_AUDIT',
      { remediation: 'Run `swarm audit --pr <ref>` to produce an audit ledger first' },
    );
  }

  const packDir = input.outDir;
  const attestationDir = path.join(packDir, 'attestation');
  const evidenceDir = path.join(packDir, 'evidence');
  fs.mkdirSync(attestationDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  // The run ledger, copied verbatim as the run record.
  fs.copyFileSync(input.ledgerPath, path.join(packDir, LEDGER_FILENAME));

  // Replay-identical AIBOMs. The CycloneDX ledger reference points at the
  // in-pack ledger by a stable relative URL with no per-run hash, so the AIBOM
  // stays reproducible.
  const cdxRel = 'attestation/cyclonedx.json';
  const spdxRel = 'attestation/spdx.json';
  writeCycloneDxMlBom(input.ledgerPath, path.join(packDir, cdxRel), input.toolVersion, input.identity, {
    url: `../${LEDGER_FILENAME}`,
    pinHash: false,
  });
  writeSpdxAiProfileBom(input.ledgerPath, path.join(packDir, spdxRel), input.toolVersion, input.identity);

  // Proof-coverage attestation: a replay-identical statement of what the proof
  // engines proved, exonerated, or abstained on, so a policy reading the pack
  // knows what "no findings" covers. Optional so pre-attestation callers keep
  // working; when present it is content-addressed into the MANIFEST like the AIBOMs.
  const attestationFiles: Array<{ path: string; role: ManifestFileRole }> = [];
  if (input.proofCoverage !== undefined) {
    const coverageRel = 'attestation/proof-coverage.json';
    fs.writeFileSync(path.join(packDir, coverageRel), serializeProofCoverage(input.proofCoverage), 'utf8');
    attestationFiles.push({ path: coverageRel, role: 'attestation' });
  }

  const evidenceFiles = copyEvidence(entries, evidenceDir);

  const files: Array<{ path: string; role: ManifestFileRole }> = [
    { path: cdxRel, role: 'attestation' },
    { path: spdxRel, role: 'attestation' },
    ...attestationFiles,
    ...evidenceFiles.map((rel) => ({ path: rel, role: 'evidence' as const })),
  ];

  const manifest = buildManifest({
    packDir,
    subject: subjectOf(started),
    toolVersion: input.toolVersion,
    identity: {
      serialNumber: input.identity.serialNumber,
      timestamp: input.identity.timestamp,
      timestampBasis: input.identity.timestampBasis,
    },
    verdict: verdictOf(entries),
    files,
  });
  fs.writeFileSync(path.join(packDir, EVIDENCE_MANIFEST_FILENAME), serializeManifest(manifest), 'utf8');

  const runRecordPath = path.join(packDir, RUN_RECORD_FILENAME);
  fs.writeFileSync(runRecordPath, serializeRunRecord(started.runId, input.ledgerPath), 'utf8');

  return { packDir, manifest, evidenceFileCount: evidenceFiles.length, runRecordPath };
}

/** Copy each referenced raw evidence file into evidence/ under a
 *  content-addressed name (`<sha256><ext>`), deduplicating identical bytes.
 *  Returns the distinct pack-relative POSIX paths, sorted. */
function copyEvidence(entries: readonly LedgerEntry[], evidenceDir: string): string[] {
  const seen = new Map<string, string>();
  for (const abs of evidencePaths(entries)) {
    if (!fs.existsSync(abs)) continue;
    const sha = sha256File(abs);
    const ext = path.extname(abs);
    const destName = `${sha}${ext}`;
    if (!seen.has(destName)) {
      fs.copyFileSync(abs, path.join(evidenceDir, destName));
      seen.set(destName, `evidence/${destName}`);
    }
  }
  return [...seen.values()].sort();
}

/** The distinct absolute evidence paths referenced by the ledger's
 *  execution-grounded finding entries. */
function evidencePaths(entries: readonly LedgerEntry[]): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    if (
      e.type === 'pr-audit-mutation-finding' ||
      e.type === 'pr-audit-coverage-finding' ||
      e.type === 'pr-audit-issue-repro-finding'
    ) {
      if (e.evidencePath !== undefined) out.add(path.resolve(e.evidencePath));
    }
  }
  return [...out];
}

function subjectOf(started: PrAuditStartedEntry): ManifestSubject {
  return {
    repository: started.prRepository ?? 'unknown-repository',
    prNumber: started.prNumber,
    headSha: started.prHeadSha,
    baseSha: started.prBaseSha,
  };
}

/** The two-sided verdict from the ledger: the positive gate's work-verified
 *  entry when present, else the negative gate's pass flag alone. */
function verdictOf(entries: readonly LedgerEntry[]): ManifestVerdict {
  const work = entries.find(
    (e): e is PrAuditWorkVerifiedEntry => e.type === 'pr-audit-work-verified',
  );
  if (work !== undefined) {
    return {
      negativeGateClean: work.negativeGateClean,
      merge: { verdict: work.verdict, reasons: work.reasons.map((r) => r.code) },
    };
  }
  const completed = entries.find(
    (e): e is PrAuditCompletedEntry => e.type === 'pr-audit-completed',
  );
  return { negativeGateClean: completed?.pass ?? false };
}

/** The run-record sidecar: the per-run facts (runId, ledger sha) deliberately
 *  kept out of the replay-identical MANIFEST. */
function serializeRunRecord(runId: string, ledgerPath: string): string {
  const record = {
    schema: 'swarm-evidence-pack-run-record/v1',
    runId,
    ledgerFile: LEDGER_FILENAME,
    ledgerSha256: sha256File(ledgerPath),
    note:
      'Per-run record. The ledger has real timestamps and a random runId, so ' +
      'these bytes vary across runs and are not part of the replay-identical set. ' +
      'Ledger integrity is its own hash chain (verifyChain); this sha pins the copy.',
  };
  return JSON.stringify(record, null, 2) + '\n';
}
