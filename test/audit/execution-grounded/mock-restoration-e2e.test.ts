import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runMockRestoration } from '../../../src/audit/execution-grounded/mock-restoration';

// End-to-end demonstration of the mock-mutation-proven proof against a real
// git repo and a real test runner (vitest), gated behind SWARM_EG_INTEGRATION
// so the default `npm test` stays offline and deterministic. It builds a
// synthetic PR that conceals a real bug behind a value-injecting mock, runs
// the proof, and confirms the published reproduce path actually reproduces
// the un-mocked failure in a fresh checkout.
const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

function runVitest(cwd: string, file: string): boolean {
  const r = spawnSync('npx', ['vitest', 'run', file], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  });
  return r.status === 0;
}

// A self-contained repo: a buggy `compute` (drops x.b) and a test that asserts
// the correct sum, so the test fails on the real unit. The base test below
// uses the real unit; the "PR" rewires it to a mock.
function writeRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'totals-demo', version: '1.0.0', type: 'module', private: true }, null, 2),
  );
  // node_modules symlinked from the host so `npx vitest` resolves offline; keep
  // it out of git so the PR diff is just the source and test change.
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  // BUG: returns x.a, dropping x.b.
  fs.writeFileSync(path.join(dir, 'src', 'totals.js'), 'export function compute(x) {\n  return x.a;\n}\n');
  fs.writeFileSync(
    path.join(dir, 'test', 'totals.test.js'),
    [
      "import { describe, it, expect, vi } from 'vitest';",
      "import { compute as realCompute } from '../src/totals.js';",
      '',
      "describe('totals', () => {",
      "  it('sums the line items', () => {",
      '    const input = { a: 2, b: 3 };',
      '    const expected = 5;',
      '    const compute = realCompute;',
      '    const out = compute(input);',
      '    expect(out).toEqual(expected);',
      '  });',
      '});',
      '',
    ].join('\n'),
  );
}

// The cheat: instead of fixing compute, the PR rewires the test's local
// `compute` to a mock that returns the asserted value.
function applyCheat(dir: string): void {
  const p = path.join(dir, 'test', 'totals.test.js');
  const src = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(
    p,
    src.replace(
      '    const compute = realCompute;',
      '    const compute = vi.fn().mockReturnValue(expected);',
    ),
  );
}

(INTEGRATION ? describe : describe.skip)('mock-mutation-proven e2e (live vitest)', function () {
  this.timeout(180_000);

  it('proves the cheat and the reproduce path reproduces the un-mocked failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-mockproof-'));
    try {
      writeRepo(dir);
      git(dir, ['init', '-q']);
      git(dir, ['config', 'user.email', 'demo@example.com']);
      git(dir, ['config', 'user.name', 'demo']);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'base: buggy compute with a failing test']);

      // The base test fails on the real (buggy) unit: that is the failure the
      // mock will conceal.
      assert.equal(runVitest(dir, 'test/totals.test.js'), false, 'base test must fail');

      applyCheat(dir);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'fix totals (cheat: mock returns the asserted value)']);
      const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();

      // The mocked test now passes as submitted.
      assert.equal(runVitest(dir, 'test/totals.test.js'), true, 'mocked test must pass');

      const prDiff = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;

      const record = runMockRestoration({
        finding: { category: 'cheat-mock-mutation', file: 'test/totals.test.js' },
        prDiff,
        prRef: 'acme/totals#9',
        prHeadSha: headSha,
        postWorkspacePath: dir,
        testRunner: 'vitest',
        packageManager: 'npm',
        timeoutMs: 120_000,
      });

      assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
      assert.equal(record.controls.tamperedSuitePasses, true);
      assert.equal(record.controls.restoredFailsTwiceSameIdentity, true);
      assert.equal(record.controls.mockReturnsAssertedValue, true);
      assert.ok(record.failingTests.length > 0, 'names the restored failing test');

      // Reproduce in a FRESH checkout: clone the repo, check out the head, apply
      // the published reverted-hunk patch, and rerun the test. The proof's
      // reproduce command does exactly this (its git fetch resolves to this
      // local clone); reproducing it here proves the comment's claim.
      const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-mockproof-fresh-'));
      try {
        git(fresh, ['clone', '-q', dir, '.']);
        fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(fresh, 'node_modules'));
        git(fresh, ['checkout', '-q', headSha]);
        const apply = spawnSync('git', ['apply', '-R', '--whitespace=nowarn', '-'], {
          cwd: fresh,
          input: record.revertedHunkPatch,
          encoding: 'utf8',
        });
        assert.equal(apply.status, 0, `reverse-apply failed: ${apply.stderr}`);
        assert.equal(
          runVitest(fresh, 'test/totals.test.js'),
          false,
          'the reproduce path must restore the un-mocked failure',
        );
      } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
