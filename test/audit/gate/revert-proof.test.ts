import { strict as assert } from 'assert';
import {
  parseProofUrl,
  proofChangedRanges,
  wasRevertedOrHotfixed,
  type Proof,
} from '../../../src/audit/gate/revert-proof';

describe('revert-proof', () => {
  describe('parseProofUrl', () => {
    it('parses a pull URL', () => {
      assert.deepEqual(parseProofUrl('https://github.com/acme/widgets/pull/42'), {
        owner: 'acme',
        repo: 'widgets',
        ref: '42',
      });
    });
    it('parses a commit URL', () => {
      const ref = parseProofUrl('https://github.com/acme/widgets/commit/deadbeef');
      assert.deepEqual(ref, { owner: 'acme', repo: 'widgets', ref: 'deadbeef' });
    });
    it('returns null for a non-pull/commit URL', () => {
      assert.equal(parseProofUrl('https://example.com/not/a/proof'), null);
    });
  });

  describe('wasRevertedOrHotfixed', () => {
    it('counts revert, fix-pr, and hotfix as proof the change went wrong', () => {
      assert.equal(wasRevertedOrHotfixed([{ kind: 'revert', url: 'u' }]), true);
      assert.equal(wasRevertedOrHotfixed([{ kind: 'fix-pr', url: 'u' }]), true);
      assert.equal(wasRevertedOrHotfixed([{ kind: 'hotfix', url: 'u' }]), true);
    });
    it('does not count an issue-only proof', () => {
      assert.equal(wasRevertedOrHotfixed([{ kind: 'issue', url: 'u' }]), false);
    });
    it('is false with no proofs', () => {
      const none: Proof[] = [];
      assert.equal(wasRevertedOrHotfixed(none), false);
    });
  });

  describe('proofChangedRanges', () => {
    const diff = [
      'diff --git a/src/pay.ts b/src/pay.ts',
      '--- a/src/pay.ts',
      '+++ b/src/pay.ts',
      '@@ -10,2 +10,3 @@',
      ' const a = 1;',
      '+const b = 2;',
      ' const c = 3;',
    ].join('\n');

    it('extracts and merges changed-line ranges across diffs', () => {
      const ranges = proofChangedRanges([diff]);
      assert.ok(ranges['src/pay.ts'] !== undefined, 'src/pay.ts has ranges');
      assert.ok(ranges['src/pay.ts']!.length > 0);
    });

    it('restricts to audited files when given', () => {
      const ranges = proofChangedRanges([diff], new Set(['src/other.ts']));
      assert.equal(ranges['src/pay.ts'], undefined, 'a file outside the audited set is dropped');
    });
  });
});
