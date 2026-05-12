import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  cleanupSnapshots,
  parseSnapshotPolicy,
  snapshotRoot,
} from '../../src/population/snapshot-cleanup';

function mkRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'snap-cleanup-'));
}

function seedRun(repoRoot: string, runId: string, files: Record<string, string> = { 'a.txt': 'x' }): string {
  const dir = path.join(snapshotRoot(repoRoot), runId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

describe('snapshot-cleanup', () => {
  describe('parseSnapshotPolicy', () => {
    it('parses retain-on-failure', () => {
      assert.deepEqual(parseSnapshotPolicy('retain-on-failure'), { kind: 'retain-on-failure' });
    });
    it('parses always and never', () => {
      assert.deepEqual(parseSnapshotPolicy('always'), { kind: 'always' });
      assert.deepEqual(parseSnapshotPolicy('never'), { kind: 'never' });
    });
    it('parses retain-last:N', () => {
      assert.deepEqual(parseSnapshotPolicy('retain-last:3'), { kind: 'retain-last-n', n: 3 });
    });
    it('parses max-age durations', () => {
      assert.deepEqual(parseSnapshotPolicy('max-age:7d'), { kind: 'max-age-ms', maxAgeMs: 7 * 86_400_000 });
      assert.deepEqual(parseSnapshotPolicy('max-age:30m'), { kind: 'max-age-ms', maxAgeMs: 30 * 60_000 });
      assert.deepEqual(parseSnapshotPolicy('max-age:500ms'), { kind: 'max-age-ms', maxAgeMs: 500 });
    });
    it('parses max-disk sizes', () => {
      assert.deepEqual(parseSnapshotPolicy('max-disk:100MB'), { kind: 'max-disk-bytes', maxBytes: 100 * 1024 * 1024 });
      assert.deepEqual(parseSnapshotPolicy('max-disk:2GB'), { kind: 'max-disk-bytes', maxBytes: 2 * 1024 * 1024 * 1024 });
    });
    it('rejects malformed input', () => {
      assert.throws(() => parseSnapshotPolicy('bogus'));
      assert.throws(() => parseSnapshotPolicy('retain-last:'));
      assert.throws(() => parseSnapshotPolicy('max-age:foo'));
    });
  });

  describe('cleanupSnapshots', () => {
    it('returns empty result when snapshot root does not exist', () => {
      const repo = mkRepo();
      const r = cleanupSnapshots(repo, 'r1', false, { kind: 'always' });
      assert.deepEqual(r.removedRuns, []);
      assert.equal(r.bytesReclaimed, 0);
    });

    it('retain-on-failure: removes successful run dir', () => {
      const repo = mkRepo();
      const dir = seedRun(repo, 'run-a');
      assert.ok(fs.existsSync(dir));
      const r = cleanupSnapshots(repo, 'run-a', false, { kind: 'retain-on-failure' });
      assert.deepEqual(r.removedRuns, ['run-a']);
      assert.ok(!fs.existsSync(dir));
    });

    it('retain-on-failure: keeps failed run dir', () => {
      const repo = mkRepo();
      const dir = seedRun(repo, 'run-b');
      const r = cleanupSnapshots(repo, 'run-b', true, { kind: 'retain-on-failure' });
      assert.deepEqual(r.removedRuns, []);
      assert.ok(fs.existsSync(dir));
    });

    it('always: removes regardless of failure', () => {
      const repo = mkRepo();
      seedRun(repo, 'run-c');
      const r = cleanupSnapshots(repo, 'run-c', true, { kind: 'always' });
      assert.deepEqual(r.removedRuns, ['run-c']);
    });

    it('never: keeps everything', () => {
      const repo = mkRepo();
      seedRun(repo, 'run-d');
      const r = cleanupSnapshots(repo, 'run-d', false, { kind: 'never' });
      assert.deepEqual(r.removedRuns, []);
      assert.ok(fs.existsSync(path.join(snapshotRoot(repo), 'run-d')));
    });

    it('is idempotent', () => {
      const repo = mkRepo();
      seedRun(repo, 'run-e');
      cleanupSnapshots(repo, 'run-e', false, { kind: 'always' });
      const second = cleanupSnapshots(repo, 'run-e', false, { kind: 'always' });
      assert.deepEqual(second.removedRuns, []);
    });

    it('retain-last-n keeps the N most-recent run dirs', () => {
      const repo = mkRepo();
      seedRun(repo, 'r1');
      seedRun(repo, 'r2');
      seedRun(repo, 'r3');
      seedRun(repo, 'r4');
      // Stagger mtimes so newest-first ordering is well-defined.
      const root = snapshotRoot(repo);
      const now = Date.now();
      fs.utimesSync(path.join(root, 'r1', 'a.txt'), now / 1000 - 4000, now / 1000 - 4000);
      fs.utimesSync(path.join(root, 'r2', 'a.txt'), now / 1000 - 3000, now / 1000 - 3000);
      fs.utimesSync(path.join(root, 'r3', 'a.txt'), now / 1000 - 2000, now / 1000 - 2000);
      fs.utimesSync(path.join(root, 'r4', 'a.txt'), now / 1000 - 1000, now / 1000 - 1000);
      fs.utimesSync(path.join(root, 'r1'), now / 1000 - 4000, now / 1000 - 4000);
      fs.utimesSync(path.join(root, 'r2'), now / 1000 - 3000, now / 1000 - 3000);
      fs.utimesSync(path.join(root, 'r3'), now / 1000 - 2000, now / 1000 - 2000);
      fs.utimesSync(path.join(root, 'r4'), now / 1000 - 1000, now / 1000 - 1000);
      // Current run "r4" succeeded; policy will drop it then keep last 2 of {r1, r2, r3}.
      cleanupSnapshots(repo, 'r4', false, { kind: 'retain-last-n', n: 2 });
      const remaining = fs.readdirSync(root).sort();
      assert.deepEqual(remaining, ['r2', 'r3']);
    });

    it('max-age-ms prunes older run dirs', () => {
      const repo = mkRepo();
      seedRun(repo, 'old');
      seedRun(repo, 'new');
      const root = snapshotRoot(repo);
      const now = Date.now();
      const oldT = (now - 10_000) / 1000;
      const newT = now / 1000;
      fs.utimesSync(path.join(root, 'old', 'a.txt'), oldT, oldT);
      fs.utimesSync(path.join(root, 'new', 'a.txt'), newT, newT);
      fs.utimesSync(path.join(root, 'old'), oldT, oldT);
      fs.utimesSync(path.join(root, 'new'), newT, newT);
      // Mark "current" as a non-existent run so neither is forcibly removed.
      cleanupSnapshots(repo, 'current-noop', true, { kind: 'max-age-ms', maxAgeMs: 5000 });
      const remaining = fs.readdirSync(root).sort();
      assert.deepEqual(remaining, ['new']);
    });

    it('max-disk-bytes prunes oldest until under cap', () => {
      const repo = mkRepo();
      seedRun(repo, 'r1', { 'a.bin': 'x'.repeat(2000) });
      seedRun(repo, 'r2', { 'a.bin': 'x'.repeat(2000) });
      seedRun(repo, 'r3', { 'a.bin': 'x'.repeat(2000) });
      const root = snapshotRoot(repo);
      const now = Date.now() / 1000;
      fs.utimesSync(path.join(root, 'r1', 'a.bin'), now - 300, now - 300);
      fs.utimesSync(path.join(root, 'r2', 'a.bin'), now - 200, now - 200);
      fs.utimesSync(path.join(root, 'r3', 'a.bin'), now - 100, now - 100);
      cleanupSnapshots(repo, 'no-current', true, { kind: 'max-disk-bytes', maxBytes: 4500 });
      // r1 (oldest) should be pruned; r2 + r3 fit under 4500 bytes.
      const remaining = fs.readdirSync(root).sort();
      assert.deepEqual(remaining, ['r2', 'r3']);
    });

    it('crash-safe: tolerates already-removed dir between scan and rm', () => {
      const repo = mkRepo();
      const dir = seedRun(repo, 'r1');
      fs.rmSync(dir, { recursive: true, force: true });
      const r = cleanupSnapshots(repo, 'r1', false, { kind: 'always' });
      assert.deepEqual(r.removedRuns, []);
    });
  });
});
