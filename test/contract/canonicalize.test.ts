import { strict as assert } from 'assert';
import {
  canonicalSerialize,
  canonicalSort,
  contractHash,
  contractIdFromHash,
} from '../../src/contract/canonicalize';
import { type ObligationV1 } from '../../src/contract/types';

describe('contract/canonicalize', () => {
  describe('canonicalSort', () => {
    it('orders types as file-must-exist, build-must-pass, test-must-pass', () => {
      const input: ObligationV1[] = [
        { type: 'test-must-pass', command: 'npm test' },
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'file-must-exist', path: 'src/health.ts' },
      ];
      const sorted = canonicalSort(input);
      assert.deepEqual(
        sorted.map((o) => o.type),
        ['file-must-exist', 'build-must-pass', 'test-must-pass'],
      );
    });

    it('orders within type lexicographically by payload', () => {
      const input: ObligationV1[] = [
        { type: 'file-must-exist', path: 'b.ts' },
        { type: 'file-must-exist', path: 'a.ts' },
      ];
      const sorted = canonicalSort(input);
      assert.deepEqual(
        sorted.map((o) => (o.type === 'file-must-exist' ? o.path : '')),
        ['a.ts', 'b.ts'],
      );
    });

    it('does not mutate the input array', () => {
      const input: ObligationV1[] = [
        { type: 'test-must-pass', command: 'npm test' },
        { type: 'file-must-exist', path: 'a.ts' },
      ];
      const before = JSON.stringify(input);
      canonicalSort(input);
      assert.equal(JSON.stringify(input), before);
    });
  });

  describe('canonicalSerialize', () => {
    it('emits one obligation per line, terminated with LF', () => {
      const out = canonicalSerialize([
        { type: 'file-must-exist', path: 'a.ts' },
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'test-must-pass', command: 'npm test' },
      ]);
      assert.equal(
        out,
        '{"type":"file-must-exist","path":"a.ts"}\n' +
          '{"type":"build-must-pass","command":"npm run build"}\n' +
          '{"type":"test-must-pass","command":"npm test"}\n',
      );
    });

    it('produces identical bytes regardless of input order (canonical)', () => {
      const a: ObligationV1[] = [
        { type: 'test-must-pass', command: 'npm test' },
        { type: 'file-must-exist', path: 'a.ts' },
        { type: 'build-must-pass', command: 'npm run build' },
      ];
      const b: ObligationV1[] = [
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'file-must-exist', path: 'a.ts' },
        { type: 'test-must-pass', command: 'npm test' },
      ];
      assert.equal(canonicalSerialize(a), canonicalSerialize(b));
    });

    it('emits empty string for empty input', () => {
      assert.equal(canonicalSerialize([]), '');
    });
  });

  describe('contractHash', () => {
    it('returns a 64-char lowercase hex string', () => {
      const hash = contractHash([{ type: 'file-must-exist', path: 'a.ts' }]);
      assert.match(hash, /^[0-9a-f]{64}$/);
    });

    it('is order-independent (canonical-form hash)', () => {
      const a: ObligationV1[] = [
        { type: 'test-must-pass', command: 'npm test' },
        { type: 'file-must-exist', path: 'a.ts' },
      ];
      const b: ObligationV1[] = [
        { type: 'file-must-exist', path: 'a.ts' },
        { type: 'test-must-pass', command: 'npm test' },
      ];
      assert.equal(contractHash(a), contractHash(b));
    });

    it('changes when an obligation changes', () => {
      const a = contractHash([{ type: 'file-must-exist', path: 'a.ts' }]);
      const b = contractHash([{ type: 'file-must-exist', path: 'b.ts' }]);
      assert.notEqual(a, b);
    });
  });

  describe('contractIdFromHash', () => {
    it('returns the first 16 hex chars', () => {
      const hash = '0123456789abcdef' + 'f'.repeat(48);
      assert.equal(contractIdFromHash(hash), '0123456789abcdef');
    });

    it('throws for short input', () => {
      assert.throws(() => contractIdFromHash('short'), /shorter than 16 chars/);
    });
  });
});
