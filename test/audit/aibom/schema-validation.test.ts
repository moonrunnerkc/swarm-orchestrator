import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv';
import { writeCycloneDxMlBom } from '../../../src/audit/aibom/cyclonedx-ml';
import { writeSpdxAiProfileBom } from '../../../src/audit/aibom/spdx-ai-profile';
import { HashChainedLedger } from '../../../src/ledger/ledger';
import type {
  PrAuditStartedEntry,
  PrAuditFindingEntry,
  PrAuditCompletedEntry,
} from '../../../src/ledger/types';

// Local schemas are intentionally minimal — they assert the shape Swarm
// emits, not full upstream-spec validation. Full upstream-spec validation
// would require committing or fetching the multi-megabyte CycloneDX
// 1.6 + SPDX 3.0 JSON Schemas, which is out of scope for unit tests.
// The schemas here cover the structural invariants downstream tools key
// off of (bomFormat, specVersion, @context, top-level required fields).

const CYCLONEDX_MIN_SCHEMA = {
  type: 'object',
  required: ['bomFormat', 'specVersion', 'serialNumber', 'version', 'metadata', 'components', 'vulnerabilities'],
  properties: {
    bomFormat: { const: 'CycloneDX' },
    specVersion: { const: '1.6' },
    serialNumber: { type: 'string', pattern: '^urn:uuid:' },
    version: { type: 'integer' },
    metadata: {
      type: 'object',
      required: ['timestamp', 'tools', 'component'],
      properties: {
        timestamp: { type: 'string' },
        tools: { type: 'array', minItems: 1 },
        component: { type: 'object' },
      },
    },
    components: {
      type: 'array',
      items: {
        type: 'object',
        required: ['bom-ref', 'type', 'name'],
      },
    },
    vulnerabilities: {
      type: 'array',
      items: {
        type: 'object',
        required: ['bom-ref', 'id', 'source', 'ratings', 'description', 'affects', 'properties'],
      },
    },
    externalReferences: { type: 'array' },
  },
};

const SPDX_MIN_SCHEMA = {
  type: 'object',
  required: ['@context', '@graph'],
  properties: {
    '@context': { type: 'array', minItems: 1 },
    '@graph': {
      type: 'array',
      contains: {
        type: 'object',
        properties: {
          '@type': { const: 'CreationInfo' },
          specVersion: { const: 'SPDX-3.0' },
        },
        required: ['@type', 'specVersion'],
      },
    },
  },
};

function seedLedger(): { ledgerPath: string; outDir: string } {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-schema-'));
  const ledgerPath = path.join(outDir, 'ledger.jsonl');
  const ledger = new HashChainedLedger(ledgerPath, 'audit-schema-test');
  ledger.append<PrAuditStartedEntry>(
    {
      type: 'pr-audit-started',
      prNumber: 1,
      prRepository: 'o/r',
      prHeadSha: 'a',
      prBaseSha: 'b',
      detectorsScheduled: ['test-relaxation'],
    },
    { aiAgent: { vendor: 'claude-code', confidence: 'high', source: 'bot-author' } },
  );
  ledger.append<PrAuditFindingEntry>({
    type: 'pr-audit-finding',
    category: 'test-relaxation',
    severity: 'block',
    file: 'foo.test.ts',
    line: 10,
    message: 'strict→loose',
    evidenceSha256: '0'.repeat(64),
  });
  ledger.append<PrAuditCompletedEntry>({
    type: 'pr-audit-completed',
    prNumber: 1,
    prRepository: 'o/r',
    pass: false,
    findingCount: 1,
    blockingCount: 1,
    warningCount: 0,
    detectorVersions: { 'test-relaxation': '1.0.0' },
    wallTimeMs: 10,
    detail: 'block',
  });
  return { ledgerPath, outDir };
}

describe('aibom / schema validation', () => {
  it('CycloneDX-ML output validates against the structural-invariants schema', () => {
    const { ledgerPath, outDir } = seedLedger();
    const out = path.join(outDir, 'cdx.json');
    writeCycloneDxMlBom(ledgerPath, out, '10.0.0');
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(CYCLONEDX_MIN_SCHEMA);
    const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
    const ok = validate(doc);
    assert.equal(ok, true, JSON.stringify(validate.errors));
  });

  it('SPDX-AI output validates against the structural-invariants schema', () => {
    const { ledgerPath, outDir } = seedLedger();
    const out = path.join(outDir, 'spdx.json');
    writeSpdxAiProfileBom(ledgerPath, out, '10.0.0');
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(SPDX_MIN_SCHEMA);
    const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
    const ok = validate(doc);
    assert.equal(ok, true, JSON.stringify(validate.errors));
  });
});
