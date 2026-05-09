import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyFileEmit,
  extractFencedBody,
  writeFileObligation,
} from '../../src/population/diff-applier';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-applier-'));
}

describe('population/diff-applier', () => {
  it('extractFencedBody pulls a fenced block out of mixed prose', () => {
    const text = ['intro', '```', 'hello', '```', 'outro'].join('\n');
    assert.equal(extractFencedBody(text), 'hello');
  });

  it('extractFencedBody ignores language hint', () => {
    const text = ['```typescript', 'const x = 1;', '```'].join('\n');
    assert.equal(extractFencedBody(text), 'const x = 1;');
  });

  it('extractFencedBody returns null when there is no fence', () => {
    assert.equal(extractFencedBody('just prose'), null);
  });

  it('writeFileObligation rejects absolute paths', () => {
    const repo = tmpRoot();
    const res = writeFileObligation(repo, '/etc/passwd', 'oops');
    assert.equal(res.applied, false);
    assert.match(res.detail, /absolute/);
  });

  it('writeFileObligation creates parent directories', () => {
    const repo = tmpRoot();
    const res = writeFileObligation(repo, 'src/sub/dir/file.ts', 'export {};');
    assert.equal(res.applied, true);
    assert.equal(
      fs.readFileSync(path.join(repo, 'src/sub/dir/file.ts'), 'utf8'),
      'export {};\n',
    );
  });

  it('applyFileEmit prefers a fenced body when present', () => {
    const repo = tmpRoot();
    applyFileEmit(repo, 'a.txt', '```\nbody\n```');
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'body\n');
  });

  it('applyFileEmit falls back to raw response when no fence', () => {
    const repo = tmpRoot();
    applyFileEmit(repo, 'a.txt', 'just text');
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'just text\n');
  });
});
