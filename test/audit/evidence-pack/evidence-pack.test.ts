import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assembleEvidencePack, RUN_RECORD_FILENAME } from '../../../src/audit/evidence-pack/evidence-pack';
import { verifyManifest, EVIDENCE_MANIFEST_FILENAME } from '../../../src/audit/evidence-pack/manifest';
import { buildProofCoverage } from '../../../src/audit/attestation/proof-coverage';
import { sha256File } from '../../../src/audit/evidence-pack/hashing';
import { deriveBomIdentity } from '../../../src/audit/aibom/bom-identity';
import { HashChainedLedger } from '../../../src/ledger/ledger';
import type {
  PrAuditStartedEntry,
  PrAuditFindingEntry,
  PrAuditMutationFindingEntry,
  PrAuditCoverageFindingEntry,
  PrAuditWorkVerifiedEntry,
  PrAuditCompletedEntry,
} from '../../../src/ledger/types';

const IDENTITY = deriveBomIdentity({
  repository: 'owner/repo',
  prNumber: 99,
  headSha: 'f'.repeat(40),
  baseSha: 'e'.repeat(40),
  detectorVersions: { 'test-relaxation': '1.0.0' },
  toolVersion: '12.0.0',
});

/** Seed one audit ledger with a fixed set of findings and a fixed evidence file.
 *  `runId` is varied per call so two seeds differ exactly the way two real
 *  independent audits differ (different runId + wall-clock timestamps). */
function seedAudit(runId: string): { ledgerPath: string; mutationEvidence: string; coverageEvidence: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ep-src-'));
  const mutationEvidence = path.join(dir, 'mutation.json');
  const coverageEvidence = path.join(dir, 'coverage-final.json');
  fs.writeFileSync(mutationEvidence, '{"survived":[{"file":"a.ts","line":3}]}\n');
  fs.writeFileSync(coverageEvidence, '{"a.ts":{"3":0}}\n');

  const ledgerPath = path.join(dir, 'ledger.jsonl');
  const ledger = new HashChainedLedger(ledgerPath, runId);
  ledger.append<PrAuditStartedEntry>({
    type: 'pr-audit-started',
    prNumber: 99,
    prRepository: 'owner/repo',
    prHeadSha: 'f'.repeat(40),
    prBaseSha: 'e'.repeat(40),
    detectorsScheduled: ['test-relaxation'],
  });
  ledger.append<PrAuditFindingEntry>({
    type: 'pr-audit-finding',
    category: 'test-relaxation',
    severity: 'warn',
    file: 'a.test.ts',
    line: 5,
    message: 'loosened assertion',
    evidenceSha256: '1'.repeat(64),
  });
  ledger.append<PrAuditMutationFindingEntry>({
    type: 'pr-audit-mutation-finding',
    category: 'mutation-survives-line',
    severity: 'warn',
    file: 'a.ts',
    line: 3,
    mutator: 'ConditionalExpression',
    status: 'Survived',
    evidencePath: mutationEvidence,
    evidenceSha256: sha256File(mutationEvidence),
  });
  ledger.append<PrAuditCoverageFindingEntry>({
    type: 'pr-audit-coverage-finding',
    category: 'uncovered-changed-line',
    severity: 'warn',
    file: 'a.ts',
    line: 3,
    evidencePath: coverageEvidence,
    evidenceSha256: sha256File(coverageEvidence),
  });
  ledger.append<PrAuditWorkVerifiedEntry>({
    type: 'pr-audit-work-verified',
    verdict: 'human',
    egViable: true,
    negativeGateClean: true,
    controls: [{ id: 'test-must-pass', kind: 'test', status: 'fail', detail: '1 failed' }],
    reasons: [{ code: 'positive-control-failed', detail: 'test-must-pass: 1 failed' }],
  });
  ledger.append<PrAuditCompletedEntry>({
    type: 'pr-audit-completed',
    prNumber: 99,
    prRepository: 'owner/repo',
    pass: true,
    findingCount: 3,
    blockingCount: 0,
    warningCount: 3,
    detectorVersions: { 'test-relaxation': '1.0.0' },
    wallTimeMs: 12,
    detail: 'pass',
  });
  return { ledgerPath, mutationEvidence, coverageEvidence };
}

/** The pack-relative paths that make up the replay-identical set. */
function replaySet(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const childRel = rel === '' ? name : `${rel}/${name}`;
      // ledger.jsonl and the run-record sidecar are per-run, not reproducible.
      if (childRel === 'ledger.jsonl' || childRel === RUN_RECORD_FILENAME) continue;
      const abs = path.join(dir, childRel);
      if (fs.statSync(abs).isDirectory()) walk(childRel);
      else out.push(childRel);
    }
  };
  walk('');
  return out.sort();
}

