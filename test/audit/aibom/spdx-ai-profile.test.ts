import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeSpdxAiProfileBom } from '../../../src/audit/aibom/spdx-ai-profile';
import { HashChainedLedger } from '../../../src/ledger/ledger';
import type {
  PrAuditStartedEntry,
  PrAuditFindingEntry,
  PrAuditCompletedEntry,
} from '../../../src/ledger/types';

function seed(): { ledgerPath: string; outPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-spdx-'));
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  const outPath = path.join(dir, 'spdx.json');
  const ledger = new HashChainedLedger(ledgerPath, 'audit-spdx-test');
  ledger.append<PrAuditStartedEntry>(
    {
      type: 'pr-audit-started',
      prNumber: 7,
      prRepository: 'owner/repo',
      prHeadSha: 'h',
      prBaseSha: 'b',
      detectorsScheduled: ['mock-of-hallucination'],
    },
    { aiAgent: { vendor: 'cursor', confidence: 'high', source: 'bot-author' } },
  );
  ledger.append<PrAuditFindingEntry>(
    {
      type: 'pr-audit-finding',
      category: 'mock-of-hallucination',
      severity: 'block',
      file: 'x.test.ts',
      line: 1,
      message: 'mocked nonexistent module',
      evidenceSha256: '0'.repeat(64),
    },
    { aiAgent: { vendor: 'cursor', confidence: 'high', source: 'bot-author' } },
  );
  ledger.append<PrAuditCompletedEntry>({
    type: 'pr-audit-completed',
    prNumber: 7,
    prRepository: 'owner/repo',
    pass: false,
    findingCount: 1,
    blockingCount: 1,
    warningCount: 0,
    detectorVersions: { 'mock-of-hallucination': '1.0.0' },
    wallTimeMs: 5,
    detail: 'block',
  });
  return { ledgerPath, outPath };
}

describe('aibom / spdx-ai-profile', () => {
  it('emits a valid SPDX 3.0 AI-Profile document', () => {
    const { ledgerPath, outPath } = seed();
    writeSpdxAiProfileBom(ledgerPath, outPath, '10.0.0');
    const doc = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.ok(Array.isArray(doc['@context']));
    assert.ok(doc['@context'].some((s: string) => s.includes('spdx-context.jsonld')));
    assert.ok(doc['@context'].some((s: string) => s.includes('ai-profile-context.jsonld')));
    const graph = doc['@graph'];
    assert.ok(Array.isArray(graph));
    const creation = graph.find((e: { '@type': string }) => e['@type'] === 'CreationInfo');
    assert.equal(creation?.specVersion, 'SPDX-3.0');
    assert.ok(creation?.profile.includes('AI'));
    const ai = graph.find((e: { '@type': string }) => e['@type'] === 'AIPackage');
    assert.equal(ai?.name, 'cursor');
    const annotation = graph.find((e: { '@type': string }) => e['@type'] === 'Annotation');
    assert.equal(annotation?.annotationType, 'review');
    const rel = graph.find((e: { '@type': string }) => e['@type'] === 'Relationship');
    assert.equal(rel?.relationshipType, 'audited');
  });
});
