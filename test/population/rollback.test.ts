import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import type { WorkspaceSnapshotEntry } from '../../src/ledger/types';
import { gitHashObject, snapshotBeforeApply } from '../../src/population/diff-snapshot';
import { rollbackObligation } from '../../src/population/rollback';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('population/rollback', () => {
  it('happy path: file-must-exist on absent pre-apply unlinks file', async () => {
    const repo = tmpDir('v8-rb-');
    const obligation = { type: 'file-must-exist' as const, path: 'created.ts' };
    const pre = snapshotBeforeApply(repo, 'r1', obligation, 0, '```\nhello\n```');
    assert.ok(pre);
    fs.writeFileSync(path.join(repo, 'created.ts'), 'hello\n', 'utf8');
    const postSha = gitHashObject(fs.readFileSync(path.join(repo, 'created.ts')));

    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    ledger.append<WorkspaceSnapshotEntry>({
      type: 'workspace-snapshot',
      obligationIndex: 0,
      files: [
        { path: 'created.ts', preBlobSha: 'absent', expectedPostBlobSha: postSha },
      ],
    });

    const rb = await rollbackObligation(0, ledger, repo, 'r1', 'per-obligation-falsification');
    assert.equal(rb.success, true);
    assert.equal(rb.restoredFiles.length, 1);
    assert.equal(rb.restoredFiles[0]?.restoredBlobSha, 'absent');
    assert.equal(fs.existsSync(path.join(repo, 'created.ts')), false);
  });

  it('happy path: existing file restored to pre-apply content', async () => {
    const repo = tmpDir('v8-rb-');
    const original = 'original\n';
    fs.writeFileSync(path.join(repo, 'mutated.ts'), original, 'utf8');
    const obligation = { type: 'file-must-exist' as const, path: 'mutated.ts' };
    const pre = snapshotBeforeApply(repo, 'r1', obligation, 1, '```\nnew\n```');
    assert.ok(pre);
    fs.writeFileSync(path.join(repo, 'mutated.ts'), 'new\n', 'utf8');
    const postSha = gitHashObject(fs.readFileSync(path.join(repo, 'mutated.ts')));

    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    const files = pre.files.map((f) => ({
      path: f.path,
      preBlobSha: f.preBlobSha,
      expectedPostBlobSha: postSha,
    }));
    ledger.append<WorkspaceSnapshotEntry>({
      type: 'workspace-snapshot',
      obligationIndex: 1,
      files,
    });

    const rb = await rollbackObligation(1, ledger, repo, 'r1', 'per-obligation-falsification');
    assert.equal(rb.success, true);
    assert.equal(rb.restoredFiles.length, 1);
    const restored = fs.readFileSync(path.join(repo, 'mutated.ts'), 'utf8');
    assert.equal(restored, original);
    assert.equal(rb.restoredFiles[0]?.restoredBlobSha, pre.files[0]?.preBlobSha);
  });

  it('recovery invariant violated: corrupt sidecar detected', async () => {
    const repo = tmpDir('v8-rb-');
    const original = 'original\n';
    fs.writeFileSync(path.join(repo, 'bad.ts'), original, 'utf8');
    const obligation = { type: 'file-must-exist' as const, path: 'bad.ts' };
    const pre = snapshotBeforeApply(repo, 'r1', obligation, 2, '```\nnew\n```');
    assert.ok(pre);
    fs.writeFileSync(path.join(repo, 'bad.ts'), 'new\n', 'utf8');
    const postSha = gitHashObject(fs.readFileSync(path.join(repo, 'bad.ts')));

    // Corrupt the sidecar so rollback writes garbage.
    const sha = pre.files[0]?.preBlobSha;
    assert.ok(sha && sha !== 'absent');
    const sidecar = path.join(repo, '.swarm', 'snapshots', 'r1', '2', sha);
    fs.writeFileSync(sidecar, 'garbage\n');

    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    const files = pre.files.map((f) => ({
      path: f.path,
      preBlobSha: f.preBlobSha,
      expectedPostBlobSha: postSha,
    }));
    ledger.append<WorkspaceSnapshotEntry>({
      type: 'workspace-snapshot',
      obligationIndex: 2,
      files,
    });

    const rb = await rollbackObligation(2, ledger, repo, 'r1', 'per-obligation-falsification');
    assert.equal(rb.success, false);
    assert.equal(rb.failure?.kind, 'recovery-invariant-violated');
    assert.equal(rb.failure?.offendingPath, 'bad.ts');
  });

  it('state-mismatch: out-of-band mutation detected', async () => {
    const repo = tmpDir('v8-rb-');
    const original = 'original\n';
    fs.writeFileSync(path.join(repo, 'stale.ts'), original, 'utf8');
    const obligation = { type: 'file-must-exist' as const, path: 'stale.ts' };
    const pre = snapshotBeforeApply(repo, 'r1', obligation, 3, '```\nnew\n```');
    assert.ok(pre);
    fs.writeFileSync(path.join(repo, 'stale.ts'), 'new\n', 'utf8');
    const postSha = gitHashObject(fs.readFileSync(path.join(repo, 'stale.ts')));

    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    const files = pre.files.map((f) => ({
      path: f.path,
      preBlobSha: f.preBlobSha,
      expectedPostBlobSha: postSha,
    }));
    ledger.append<WorkspaceSnapshotEntry>({
      type: 'workspace-snapshot',
      obligationIndex: 3,
      files,
    });

    // Mutate out-of-band.
    fs.writeFileSync(path.join(repo, 'stale.ts'), 'tampered\n', 'utf8');

    const rb = await rollbackObligation(3, ledger, repo, 'r1', 'per-obligation-falsification');
    assert.equal(rb.success, false);
    assert.equal(rb.failure?.kind, 'state-mismatch');
    assert.equal(rb.failure?.offendingPath, 'stale.ts');
    const onDisk = fs.readFileSync(path.join(repo, 'stale.ts'), 'utf8');
    assert.equal(onDisk, 'tampered\n');
  });

  it('idempotency: second rollback is a no-op', async () => {
    const repo = tmpDir('v8-rb-');
    const original = 'original\n';
    fs.writeFileSync(path.join(repo, 'idempotent.ts'), original, 'utf8');
    const obligation = { type: 'file-must-exist' as const, path: 'idempotent.ts' };
    const pre = snapshotBeforeApply(repo, 'r1', obligation, 4, '```\nnew\n```');
    assert.ok(pre);
    fs.writeFileSync(path.join(repo, 'idempotent.ts'), 'new\n', 'utf8');
    const postSha = gitHashObject(fs.readFileSync(path.join(repo, 'idempotent.ts')));

    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    const files = pre.files.map((f) => ({
      path: f.path,
      preBlobSha: f.preBlobSha,
      expectedPostBlobSha: postSha,
    }));
    ledger.append<WorkspaceSnapshotEntry>({
      type: 'workspace-snapshot',
      obligationIndex: 4,
      files,
    });

    const rb1 = await rollbackObligation(4, ledger, repo, 'r1', 'per-obligation-falsification');
    assert.equal(rb1.success, true);
    const rb2 = await rollbackObligation(4, ledger, repo, 'r1', 'per-obligation-falsification');
    assert.equal(rb2.success, true);
    assert.equal(rb2.restoredFiles[0]?.restoredBlobSha, pre.files[0]?.preBlobSha);
    const onDisk = fs.readFileSync(path.join(repo, 'idempotent.ts'), 'utf8');
    assert.equal(onDisk, original);
  });

  it('no-snapshot-found: returns cleanly without touching workspace', async () => {
    const repo = tmpDir('v8-rb-');
    fs.writeFileSync(path.join(repo, 'unchanged.ts'), 'x\n', 'utf8');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    const rb = await rollbackObligation(99, ledger, repo, 'r1', 'post-merge-regression');
    assert.equal(rb.success, false);
    assert.equal(rb.failure?.kind, 'no-snapshot-found');
    assert.equal(fs.readFileSync(path.join(repo, 'unchanged.ts'), 'utf8'), 'x\n');
  });
});
