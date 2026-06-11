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

  // A single hunk over the budget used to pass through whole, which made
  // the model provider truncate it silently (tail-blindness on 400k-char
  // generated-file hunks in the agent corpus). It must now split into
  // valid sub-hunks that each respect the budget.
  it('splits a single oversized hunk into budget-sized valid sub-hunks', () => {
    const bodyLines: string[] = [];
    for (let i = 0; i < 200; i += 1) bodyLines.push(`+const line_${i} = ${'x'.repeat(40)};`);
    const diff =
      'diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n' +
      `@@ -1,0 +1,200 @@\n${bodyLines.join('\n')}\n`;
    const maxChars = 2000;
    const chunks = chunkUnifiedDiff(diff, maxChars);
    assert.ok(chunks.length > 1, 'expected the oversized hunk to split');
    for (const c of chunks) {
      assert.ok(c.length <= maxChars, `chunk of ${c.length} chars exceeds the ${maxChars} budget`);
      const parsed = parseDiff(c);
      assert.equal(parsed.length, 1, 'each sub-hunk chunk parses as one file');
      assert.ok((parsed[0]?.chunks.length ?? 0) >= 1, 'each chunk carries a hunk');
    }
    // No dropped tail: every body line survives across the sub-hunks.
    const joined = chunks.join('\n');
    for (let i = 0; i < 200; i += 1) {
      assert.ok(joined.includes(`const line_${i} =`), `line ${i} was dropped`);
    }
  });

  it('recomputes sub-hunk @@ headers so line numbers stay consistent', () => {
    const bodyLines: string[] = [];
    // Alternate context/added lines so old and new counts differ.
    for (let i = 0; i < 100; i += 1) {
      bodyLines.push(` ctx_${i}_${'p'.repeat(30)}`);
      bodyLines.push(`+add_${i}_${'q'.repeat(30)}`);
    }
    const diff =
      'diff --git a/n.ts b/n.ts\n--- a/n.ts\n+++ b/n.ts\n' +
      `@@ -10,100 +20,200 @@\n${bodyLines.join('\n')}\n`;
    const chunks = chunkUnifiedDiff(diff, 1500);
    assert.ok(chunks.length > 1);
    let expectedOld = 10;
    let expectedNew = 20;
    for (const c of chunks) {
      const m = /@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(c);
      assert.ok(m !== null, 'sub-hunk must carry a parseable @@ header');
      assert.equal(Number(m![1]), expectedOld, 'old start must continue from the previous sub-hunk');
      assert.equal(Number(m![3]), expectedNew, 'new start must continue from the previous sub-hunk');
      expectedOld += Number(m![2]);
      expectedNew += Number(m![4]);
    }
    assert.equal(expectedOld, 110, 'old line coverage must equal the original hunk');
    assert.equal(expectedNew, 220, 'new line coverage must equal the original hunk');
  });
});
