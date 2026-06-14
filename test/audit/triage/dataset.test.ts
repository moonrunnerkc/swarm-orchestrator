import { strict as assert } from 'assert';
import { buildDataset, corpusDigest } from '../../../src/audit/triage/dataset';
import {
  cleanInstances,
  isProvenRestoration,
  oracleInstances,
  restorationInstances,
  revertInstances,
} from '../../../src/audit/oracle/distant-supervision/sources';
import type { TriageInstance } from '../../../src/audit/triage/types';

function inst(over: Partial<TriageInstance> & Pick<TriageInstance, 'id'>): TriageInstance {
  return {
    label: 'positive',
    tier: 'oracle-injected',
    category: null,
    sourcePrUrl: 'https://example.test/pr/1',
    diffPath: 'x.diff',
    sha256: 'abc',
    ...over,
  };
}

describe('triage/dataset', () => {
  describe('buildDataset', () => {
    it('sorts by id, counts tiers and labels, and is digest-stable', () => {
      const a = inst({ id: 'b', label: 'positive', tier: 'oracle-injected' });
      const b = inst({ id: 'a', label: 'unlabeled', tier: 'clean-presumed' });
      const ds = buildDataset([a, b]);
      assert.deepEqual(
        ds.instances.map((i) => i.id),
        ['a', 'b'],
      );
      assert.equal(ds.summary.total, 2);
      assert.equal(ds.summary.positives, 1);
      assert.equal(ds.summary.unlabeled, 1);
      assert.equal(ds.summary.byTier['oracle-injected'], 1);
      assert.equal(ds.summary.byTier['clean-presumed'], 1);
      // Order-independent: same instances digest identically.
      assert.equal(buildDataset([b, a]).corpusSha256, ds.corpusSha256);
    });

    it('rejects duplicate ids rather than silently dropping', () => {
      assert.throws(() => buildDataset([inst({ id: 'dup' }), inst({ id: 'dup' })]), /duplicate/);
    });

    it('changes the digest when any field changes', () => {
      const base = corpusDigest([inst({ id: 'a', sha256: 'one' })]);
      const moved = corpusDigest([inst({ id: 'a', sha256: 'two' })]);
      assert.notEqual(base, moved);
    });
  });

  describe('source interpreters', () => {
    it('labels oracle injections as ground-truth positives', () => {
      const [only] = oracleInstances([
        {
          category: 'assertion-strip',
          injectorId: 'assertion-strip',
          sourcePrUrl: 'https://example.test/pr/9',
          prStem: 'cursor-foo-pr3',
          diffPath: 'benchmarks/oracle-corpus/assertion-strip/assertion-strip/cursor-foo-pr3.diff',
          sha256: 'deadbeef',
        },
      ]);
      assert.equal(only.id, 'oracle-injected:assertion-strip/cursor-foo-pr3');
      assert.equal(only.label, 'positive');
      assert.equal(only.tier, 'oracle-injected');
      assert.equal(only.category, 'assertion-strip');
    });

    it('keeps only proven restoration proofs', () => {
      assert.equal(isProvenRestoration('proven:tampered'), true);
      assert.equal(isProvenRestoration('not-proven:no-test-hunks'), false);
      const kept = restorationInstances([
        { prRef: 'a/b#1', verdict: 'proven:tampered', category: 'assertion-strip', sourcePrUrl: 'u', diffPath: 'd', sha256: 's' },
        { prRef: 'a/b#2', verdict: 'not-proven:runner-unsupported', category: 'test-relaxation', sourcePrUrl: 'u', diffPath: 'd', sha256: 's' },
      ]);
      assert.equal(kept.length, 1);
      assert.equal(kept[0].id, 'restoration-proof:a-b#1');
      assert.equal(kept[0].tier, 'restoration-proof');
    });

    it('labels revert PRs as weak positives and clean PRs as unlabeled', () => {
      const [rev] = revertInstances([
        { repo: 'a/b', prNumber: 7, sourcePrUrl: 'u', diffPath: 'd', sha256: 's' },
      ]);
      assert.equal(rev.label, 'positive');
      assert.equal(rev.tier, 'revert-weak');
      assert.equal(rev.category, null);
      const [cln] = cleanInstances([
        { repo: 'a/b', prNumber: 8, sourcePrUrl: 'u', diffPath: 'd', sha256: 's' },
      ]);
      assert.equal(cln.label, 'unlabeled');
      assert.equal(cln.tier, 'clean-presumed');
    });
  });
});
