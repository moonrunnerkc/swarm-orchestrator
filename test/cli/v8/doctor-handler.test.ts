import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleDoctor } from '../../../src/cli/v8/doctor-handler';

/**
 * Doctor probes the local environment. The tests exercise the
 * pass/fail bookkeeping for the cwd probe and the API-key probe
 * (those are deterministic). The CLI-on-PATH probes depend on the
 * test machine's installed binaries and are exercised indirectly via
 * the "no required failures" path with a long ANTHROPIC_API_KEY set.
 *
 * The --fix tests verify that auto-fixable issues are resolved when
 * the flag is provided.
 */

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cli/v8 doctor-handler', () => {
  it('returns exit 9 when ANTHROPIC_API_KEY is missing', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const cwd = tmp('doctor-no-key-');
    try {
      const exit = await handleDoctor(['--cwd', cwd]);
      assert.equal(exit, 9);
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('returns exit 0 when API key is present, cwd is writable, and a package manager is on PATH', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    // Stub a key with realistic length (>= 20 chars).
    process.env.ANTHROPIC_API_KEY = 'sk-test-' + 'x'.repeat(40);
    const cwd = tmp('doctor-ok-');
    // Pre-create .swarm/ structure so doctor's new probes pass
    fs.mkdirSync(path.join(cwd, '.swarm', 'ledger'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.swarm', 'contracts'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'contract.yaml'), 'obligations: []\n', 'utf8');
    try {
      const exit = await handleDoctor(['--cwd', cwd]);
      // npm ships with Node so it should be on PATH on the test machine.
      assert.equal(exit, 0);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('returns exit 9 when --require-git is set and cwd is not inside a git repo', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-' + 'x'.repeat(40);
    const cwd = tmp('doctor-no-git-');
    try {
      const exit = await handleDoctor(['--cwd', cwd, '--require-git']);
      assert.equal(exit, 9);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects unknown flags', async () => {
    await assert.rejects(() => handleDoctor(['--garbage']), /unknown flag/);
  });

  it('detects missing .swarm/ directory without --fix', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-' + 'x'.repeat(40);
    const cwd = tmp('doctor-no-swarm-');
    try {
      // Without .swarm/ and without --fix, doctor should fail (exit 9)
      // because missing .swarm/ is required
      const exit = await handleDoctor(['--cwd', cwd]);
      assert.equal(exit, 9);
      // .swarm/ should NOT have been created
      assert.equal(fs.existsSync(path.join(cwd, '.swarm')), false);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('creates missing .swarm/ directory structure with --fix', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-' + 'x'.repeat(40);
    const cwd = tmp('doctor-fix-swarm-');
    try {
      // With --fix, doctor should auto-create .swarm/ and subdirs
      const exit = await handleDoctor(['--cwd', cwd, '--fix']);
      // After fixing, .swarm/ should exist with required subdirs
      assert.equal(fs.existsSync(path.join(cwd, '.swarm')), true);
      assert.equal(fs.existsSync(path.join(cwd, '.swarm', 'ledger')), true);
      assert.equal(fs.existsSync(path.join(cwd, '.swarm', 'contracts')), true);
      assert.equal(fs.existsSync(path.join(cwd, '.swarm', 'snapshots')), true);
      // contract.yaml should be created
      assert.equal(fs.existsSync(path.join(cwd, '.swarm', 'contract.yaml')), true);
      // All required issues fixed, so exit should be 0 now
      assert.equal(exit, 0);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('removes stale lock files with --fix', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-' + 'x'.repeat(40);
    const cwd = tmp('doctor-fix-locks-');
    try {
      // Pre-create .swarm/ with locks directory containing stale files
      const locksDir = path.join(cwd, '.swarm', 'locks');
      fs.mkdirSync(locksDir, { recursive: true });
      fs.writeFileSync(path.join(locksDir, 'run-001.lock'), 'dummy', 'utf8');
      fs.writeFileSync(path.join(locksDir, 'run-002.lock'), 'dummy', 'utf8');
      // Also create required subdirs so doctor doesn't fail on those
      fs.mkdirSync(path.join(cwd, '.swarm', 'ledger'), { recursive: true });
      fs.mkdirSync(path.join(cwd, '.swarm', 'contracts'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'contract.yaml'), 'obligations: []\n', 'utf8');

      const exit = await handleDoctor(['--cwd', cwd, '--fix']);
      // Lock files should have been removed
      assert.equal(fs.readdirSync(locksDir).length, 0);
      assert.equal(exit, 0);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('creates missing patches.jsonl with --fix', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-' + 'x'.repeat(40);
    const cwd = tmp('doctor-fix-patches-');
    try {
      // Pre-create .swarm/ with required subdirs but no patches.jsonl
      fs.mkdirSync(path.join(cwd, '.swarm', 'ledger'), { recursive: true });
      fs.mkdirSync(path.join(cwd, '.swarm', 'contracts'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'contract.yaml'), 'obligations: []\n', 'utf8');

      const exit = await handleDoctor(['--cwd', cwd, '--fix']);
      // patches.jsonl should have been created (in .swarm/) with one no-op
      // envelope per default obligation so a subsequent `swarm run` does
      // not hit deterministic queue-exhaustion immediately.
      assert.equal(fs.existsSync(path.join(cwd, '.swarm', 'patches.jsonl')), true);
      const patchesText = fs.readFileSync(path.join(cwd, '.swarm', 'patches.jsonl'), 'utf8');
      const patchLines = patchesText.split('\n').filter((l) => l.trim().length > 0);
      assert.ok(patchLines.length >= 1, 'expected at least one envelope');
      for (const line of patchLines) {
        const env = JSON.parse(line);
        assert.equal(env.patch, 'no-op');
        assert.equal(env.source, 'swarm-doctor');
      }
      assert.equal(exit, 0);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not auto-fix without --fix flag', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-' + 'x'.repeat(40);
    const cwd = tmp('doctor-no-fix-');
    try {
      // Without --fix, nothing should be created
      const exit = await handleDoctor(['--cwd', cwd]);
      // .swarm/ should NOT have been created
      assert.equal(fs.existsSync(path.join(cwd, '.swarm')), false);
      assert.equal(exit, 9);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});