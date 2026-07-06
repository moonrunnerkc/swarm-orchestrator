import { strict as assert } from 'assert';
import {
  deriveBomIdentity,
  readSourceDateEpoch,
  uuidV5,
  EVIDENCE_PACK_EPOCH_SENTINEL,
  type BomIdentitySeed,
} from '../../../src/audit/aibom/bom-identity';

const SEED: BomIdentitySeed = {
  repository: 'owner/repo',
  prNumber: 42,
  headSha: 'a'.repeat(40),
  baseSha: 'b'.repeat(40),
  detectorVersions: { 'test-relaxation': '1.0.0', 'no-op-fix': '2.1.0' },
  toolVersion: '12.0.0',
};

describe('aibom / bom-identity', () => {
  describe('uuidV5', () => {
    it('matches the canonical RFC-4122 v5 vector (DNS namespace, python.org)', () => {
      // Python's uuid.uuid5(uuid.NAMESPACE_DNS, 'python.org') reference value.
      const dnsNamespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      assert.equal(uuidV5(dnsNamespace, 'python.org'), '886313e1-3b8a-5372-9b90-0c9aee199e5d');
    });

    it('sets the version nibble to 5 and the RFC-4122 variant bits', () => {
      const id = uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'anything');
      assert.equal(id[14], '5', 'version nibble must be 5');
      assert.ok('89ab'.includes(id[19]!), 'variant nibble must be 8, 9, a, or b');
    });

    it('rejects a namespace that is not a valid UUID', () => {
      assert.throws(() => uuidV5('not-a-uuid', 'name'), /not a valid UUID/);
    });
  });

  describe('deriveBomIdentity', () => {
    it('is a pure function of the seed: same inputs produce the same identity', () => {
      const a = deriveBomIdentity(SEED);
      const b = deriveBomIdentity({ ...SEED, detectorVersions: { ...SEED.detectorVersions } });
      assert.deepEqual(a, b);
    });

    it('changes the serialNumber when the head SHA changes', () => {
      const a = deriveBomIdentity(SEED);
      const b = deriveBomIdentity({ ...SEED, headSha: 'c'.repeat(40) });
      assert.notEqual(a.serialNumber, b.serialNumber);
    });

    it('does not depend on detector-version key order', () => {
      const reordered: BomIdentitySeed = {
        ...SEED,
        detectorVersions: { 'no-op-fix': '2.1.0', 'test-relaxation': '1.0.0' },
      };
      assert.equal(deriveBomIdentity(SEED).serialNumber, deriveBomIdentity(reordered).serialNumber);
    });

    it('emits a urn:uuid serialNumber', () => {
      assert.match(deriveBomIdentity(SEED).serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
    });

    it('pins the epoch sentinel and records the basis when SOURCE_DATE_EPOCH is unset', () => {
      const id = deriveBomIdentity(SEED);
      assert.equal(id.timestamp, EVIDENCE_PACK_EPOCH_SENTINEL);
      assert.equal(id.timestampBasis, 'source-date-epoch-unset');
    });

    it('honors an explicit SOURCE_DATE_EPOCH and records the basis', () => {
      const id = deriveBomIdentity(SEED, 1_700_000_000);
      assert.equal(id.timestamp, new Date(1_700_000_000 * 1000).toISOString());
      assert.equal(id.timestampBasis, 'source-date-epoch');
    });
  });

  describe('readSourceDateEpoch', () => {
    it('reads a valid integer', () => {
      assert.equal(readSourceDateEpoch({ SOURCE_DATE_EPOCH: '1700000000' }), 1_700_000_000);
    });

    it('returns undefined when unset, empty, or non-integer', () => {
      assert.equal(readSourceDateEpoch({}), undefined);
      assert.equal(readSourceDateEpoch({ SOURCE_DATE_EPOCH: '' }), undefined);
      assert.equal(readSourceDateEpoch({ SOURCE_DATE_EPOCH: '  ' }), undefined);
      assert.equal(readSourceDateEpoch({ SOURCE_DATE_EPOCH: '17e8' }), undefined);
      assert.equal(readSourceDateEpoch({ SOURCE_DATE_EPOCH: '-5' }), undefined);
    });
  });
});
