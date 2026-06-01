import { strict as assert } from 'assert';
import { changedNewLines } from '../../../scripts/real-prs/lib/differential';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+const a2 = 2;',
  ' const a3 = 3;',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -10,2 +10,3 @@',
  ' const b = 1;',
  '+const inserted = 99;',
  ' const b2 = 2;',
].join('\n');

describe('scripts/real-prs/lib/differential changedNewLines', () => {
  it('collects the new-side line numbers of added lines per file', () => {
    const changed = changedNewLines(DIFF);
    assert.deepEqual([...(changed.get('src/a.ts') ?? [])], [2]);
    assert.deepEqual([...(changed.get('src/b.ts') ?? [])], [11]);
  });

  it('ignores files with only deletions', () => {
    const delOnly = [
      'diff --git a/src/c.ts b/src/c.ts',
      '--- a/src/c.ts',
      '+++ b/src/c.ts',
      '@@ -1,3 +1,2 @@',
      ' keep;',
      '-removed;',
      ' keep2;',
    ].join('\n');
    const changed = changedNewLines(delOnly);
    assert.equal(changed.has('src/c.ts'), false);
  });
});
