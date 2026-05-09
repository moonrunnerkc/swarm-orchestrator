import { strict as assert } from 'assert';
import {
  canonicalSerialize,
  canonicalSort,
  contractHash,
} from '../../src/contract/canonicalize';
import { obligationKey } from '../../src/ledger/memoization';
import { OBLIGATION_TYPES, type ObligationV1 } from '../../src/contract/types';
import { validateObligations } from '../../src/contract/validator';

describe('contract Phase 7 obligation types', () => {
  it('OBLIGATION_TYPES exposes 8 types with the Phase 1 ordering preserved', () => {
    assert.deepEqual([...OBLIGATION_TYPES], [
      'file-must-exist',
      'build-must-pass',
      'test-must-pass',
      'function-must-have-signature',
      'property-must-hold',
      'import-graph-must-satisfy',
      'coverage-must-exceed',
      'performance-must-not-regress',
    ]);
  });

  describe('schema validation', () => {
    function withMinimalShell(extra: ObligationV1[]): ObligationV1[] {
      return [
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'test-must-pass', command: 'npm test' },
        ...extra,
      ];
    }

    it('accepts a function-must-have-signature obligation', () => {
      const r = validateObligations(
        withMinimalShell([
          {
            type: 'function-must-have-signature',
            file: 'src/api.ts',
            name: 'handler',
            signature: '(req: Request): Promise<Response>',
          },
        ]),
      );
      assert.equal(r.valid, true, JSON.stringify(r.errors));
    });

    it('rejects function-must-have-signature with empty signature', () => {
      const r = validateObligations(
        withMinimalShell([
          {
            type: 'function-must-have-signature',
            file: 'src/api.ts',
            name: 'handler',
            signature: '',
          },
        ]),
      );
      assert.equal(r.valid, false);
    });

    it('accepts a property-must-hold obligation', () => {
      const r = validateObligations(
        withMinimalShell([
          { type: 'property-must-hold', target: 'no-secrets', predicate: 'test -z $(grep -r SECRET src/)' },
        ]),
      );
      assert.equal(r.valid, true, JSON.stringify(r.errors));
    });

    it('accepts an import-graph-must-satisfy obligation', () => {
      const r = validateObligations(
        withMinimalShell([
          { type: 'import-graph-must-satisfy', constraint: 'no-cycles', scope: 'src' },
        ]),
      );
      assert.equal(r.valid, true, JSON.stringify(r.errors));
    });

    it('rejects an import-graph-must-satisfy obligation with an unknown constraint', () => {
      const r = validateObligations(
        withMinimalShell([
          // @ts-expect-error — exercising the schema branch
          { type: 'import-graph-must-satisfy', constraint: 'no-imports', scope: 'src' },
        ]),
      );
      assert.equal(r.valid, false);
    });

    it('accepts a coverage-must-exceed obligation', () => {
      const r = validateObligations(
        withMinimalShell([
          {
            type: 'coverage-must-exceed',
            scope: 'coverage/coverage-summary.json',
            metric: 'lines',
            threshold: 80,
          },
        ]),
      );
      assert.equal(r.valid, true, JSON.stringify(r.errors));
    });

    it('rejects a coverage-must-exceed with threshold > 100', () => {
      const r = validateObligations(
        withMinimalShell([
          {
            type: 'coverage-must-exceed',
            scope: 'coverage/coverage-summary.json',
            metric: 'lines',
            threshold: 150,
          },
        ]),
      );
      assert.equal(r.valid, false);
    });

    it('accepts a performance-must-not-regress obligation', () => {
      const r = validateObligations(
        withMinimalShell([
          {
            type: 'performance-must-not-regress',
            benchmark: 'npm run bench',
            baseline: 'bench/baseline.json',
            threshold: 0.05,
          },
        ]),
      );
      assert.equal(r.valid, true, JSON.stringify(r.errors));
    });

    it('rejects performance threshold > 1', () => {
      const r = validateObligations(
        withMinimalShell([
          {
            type: 'performance-must-not-regress',
            benchmark: 'npm run bench',
            baseline: 'bench/baseline.json',
            threshold: 2,
          },
        ]),
      );
      assert.equal(r.valid, false);
    });

    it('flags duplicate function-must-have-signature with the dedicated code', () => {
      const sig: ObligationV1 = {
        type: 'function-must-have-signature',
        file: 'a.ts',
        name: 'f',
        signature: '()',
      };
      const r = validateObligations(withMinimalShell([sig, sig]));
      assert.equal(r.valid, false);
      assert.ok(r.errors.some((e) => e.code === 'duplicate-function-must-have-signature'));
    });

    it('flags duplicate property-must-hold with the dedicated code', () => {
      const p: ObligationV1 = {
        type: 'property-must-hold',
        target: 'tag',
        predicate: 'true',
      };
      const r = validateObligations(withMinimalShell([p, p]));
      assert.equal(r.valid, false);
      assert.ok(r.errors.some((e) => e.code === 'duplicate-property-must-hold'));
    });
  });

  describe('canonicalization & hashing', () => {
    it('round-trips every Phase 7 obligation type through canonicalSerialize', () => {
      const list: ObligationV1[] = [
        { type: 'file-must-exist', path: 'README.md' },
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'test-must-pass', command: 'npm test' },
        {
          type: 'function-must-have-signature',
          file: 'src/api.ts',
          name: 'handler',
          signature: '(req: Request): Response',
        },
        { type: 'property-must-hold', target: 'no-cycles', predicate: 'true' },
        { type: 'import-graph-must-satisfy', constraint: 'no-cycles', scope: 'src' },
        { type: 'coverage-must-exceed', scope: 'cov.json', metric: 'lines', threshold: 80 },
        {
          type: 'performance-must-not-regress',
          benchmark: 'echo 1',
          baseline: 'b.json',
          threshold: 0.1,
        },
      ];
      const sorted = canonicalSort(list);
      assert.equal(sorted.length, list.length);
      const text = canonicalSerialize(list);
      // 8 lines + trailing newline.
      assert.equal(text.split('\n').filter((l) => l.length > 0).length, 8);
      // Hash deterministic across permutations.
      const reversed = [...list].reverse();
      assert.equal(contractHash(list), contractHash(reversed));
    });

    it('canonical sort orders Phase 7 types after Phase 1 types', () => {
      const list: ObligationV1[] = [
        { type: 'performance-must-not-regress', benchmark: 'a', baseline: 'b.json', threshold: 0.1 },
        { type: 'file-must-exist', path: 'X.md' },
        { type: 'build-must-pass', command: 'npm run build' },
      ];
      const sorted = canonicalSort(list);
      assert.deepEqual(
        sorted.map((o) => o.type),
        ['file-must-exist', 'build-must-pass', 'performance-must-not-regress'],
      );
    });
  });

  describe('memoization keying', () => {
    it('every Phase 7 obligation type has a stable, distinct memoization key', () => {
      const list: ObligationV1[] = [
        { type: 'file-must-exist', path: 'X.md' },
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'test-must-pass', command: 'npm test' },
        {
          type: 'function-must-have-signature',
          file: 'a.ts',
          name: 'f',
          signature: '()',
        },
        { type: 'property-must-hold', target: 't', predicate: 'true' },
        { type: 'import-graph-must-satisfy', constraint: 'no-cycles', scope: 'src' },
        { type: 'coverage-must-exceed', scope: 'cov.json', metric: 'lines', threshold: 80 },
        {
          type: 'performance-must-not-regress',
          benchmark: 'b',
          baseline: 'b.json',
          threshold: 0.1,
        },
      ];
      const keys = list.map(obligationKey);
      assert.equal(new Set(keys).size, list.length, 'keys are unique');
      for (const k of keys) {
        assert.ok(k.length > 0);
        assert.ok(k.includes('|'));
      }
    });
  });
});
