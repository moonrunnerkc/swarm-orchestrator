import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import {
  chunkUnifiedDiff,
  chunkUnifiedDiffByHunk,
} from '../../../src/audit/cheat-detector/diff-chunker';

function fileHunk(file: string, body: string): string {
  return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,2 @@\n const x = 1;\n+${body}\n`;
}

describe('cheat-detector / diff-chunker', () => {
  it('returns the diff unchanged when it fits', () => {
    const diff = fileHunk('a.ts', 'const y = 2;');
    assert.deepEqual(chunkUnifiedDiff(diff, 100000), [diff]);
  });

  it('splits a large multi-file diff into chunks under the budget', () => {
    const parts: string[] = [];
    for (let i = 0; i < 40; i += 1) parts.push(fileHunk(`f${i}.ts`, `const v${i} = ${'x'.repeat(50)};`));
    const diff = parts.join('');
    const chunks = chunkUnifiedDiff(diff, 600);
    assert.ok(chunks.length > 1, 'expected multiple chunks');
    for (const c of chunks) {
      assert.ok(c.length <= 600 || parseDiff(c).length === 1, 'chunk over budget should be a single hunk');
      assert.ok(parseDiff(c).length >= 1, 'each chunk must parse as a diff');
    }
  });

  it('preserves every hunk across the chunks (no dropped tail)', () => {
    const markers: string[] = [];
    const parts: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const marker = `MARKER_${i}_${'pad'.repeat(20)}`;
      markers.push(`MARKER_${i}_`);
      parts.push(fileHunk(`f${i}.ts`, marker));
    }
    const diff = parts.join('');
    const joined = chunkUnifiedDiff(diff, 700).join('\n');
    for (const m of markers) {
      assert.ok(joined.includes(m), `marker ${m} was dropped`);
    }
  });

  it('splits one chunk per hunk with stable (file, hunkIndex) ids', () => {
    const twoHunkFile =
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n' +
      '@@ -1,1 +1,2 @@\n const x = 1;\n+const y = 2;\n' +
      '@@ -10,1 +11,2 @@\n const z = 3;\n+const w = 4;\n';
    const other = fileHunk('b.ts', 'const q = 9;');
    const hunks = chunkUnifiedDiffByHunk(twoHunkFile + other);
    assert.equal(hunks.length, 3);
    assert.deepEqual(
      hunks.map((h) => `${h.file}#${h.hunkIndex}`),
      ['a.ts#0', 'a.ts#1', 'b.ts#0'],
    );
    for (const h of hunks) {
      assert.equal(parseDiff(h.text).length, 1, 'each per-hunk chunk parses to one file');
    }
  });
});
