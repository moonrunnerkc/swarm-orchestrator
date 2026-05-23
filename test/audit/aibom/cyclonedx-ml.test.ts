import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCycloneDxMlBom, writeCycloneDxMlBom } from '../../../src/audit/aibom/cyclonedx-ml';
import { HashChainedLedger } from '../../../src/ledger/ledger';
import type {
  PrAuditStartedEntry,
  PrAuditFindingEntry,
  PrAuditCompletedEntry,
} from '../../../src/ledger/types';

function seedLedger(): { ledgerPath: string; runId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cdx-'));
  const runId = `audit-test-${Date.now()}`;
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  const ledger = new HashChainedLedger(ledgerPath, runId);
  ledger.append<PrAuditStartedEntry>(
    {
      type: 'pr-audit-started',
      prNumber: 42,
      prRepository: 'owner/repo',
      prHeadSha: 'abc',
      prBaseSha: 'def',
      detectorsScheduled: ['test-relaxation'],
    },
    { aiAgent: { vendor: 'claude-code', confidence: 'high', source: 'bot-author', version: '4.7' } },
  );
  ledger.append<PrAuditFindingEntry>(
    {
      type: 'pr-audit-finding',
      category: 'test-relaxation',
      severity: 'block',
      file: 'foo.test.ts',
      line: 12,
      message: 'strict→loose',
      evidenceSha256: '0'.repeat(64),
    },
    { aiAgent: { vendor: 'claude-code', confidence: 'high', source: 'bot-author', version: '4.7' } },
  );
  ledger.append<PrAuditCompletedEntry>(
    {
      type: 'pr-audit-completed',
      prNumber: 42,
      prRepository: 'owner/repo',
      pass: false,
      findingCount: 1,
      blockingCount: 1,
      warningCount: 0,
      detectorVersions: { 'test-relaxation': '1.0.0' },
      wallTimeMs: 10,
      detail: 'audit block',
    },
    { aiAgent: { vendor: 'claude-code', confidence: 'high', source: 'bot-author', version: '4.7' } },
  );
  return { ledgerPath, runId };
}

describe('aibom / cyclonedx-ml', () => {
  it('builds a valid CycloneDX 1.6 ML-BOM document', () => {
    const { ledgerPath } = seedLedger();
    const dir = path.dirname(ledgerPath);
    const out = path.join(dir, 'cdx.json');
    writeCycloneDxMlBom(ledgerPath, out, '10.0.0');
    const text = fs.readFileSync(out, 'utf8');
    const doc = JSON.parse(text);
    assert.equal(doc.bomFormat, 'CycloneDX');
    assert.equal(doc.specVersion, '1.6');
    assert.ok(doc.serialNumber.startsWith('urn:uuid:'));
    assert.equal(doc.metadata.tools[0]?.name, 'swarm-audit');
    assert.equal(doc.metadata.tools[0]?.version, '10.0.0');
    assert.equal(doc.metadata.component.type, 'application');
    assert.equal(doc.components[1]?.type, 'machine-learning-model');
    assert.equal(doc.components[1]?.name, 'claude-code');
    assert.equal(doc.vulnerabilities.length, 1);
    assert.equal(doc.vulnerabilities[0]?.ratings[0]?.severity, 'high');
    assert.ok(doc.externalReferences[0]?.hashes?.[0]?.alg === 'SHA-256');
  });

  it('builds a document with no findings vulnerability list when the audit passed', () => {
    // Seed with only started+completed (no finding entry).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cdx-clean-'));
    const ledger = new HashChainedLedger(path.join(dir, 'l.jsonl'), 'audit-pass');
    ledger.append<PrAuditStartedEntry>({
      type: 'pr-audit-started',
      prNumber: 1,
      prRepository: 'o/r',
      prHeadSha: 'a',
      prBaseSha: 'b',
      detectorsScheduled: [],
    });
    ledger.append<PrAuditCompletedEntry>({
      type: 'pr-audit-completed',
      prNumber: 1,
      prRepository: 'o/r',
      pass: true,
      findingCount: 0,
      blockingCount: 0,
      warningCount: 0,
      detectorVersions: {},
      wallTimeMs: 1,
      detail: 'pass',
    });
    const summary = buildCycloneDxMlBom(
      {
        runId: 'audit-pass',
        started: {} as PrAuditStartedEntry,
        findings: [],
        completed: {} as PrAuditCompletedEntry,
        generatedAt: '2026-05-23T00:00:00.000Z',
      } as unknown as Parameters<typeof buildCycloneDxMlBom>[0],
      path.join(dir, 'l.jsonl'),
      '10.0.0',
    );
    assert.equal(summary.vulnerabilities.length, 0);
  });
});
