import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gitHashObject, snapshotBeforeApply } from '../../src/population/diff-snapshot';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('population/diff-snapshot', () => {
  it('file-must-exist against a non-existent path records preBlobSha absent', () => {
    const repo = tmpDir('v8-snap-');
    const obligation = { type: 'file-must-exist' as const, path: 'new-file.ts' };
    const pre = snapshotBeforeApply(repo, 'run-1', obligation, 0, '```\nhello\n```');
    assert.ok(pre);
    assert.equal(pre.files.length, 1);
    assert.equal(pre.files[0]?.path, 'new-file.ts');
    assert.equal(pre.files[0]?.preBlobSha, 'absent');
  });

  it('file-must-exist against an existing file matches git hash-object', () => {
    const repo = tmpDir('v8-snap-');
    const content = 'existing content\n';
    fs.writeFileSync(path.join(repo, 'old-file.ts'), content, 'utf8');
    const obligation = { type: 'file-must-exist' as const, path: 'old-file.ts' };
    const pre = snapshotBeforeApply(repo, 'run-1', obligation, 1, '```\nnew\n```');
    assert.ok(pre);
    assert.equal(pre.files.length, 1);
    const gitSha = require('child_process')
      .execSync('git hash-object --stdin', { input: content, cwd: repo })
      .toString()
      .trim();
    assert.equal(pre.files[0]?.preBlobSha, gitSha);
  });

  it('unified diff touching three files enumerates all three', () => {
    const repo = tmpDir('v8-snap-');
    const diff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,1 +1,2 @@',
      ' x',
      '+y',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b',
      '--- a/src/c.ts',
      '+++ b/src/c.ts',
      '@@ -1,1 +1,2 @@',
      ' p',
      '+q',
    ].join('\n');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'x\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'src', 'b.ts'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'src', 'c.ts'), 'p\n', 'utf8');
    const obligation = { type: 'build-must-pass' as const, command: 'true' };
    const pre = snapshotBeforeApply(repo, 'run-1', obligation, 2, diff);
    assert.ok(pre);
    assert.equal(pre.files.length, 3);
    const paths = pre.files.map((f) => f.path).sort();
    assert.deepEqual(paths, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('response of literal no-op returns null', () => {
    const repo = tmpDir('v8-snap-');
    const obligation = { type: 'build-must-pass' as const, command: 'true' };
    const pre = snapshotBeforeApply(repo, 'run-1', obligation, 0, 'no-op');
    assert.equal(pre, null);
  });

  it('response that is neither no-op nor unified diff returns null', () => {
    const repo = tmpDir('v8-snap-');
    const obligation = { type: 'build-must-pass' as const, command: 'true' };
    const pre = snapshotBeforeApply(repo, 'run-1', obligation, 0, 'just some prose');
    assert.equal(pre, null);
  });

  it('sidecar directory contains original pre-apply bytes', () => {
    const repo = tmpDir('v8-snap-');
    const content = Buffer.from('binary\x00data\n');
    fs.writeFileSync(path.join(repo, 'target.bin'), content);
    const obligation = { type: 'file-must-exist' as const, path: 'target.bin' };
    const pre = snapshotBeforeApply(repo, 'run-1', obligation, 3, '```\nnew\n```');
    assert.ok(pre);
    const sha = pre.files[0]?.preBlobSha;
    assert.ok(sha && sha !== 'absent');
    const sidecar = path.join(repo, '.swarm', 'snapshots', 'run-1', '3', sha);
    assert.ok(fs.existsSync(sidecar));
    const sidecarBytes = fs.readFileSync(sidecar);
    assert.ok(content.equals(sidecarBytes));
  });
});
