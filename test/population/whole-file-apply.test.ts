import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyWholeFileResponse,
  looksLikeWholeFileResponse,
  parseWholeFileBlocks,
} from '../../src/population/whole-file-apply';

function tmpRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('population/whole-file-apply', () => {
  describe('looksLikeWholeFileResponse', () => {
    it('detects a single-block response', () => {
      const text = '<<<FILE src/x.js\nconst a = 1;\nFILE>>>';
      assert.equal(looksLikeWholeFileResponse(text), true);
    });

    it('detects a multi-block response', () => {
      const text =
        '<<<FILE a.js\nfoo\nFILE>>>\n<<<FILE b.js\nbar\nFILE>>>';
      assert.equal(looksLikeWholeFileResponse(text), true);
    });

    it('rejects a unified diff', () => {
      const text = '--- a/x\n+++ b/x\n@@ -1,1 +1,2 @@\n hi\n+bye';
      assert.equal(looksLikeWholeFileResponse(text), false);
    });

    it('rejects no-op', () => {
      assert.equal(looksLikeWholeFileResponse('no-op'), false);
    });
  });

  describe('parseWholeFileBlocks', () => {
    it('extracts one block with body verbatim', () => {
      const text = '<<<FILE src/x.js\nconst a = 1;\nconst b = 2;\nFILE>>>';
      const blocks = parseWholeFileBlocks(text);
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0]!.relPath, 'src/x.js');
      assert.equal(blocks[0]!.body, 'const a = 1;\nconst b = 2;');
    });

    it('extracts multiple blocks', () => {
      const text =
        '<<<FILE a.js\nfoo\nFILE>>>\n<<<FILE sub/b.js\nbar\nbaz\nFILE>>>';
      const blocks = parseWholeFileBlocks(text);
      assert.equal(blocks.length, 2);
      assert.equal(blocks[0]!.relPath, 'a.js');
      assert.equal(blocks[1]!.relPath, 'sub/b.js');
      assert.equal(blocks[1]!.body, 'bar\nbaz');
    });

    it('throws when a block is not closed', () => {
      const text = '<<<FILE a.js\nfoo\nbar\n';
      assert.throws(() => parseWholeFileBlocks(text), /never closed/);
    });

    it('ignores prose between blocks', () => {
      const text =
        'Here are two files:\n<<<FILE a.js\nfoo\nFILE>>>\nAnd this one:\n<<<FILE b.js\nbar\nFILE>>>';
      const blocks = parseWholeFileBlocks(text);
      assert.equal(blocks.length, 2);
    });
  });

  describe('applyWholeFileResponse', () => {
    it('writes a single file verbatim', () => {
      const repo = tmpRepo('wf-apply-single-');
      try {
        const text = '<<<FILE src/x.js\nconst a = 1;\nFILE>>>';
        const r = applyWholeFileResponse(repo, text);
        assert.equal(r.applied, true);
        assert.deepEqual(r.changedFiles, ['src/x.js']);
        assert.equal(
          fs.readFileSync(path.join(repo, 'src/x.js'), 'utf8'),
          'const a = 1;\n',
        );
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });

    it('overwrites an existing file', () => {
      const repo = tmpRepo('wf-apply-overwrite-');
      try {
        fs.writeFileSync(path.join(repo, 'x.js'), 'OLD\n');
        const text = '<<<FILE x.js\nNEW\nFILE>>>';
        applyWholeFileResponse(repo, text);
        assert.equal(fs.readFileSync(path.join(repo, 'x.js'), 'utf8'), 'NEW\n');
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });

    it('refuses to overwrite a protected path', () => {
      const repo = tmpRepo('wf-apply-protected-');
      try {
        fs.writeFileSync(path.join(repo, 'x.js'), 'ORIGINAL\n');
        const text = '<<<FILE x.js\nSTOMP\nFILE>>>';
        const r = applyWholeFileResponse(repo, text, {
          protectedPaths: new Set(['x.js']),
        });
        assert.equal(r.applied, false);
        assert.match(r.detail, /skipped 1 protected/);
        assert.equal(fs.readFileSync(path.join(repo, 'x.js'), 'utf8'), 'ORIGINAL\n');
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });

    it('rejects paths that escape repoRoot', () => {
      const repo = tmpRepo('wf-apply-escape-');
      try {
        const text = '<<<FILE ../oops.js\nbad\nFILE>>>';
        assert.throws(() => applyWholeFileResponse(repo, text), /escapes repo root/);
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });

    it('truncation guard rejects a dramatically shortened file', () => {
      const repo = tmpRepo('wf-apply-trunc-');
      try {
        // Big existing file (40 lines).
        const big = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
        fs.writeFileSync(path.join(repo, 'big.js'), big);
        // Persona response replaces with only 3 lines — likely truncation.
        const text = '<<<FILE big.js\nA\nB\nC\nFILE>>>';
        const r = applyWholeFileResponse(repo, text);
        assert.equal(r.applied, false);
        assert.match(r.detail, /truncation guard/);
        // Original preserved.
        assert.equal(fs.readFileSync(path.join(repo, 'big.js'), 'utf8'), big);
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });

    it('preserves multi-line bodies including blank lines', () => {
      const repo = tmpRepo('wf-apply-blanks-');
      try {
        const body = "const a = 1;\n\nconst b = 2;\n\nmodule.exports = { a, b };";
        const text = `<<<FILE x.js\n${body}\nFILE>>>`;
        applyWholeFileResponse(repo, text);
        assert.equal(fs.readFileSync(path.join(repo, 'x.js'), 'utf8'), body + '\n');
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });
  });
});
