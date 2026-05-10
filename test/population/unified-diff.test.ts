import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyUnifiedDiff,
  looksLikeUnifiedDiff,
  parseUnifiedDiff,
} from '../../src/population/unified-diff';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('population/unified-diff', () => {
  describe('looksLikeUnifiedDiff', () => {
    it('detects standard unified diffs', () => {
      const diff = '--- a/x\n+++ b/x\n@@ -1,1 +1,2 @@\n hi\n+bye\n';
      assert.equal(looksLikeUnifiedDiff(diff), true);
    });

    it('detects fenced diffs', () => {
      const diff = '```diff\n--- a/x\n+++ b/x\n@@ -1,1 +1,2 @@\n hi\n+bye\n```';
      assert.equal(looksLikeUnifiedDiff(diff), true);
    });

    it('rejects fenced code that is not a diff', () => {
      assert.equal(looksLikeUnifiedDiff('```\nhello\n```'), false);
    });

    it('rejects no-op text', () => {
      assert.equal(looksLikeUnifiedDiff('no-op'), false);
    });
  });

  describe('parseUnifiedDiff', () => {
    it('parses a single-file create patch', () => {
      const diff = [
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,2 @@',
        '+line one',
        '+line two',
      ].join('\n');
      const patches = parseUnifiedDiff(diff);
      assert.equal(patches.length, 1);
      const p = patches[0];
      assert.ok(p);
      assert.equal(p.isCreate, true);
      assert.equal(p.newPath, 'new.txt');
      assert.equal(p.hunks.length, 1);
    });

    it('parses a modify patch with multiple hunks', () => {
      const diff = [
        '--- a/x.txt',
        '+++ b/x.txt',
        '@@ -1,2 +1,2 @@',
        '-old1',
        '+new1',
        ' shared',
        '@@ -10,1 +10,2 @@',
        ' anchor',
        '+new10',
      ].join('\n');
      const patches = parseUnifiedDiff(diff);
      assert.equal(patches.length, 1);
      const p = patches[0];
      assert.ok(p);
      assert.equal(p.isCreate, false);
      assert.equal(p.isDelete, false);
      assert.equal(p.hunks.length, 2);
    });

    it('throws on missing +++ header', () => {
      const diff = '--- a/x\n@@ -1,1 +1,1 @@\n hi\n';
      assert.throws(() => parseUnifiedDiff(diff), /\+\+\+/);
    });

    it('throws on malformed hunk header', () => {
      const diff = '--- a/x\n+++ b/x\n@@ malformed @@\n hi\n';
      assert.throws(() => parseUnifiedDiff(diff), /malformed hunk/);
    });

    it('handles git-style "diff --git" preamble lines', () => {
      const diff = [
        'diff --git a/x.txt b/x.txt',
        'index abc..def 100644',
        '--- a/x.txt',
        '+++ b/x.txt',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n');
      const patches = parseUnifiedDiff(diff);
      assert.equal(patches.length, 1);
    });
  });

  describe('applyUnifiedDiff', () => {
    it('creates a new file from a /dev/null patch', () => {
      const repo = tmpDir('v8-diff-');
      const diff = [
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,2 @@',
        '+hello',
        '+world',
      ].join('\n');
      const r = applyUnifiedDiff(repo, diff);
      assert.equal(r.applied, true);
      assert.deepEqual(r.changedFiles, ['new.txt']);
      assert.equal(fs.readFileSync(path.join(repo, 'new.txt'), 'utf8'), 'hello\nworld\n');
    });

    it('modifies an existing file', () => {
      const repo = tmpDir('v8-diff-');
      fs.writeFileSync(path.join(repo, 'x.txt'), 'one\ntwo\nthree\n');
      const diff = [
        '--- a/x.txt',
        '+++ b/x.txt',
        '@@ -1,3 +1,3 @@',
        ' one',
        '-two',
        '+TWO',
        ' three',
      ].join('\n');
      const r = applyUnifiedDiff(repo, diff);
      assert.equal(r.applied, true);
      assert.equal(fs.readFileSync(path.join(repo, 'x.txt'), 'utf8'), 'one\nTWO\nthree\n');
    });

    it('skips patches whose target is in protectedPaths and applies the rest', () => {
      const repo = tmpDir('v8-diff-');
      // Pre-existing architect-owned file we want to keep intact.
      const protectedPath = 'test/architect-owned.test.js';
      const protectedAbs = path.join(repo, protectedPath);
      fs.mkdirSync(path.dirname(protectedAbs), { recursive: true });
      fs.writeFileSync(protectedAbs, "import 'a';\n// architect body\n");
      // Multi-file diff: one patch targets the protected path (overwrite
      // attempt) and a second targets an unrelated path.
      const diff = [
        '--- /dev/null',
        '+++ b/' + protectedPath,
        '@@ -0,0 +1,1 @@',
        '+stomped',
        '--- /dev/null',
        '+++ b/notes.txt',
        '@@ -0,0 +1,1 @@',
        '+ok',
      ].join('\n');
      const r = applyUnifiedDiff(repo, diff, {
        protectedPaths: new Set([protectedPath]),
      });
      assert.equal(r.applied, true);
      assert.deepEqual(r.changedFiles, ['notes.txt']);
      assert.match(r.detail, /skipped 1/);
      // Architect's body intact.
      assert.equal(
        fs.readFileSync(protectedAbs, 'utf8'),
        "import 'a';\n// architect body\n",
      );
      // Unrelated file written.
      assert.equal(fs.readFileSync(path.join(repo, 'notes.txt'), 'utf8'), 'ok\n');
    });

    it('deletes a file when +++ /dev/null', () => {
      const repo = tmpDir('v8-diff-');
      const target = path.join(repo, 'goodbye.txt');
      fs.writeFileSync(target, 'bye\n');
      const diff = [
        '--- a/goodbye.txt',
        '+++ /dev/null',
        '@@ -1,1 +0,0 @@',
        '-bye',
      ].join('\n');
      const r = applyUnifiedDiff(repo, diff);
      assert.equal(r.applied, true);
      assert.equal(fs.existsSync(target), false);
    });

    it('treats "no-op" as a non-applying success', () => {
      const repo = tmpDir('v8-diff-');
      const r = applyUnifiedDiff(repo, 'no-op');
      assert.equal(r.applied, false);
      assert.equal(r.detail, 'no-op');
    });

    it('refuses non-diff text', () => {
      const repo = tmpDir('v8-diff-');
      const r = applyUnifiedDiff(repo, 'this is prose, not a diff');
      assert.equal(r.applied, false);
      assert.match(r.detail, /not a unified diff/);
    });

    it('throws on context mismatch', () => {
      const repo = tmpDir('v8-diff-');
      fs.writeFileSync(path.join(repo, 'x.txt'), 'real content\n');
      const diff = [
        '--- a/x.txt',
        '+++ b/x.txt',
        '@@ -1,1 +1,1 @@',
        '-different content',
        '+new content',
      ].join('\n');
      assert.throws(() => applyUnifiedDiff(repo, diff), /context mismatch/);
    });

    it('refuses absolute paths', () => {
      const repo = tmpDir('v8-diff-');
      const diff = [
        '--- /dev/null',
        '+++ /etc/passwd',
        '@@ -0,0 +1,1 @@',
        '+evil',
      ].join('\n');
      assert.throws(() => applyUnifiedDiff(repo, diff), /escapes repo root|absolute/);
    });

    it('handles multi-file patches in a single response', () => {
      const repo = tmpDir('v8-diff-');
      const diff = [
        '--- /dev/null',
        '+++ b/a.txt',
        '@@ -0,0 +1,1 @@',
        '+a',
        '--- /dev/null',
        '+++ b/b.txt',
        '@@ -0,0 +1,1 @@',
        '+b',
      ].join('\n');
      const r = applyUnifiedDiff(repo, diff);
      assert.equal(r.applied, true);
      assert.deepEqual(r.changedFiles.sort(), ['a.txt', 'b.txt']);
    });
  });
});
