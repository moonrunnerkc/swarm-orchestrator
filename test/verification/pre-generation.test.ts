import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { preVerifyObligations } from '../../src/verification/pre-generation';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-pre-gen-'));
}

describe('pre-generation verification (Phase 6)', () => {
  it('skips obligations the live workspace already satisfies', () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'README.md'), '# x');
    const r = preVerifyObligations({
      obligations: [
        { type: 'file-must-exist', path: 'README.md' },
        { type: 'file-must-exist', path: 'MISSING.md' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'false' },
      ],
      verifyOptions: { repoRoot: root },
    });
    assert.equal(r.checks.length, 4);
    assert.deepEqual(
      [...r.satisfiedIndexes].sort((a, b) => a - b),
      [0, 2],
    );
    assert.equal(r.checks[0]?.satisfied, true);
    assert.equal(r.checks[1]?.satisfied, false);
    assert.equal(r.checks[2]?.satisfied, true);
    assert.equal(r.checks[3]?.satisfied, false);
  });

  it('honors skipIndexes and never invokes a verify on excluded indexes', () => {
    const root = tmpDir();
    const r = preVerifyObligations({
      obligations: [
        { type: 'file-must-exist', path: 'X.md' },
        { type: 'build-must-pass', command: 'true' },
      ],
      skipIndexes: new Set([0, 1]),
      verifyOptions: { repoRoot: root },
    });
    // Both excluded — no checks ran.
    assert.equal(r.checks.length, 0);
    assert.equal(r.satisfiedIndexes.size, 0);
  });

  it('returns empty when the contract has no obligations', () => {
    const root = tmpDir();
    const r = preVerifyObligations({
      obligations: [],
      verifyOptions: { repoRoot: root },
    });
    assert.equal(r.checks.length, 0);
    assert.equal(r.satisfiedIndexes.size, 0);
  });
});
