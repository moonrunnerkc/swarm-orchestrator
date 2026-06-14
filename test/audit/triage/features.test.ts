import { strict as assert } from 'assert';
import { STRUCTURAL_FEATURE_NAMES, structuralFeatures } from '../../../src/audit/triage/features';

describe('triage/features', () => {
  it('counts files, hunks, additions, deletions and the test flag', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' context',
      '+added one',
      '+added two',
      '-removed one',
      'diff --git a/test/a.test.ts b/test/a.test.ts',
      '--- a/test/a.test.ts',
      '+++ b/test/a.test.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    const f = structuralFeatures(diff);
    const idx = (name: string): number => STRUCTURAL_FEATURE_NAMES.indexOf(name);
    assert.equal(f[idx('num_files')], 2);
    assert.equal(f[idx('num_hunks')], 2);
    assert.equal(f[idx('log1p_additions')], Math.log1p(3));
    assert.equal(f[idx('log1p_deletions')], Math.log1p(2));
    assert.equal(f[idx('touches_test')], 1);
  });

  it('does not flag a source-only diff as touching tests', () => {
    const diff = ['--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '+x'].join('\n');
    const f = structuralFeatures(diff);
    assert.equal(f[STRUCTURAL_FEATURE_NAMES.indexOf('touches_test')], 0);
  });

  it('produces one value per feature name', () => {
    assert.equal(structuralFeatures('').length, STRUCTURAL_FEATURE_NAMES.length);
  });
});
