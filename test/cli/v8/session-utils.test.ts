import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_PROJECT_CONTEXT_PREAMBLE,
  parseCandidates,
  renderProjectContext,
  writeResultFile,
} from '../../../src/cli/v8/session-utils';

describe('cli/v8/session-utils', () => {
  describe('renderProjectContext', () => {
    it('opens with the cached preamble', () => {
      const ctx = renderProjectContext('add a feature', '/repo');
      assert.ok(ctx.startsWith(DEFAULT_PROJECT_CONTEXT_PREAMBLE));
    });

    it('includes the repo root and the user goal as labeled lines', () => {
      const ctx = renderProjectContext('add a feature', '/repo');
      assert.match(ctx, /Repository root: \/repo/);
      assert.match(ctx, /User goal: add a feature/);
    });
  });

  describe('parseCandidates', () => {
    it('accepts a positive integer in the documented range', () => {
      assert.equal(parseCandidates('3'), 3);
      assert.equal(parseCandidates('8'), 8);
    });

    it('rejects zero, negative numbers, and non-numerics', () => {
      assert.throws(() => parseCandidates('0'), /must be a positive integer/);
      assert.throws(() => parseCandidates('-1'), /must be a positive integer/);
      assert.throws(() => parseCandidates('foo'), /must be a positive integer/);
    });

    it('rejects values above the prompt-cache budget ceiling', () => {
      assert.throws(() => parseCandidates('9'), /must be a positive integer/);
    });
  });

  describe('writeResultFile', () => {
    it('creates parent directories and writes a trailing-newline JSON payload', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-utils-'));
      const target = path.join(tmp, 'nested', 'result.json');
      writeResultFile(target, { runId: 'r1', status: 'ok' });
      const text = fs.readFileSync(target, 'utf8');
      assert.ok(text.endsWith('\n'));
      const parsed = JSON.parse(text);
      assert.equal(parsed.runId, 'r1');
      assert.equal(parsed.status, 'ok');
    });
  });
});
