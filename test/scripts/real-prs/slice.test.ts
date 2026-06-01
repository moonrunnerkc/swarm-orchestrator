import { strict as assert } from 'assert';
import { sliceDiffForFinding } from '../../../scripts/real-prs/lib/slice';

// Two files, the second with two hunks. A finding at a line inside the
// second hunk of b.ts should produce a slice scoped to b.ts that includes
// that hunk.
const DIFF = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+const a2 = 2;',
  ' const a3 = 3;',
  'diff --git a/b.ts b/b.ts',
  '--- a/b.ts',
  '+++ b/b.ts',
  '@@ -1,2 +1,2 @@',
  ' const b = 1;',
  '-const b2 = 2;',
  '+const b2 = 22;',
  '@@ -40,2 +40,3 @@',
  ' const far = 1;',
  '+const inserted = 99;',
  ' const far2 = 2;',
].join('\n');

describe('scripts/real-prs/lib/slice', () => {
  it('scopes the slice to the file the finding touches', () => {
    const slice = sliceDiffForFinding(DIFF, 'b.ts', 41);
    assert.ok(slice.includes('b/b.ts'), 'slice should be the b.ts file');
    assert.ok(!slice.includes('const a2'), 'slice should not include the a.ts hunk');
  });

  it('includes the hunk that covers the finding line', () => {
    const slice = sliceDiffForFinding(DIFF, 'b.ts', 41);
    assert.ok(slice.includes('const inserted = 99;'), 'slice should include the covering hunk');
  });

  it('falls back to a head slice when the file is absent', () => {
    const slice = sliceDiffForFinding(DIFF, 'missing.ts', 1, 50);
    assert.ok(slice.length <= 50);
  });
});