describe('evidence-pack / assembleEvidencePack', () => {
  it('lists the AIBOMs and content-addressed evidence in the MANIFEST with correct hashes', () => {
    const { ledgerPath } = seedAudit('audit-run-A');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ep-A-'));
    const result = assembleEvidencePack({ outDir, ledgerPath, toolVersion: '12.0.0', identity: IDENTITY });

    const manifestPaths = result.manifest.files.map((f) => f.path).sort();
    assert.deepEqual(manifestPaths.slice(0, 2), ['attestation/cyclonedx.json', 'attestation/spdx.json']);
    assert.equal(result.evidenceFileCount, 2);
    for (const entry of result.manifest.files) {
      assert.equal(entry.sha256, sha256File(path.join(outDir, entry.path)), `hash of ${entry.path}`);
    }
    // Verdict flows from the work-verified entry.
    assert.equal(result.manifest.verdict.merge?.verdict, 'human');
    assert.deepEqual(result.manifest.verdict.merge?.reasons, ['positive-control-failed']);
    // The run record pins the ledger sha; it is not in the MANIFEST.
    const runRecord = JSON.parse(fs.readFileSync(result.runRecordPath, 'utf8'));
    assert.equal(runRecord.ledgerSha256, sha256File(ledgerPath));
    assert.equal(
      result.manifest.files.some((f) => f.path === 'ledger.jsonl'),
      false,
      'the per-run ledger must not be in the replay-identical MANIFEST',
    );
  });

  it('produces a byte-identical replay set across two independent audits of the same PR', () => {
    const a = seedAudit('audit-run-A');
    const b = seedAudit('audit-run-B');
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ep-ra-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ep-rb-'));
    assembleEvidencePack({ outDir: dirA, ledgerPath: a.ledgerPath, toolVersion: '12.0.0', identity: IDENTITY });
    assembleEvidencePack({ outDir: dirB, ledgerPath: b.ledgerPath, toolVersion: '12.0.0', identity: IDENTITY });

    const setA = replaySet(dirA);
    const setB = replaySet(dirB);
    assert.deepEqual(setA, setB, 'the two packs list the same replay-identical files');
    for (const rel of setA) {
      const bytesA = fs.readFileSync(path.join(dirA, rel));
      const bytesB = fs.readFileSync(path.join(dirB, rel));
      assert.ok(bytesA.equals(bytesB), `${rel} must be byte-identical across the two audits`);
    }
    // The ledgers themselves DO differ (different runId), proving the replay
    // identity is not an artifact of identical source ledgers.
    assert.notEqual(sha256File(a.ledgerPath), sha256File(b.ledgerPath));
  });

  it('verifyManifest passes on a fresh pack and detects a tampered file', () => {
    const { ledgerPath } = seedAudit('audit-run-A');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ep-v-'));
    assembleEvidencePack({ outDir, ledgerPath, toolVersion: '12.0.0', identity: IDENTITY });

    assert.equal(verifyManifest(outDir).ok, true);

    const cdx = path.join(outDir, 'attestation', 'cyclonedx.json');
    fs.appendFileSync(cdx, ' ');
    const after = verifyManifest(outDir);
    assert.equal(after.ok, false);
    assert.equal(after.mismatches[0]?.path, 'attestation/cyclonedx.json');
  });

  it('content-addresses the proof-coverage attestation into the MANIFEST', () => {
    const { ledgerPath } = seedAudit('audit-run-A');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ep-att-'));
    const proofCoverage = buildProofCoverage({
      findings: [],
      mutationRuns: [],
      coverageRuns: [],
      repros: [],
      restorations: [],
      mockRestorations: [],
      noOpRestorations: [],
      typeSuppressionRestorations: [],
      fakeRefactorRestorations: [],
      deadBranchRestorations: [],
      claimDifferentials: [],
      skipped: ['provision: no lockfile'],
    } as never);
    const result = assembleEvidencePack({
      outDir,
      ledgerPath,
      toolVersion: '12.0.0',
      identity: IDENTITY,
      proofCoverage,
    });

    const coverage = result.manifest.files.find((f) => f.path === 'attestation/proof-coverage.json');
    assert.ok(coverage, 'the attestation must be listed in the MANIFEST');
    assert.equal(coverage.role, 'attestation');
    assert.equal(coverage.sha256, sha256File(path.join(outDir, 'attestation/proof-coverage.json')));
    // The written file records what the silence covers (the provisioning miss).
    const written = JSON.parse(fs.readFileSync(path.join(outDir, 'attestation/proof-coverage.json'), 'utf8'));
    assert.equal(written.provisioning.provisioned, false);
    assert.equal(written.provisioning.reason, 'no lockfile');
    assert.equal(verifyManifest(outDir).ok, true);
  });

  it('omits the attestation file when no proof coverage is supplied', () => {
    const { ledgerPath } = seedAudit('audit-run-A');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ep-noatt-'));
    const result = assembleEvidencePack({ outDir, ledgerPath, toolVersion: '12.0.0', identity: IDENTITY });
    assert.equal(
      result.manifest.files.some((f) => f.path === 'attestation/proof-coverage.json'),
      false,
    );
  });

  it('throws when the ledger has no audit metadata to attest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ep-empty-'));
    const ledgerPath = path.join(dir, 'empty.jsonl');
    new HashChainedLedger(ledgerPath, 'audit-empty');
    assert.throws(
      () => assembleEvidencePack({ outDir: path.join(dir, 'pack'), ledgerPath, toolVersion: '12.0.0', identity: IDENTITY }),
      /nothing to attest/,
    );
  });
});
