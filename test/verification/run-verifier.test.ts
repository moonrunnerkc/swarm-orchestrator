import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { verifyObligation } from '../../src/verification/run-verifier';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-runverify-'));
}

describe('verification/verifyObligation', () => {
  it('file-must-exist: satisfied when file exists', () => {
    const repo = tmpRoot();
    fs.writeFileSync(path.join(repo, 'CHANGES.md'), 'hello\n');
    const res = verifyObligation(
      { type: 'file-must-exist', path: 'CHANGES.md' },
      { repoRoot: repo },
    );
    assert.equal(res.satisfied, true);
  });

  it('file-must-exist: unsatisfied when file is missing', () => {
    const repo = tmpRoot();
    const res = verifyObligation(
      { type: 'file-must-exist', path: 'no.txt' },
      { repoRoot: repo },
    );
    assert.equal(res.satisfied, false);
    assert.match(res.detail, /does not exist/);
  });

  it('file-must-exist: unsatisfied when path is a directory', () => {
    const repo = tmpRoot();
    fs.mkdirSync(path.join(repo, 'sub'));
    const res = verifyObligation(
      { type: 'file-must-exist', path: 'sub' },
      { repoRoot: repo },
    );
    assert.equal(res.satisfied, false);
  });

  it('build-must-pass: satisfied on exit 0', () => {
    const repo = tmpRoot();
    const res = verifyObligation(
      { type: 'build-must-pass', command: 'true' },
      { repoRoot: repo },
    );
    assert.equal(res.satisfied, true);
  });

  it('build-must-pass: unsatisfied on non-zero exit', () => {
    const repo = tmpRoot();
    const res = verifyObligation(
      { type: 'build-must-pass', command: 'false' },
      { repoRoot: repo },
    );
    assert.equal(res.satisfied, false);
    assert.match(res.detail, /exited 1/);
  });

  it('test-must-pass: command runs in repoRoot', () => {
    const repo = tmpRoot();
    const res = verifyObligation(
      { type: 'test-must-pass', command: 'pwd' },
      { repoRoot: repo },
    );
    assert.equal(res.satisfied, true);
  });
});
