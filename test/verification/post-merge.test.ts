import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import { postMergeVerify } from '../../src/verification/post-merge';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-post-merge-'));
}

describe('post-merge integration verification (Phase 6)', () => {
  it('passes when every obligation re-verifies', () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'README.md'), '# x');
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'g',
      repoContext: { repoRoot: root, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'README.md' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    const r = postMergeVerify({ contract, verifyOptions: { repoRoot: root } });
    assert.equal(r.passed, true);
    assert.equal(r.failedCount, 0);
    assert.equal(r.obligationCount, 3);
    assert.ok(r.outcomes.every((o) => o.passed));
  });

  it('surfaces per-obligation failures when one regresses', () => {
    const root = tmpDir();
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'g',
      repoContext: { repoRoot: root, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'NOT_THERE.md' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    const r = postMergeVerify({ contract, verifyOptions: { repoRoot: root } });
    assert.equal(r.passed, false);
    assert.equal(r.failedCount, 1);
    assert.equal(r.outcomes[0]?.passed, false);
    assert.equal(r.outcomes[1]?.passed, true);
    assert.match(r.outcomes[0]?.detail ?? '', /does not exist/);
  });

  it('catches the integration-class failure: two obligations that conflict at the workspace', () => {
    // A pair of obligations where only one wins in practice. Emulate by
    // having two file-must-exist obligations on the same path with
    // different content expectations expressed only as a build command
    // that re-asserts the file body. Pre-merge each verifies in
    // isolation; post-merge sees the post-conflict state.
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'config'), 'value=A');
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'g',
      repoContext: { repoRoot: root, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'config' },
        // This build asserts the file says "value=B", which contradicts
        // the actual post-merge content.
        { type: 'build-must-pass', command: `grep -q value=B config` },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    const r = postMergeVerify({ contract, verifyOptions: { repoRoot: root } });
    assert.equal(r.passed, false);
    // file exists, so [0] passes; the build [1] fails post-merge.
    assert.equal(r.outcomes[0]?.passed, true);
    assert.equal(r.outcomes[1]?.passed, false);
  });
});
