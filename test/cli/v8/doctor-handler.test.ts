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
});
