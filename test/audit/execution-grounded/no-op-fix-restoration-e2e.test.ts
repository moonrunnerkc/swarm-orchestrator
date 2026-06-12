import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runNoOpFixRestoration } from '../../../src/audit/execution-grounded/no-op-fix-restoration';
import type { PrIntent } from '../../../src/audit/cheat-detector/pr-intent';

// End-to-end demonstration of the no-op-fix-proven proof against a real git repo
// and a real test runner (vitest), gated behind SWARM_EG_INTEGRATION so the
// default `npm test` stays offline and deterministic. It builds two synthetic
// PRs, each claiming a fix: one whose source change no test verifies (proven
// no-op) and one whose fix a test does verify (refuted), and confirms the
// published reproduce path of the proven case actually shows the affected test
// still passing with the fix reverted in a fresh checkout.
const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const CLAIMS_FIX: PrIntent = { claimsFix: true, evidence: 'fix: totals (#1)' };

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

function scaffold(dir: string, totalsSource: string, testBody: string): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'noop-demo', version: '1.0.0', type: 'module', private: true }, null, 2),
  );
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(dir, 'src', 'totals.js'), totalsSource);
  fs.writeFileSync(path.join(dir, 'test', 'totals.test.js'), testBody);
}

function commitAll(dir: string, message: string): string {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
}

(INTEGRATION ? describe : describe.skip)('no-op-fix-proven e2e (live vitest)', function () {
  this.timeout(240_000);

  // The test reaches compute() but only asserts its return type, so the "+0"
  // tidy the PR claims as a fix changes nothing the suite observes.
  const TYPE_ONLY_TEST = [
    "import { describe, it, expect } from 'vitest';",
    "import { compute } from '../src/totals.js';",
    '',
    "describe('totals', () => {",
    "  it('returns a number', () => {",
    '    expect(typeof compute({ a: 2, b: 3 })).toBe(\'number\');',
    '  });',
    '});',
    '',
  ].join('\n');

  // This test asserts the exact sum, so reverting a real fix breaks it.
  const VALUE_TEST = [
    "import { describe, it, expect } from 'vitest';",
    "import { compute } from '../src/totals.js';",
    '',
    "describe('totals', () => {",
    "  it('sums the line items', () => {",
    '    expect(compute({ a: 2, b: 3 })).toBe(5);',
    '  });',
    '});',
    '',
  ].join('\n');

  it('proves a no-op fix and the reproduce path shows the affected test still passing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-noopproof-'));
    try {
      scaffold(dir, 'export function compute(x) {\n  return x.a + x.b;\n}\n', TYPE_ONLY_TEST);
      git(dir, ['init', '-q']);
      git(dir, ['config', 'user.email', 'demo@example.com']);
      git(dir, ['config', 'user.name', 'demo']);
      commitAll(dir, 'base: compute with a type-only test');

      // The "fix": a no-op tidy the test cannot observe.
      fs.writeFileSync(
        path.join(dir, 'src', 'totals.js'),
        'export function compute(x) {\n  return x.a + x.b + 0; // fix\n}\n',
      );
      const headSha = commitAll(dir, 'fix: totals (#1)');
      assert.equal(runVitest(dir, 'test/totals.test.js'), true, 'submitted suite passes');
      const prDiff = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;

      const record = runNoOpFixRestoration({
        finding: { category: 'no-op-fix', file: 'src/totals.js' },
        prDiff,
        prRef: 'acme/totals#1',
        prHeadSha: headSha,
        prIntent: CLAIMS_FIX,
        linkedIssueCount: 0,
        postWorkspacePath: dir,
        repoRoot: dir,
        testRunner: 'vitest',
        packageManager: 'npm',
        timeoutMs: 180_000,
      });

      assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
      assert.equal(record.controls.prClaimsFix, true);
      assert.equal(record.controls.suitePassesAsSubmitted, true);
      assert.equal(record.controls.revertedSuiteStillPassesTwice, true);
      assert.deepEqual(record.affectedTestFiles, ['test/totals.test.js']);

      // Reproduce in a FRESH checkout: the affected test must STILL PASS with the
      // fix reverted (that passing-despite-revert is the no-op proof).
      const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-noopproof-fresh-'));
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
          true,
          'the affected test must still pass with the fix reverted (the no-op proof)',
        );
      } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refutes a real fix that a test verifies', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-noopproof-refute-'));
    try {
      // BUG on base: drops x.b. The value test fails on base.
      scaffold(dir, 'export function compute(x) {\n  return x.a;\n}\n', VALUE_TEST);
      git(dir, ['init', '-q']);
      git(dir, ['config', 'user.email', 'demo@example.com']);
      git(dir, ['config', 'user.name', 'demo']);
      commitAll(dir, 'base: buggy compute with a value test');

      // The real fix: now the value test passes.
      fs.writeFileSync(
        path.join(dir, 'src', 'totals.js'),
        'export function compute(x) {\n  return x.a + x.b;\n}\n',
      );
      const headSha = commitAll(dir, 'fix: totals sum (#1)');
      assert.equal(runVitest(dir, 'test/totals.test.js'), true, 'fixed suite passes');
      const prDiff = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;

      const record = runNoOpFixRestoration({
        finding: { category: 'no-op-fix', file: 'src/totals.js' },
        prDiff,
        prRef: 'acme/totals#1',
        prHeadSha: headSha,
        prIntent: CLAIMS_FIX,
        linkedIssueCount: 0,
        postWorkspacePath: dir,
        repoRoot: dir,
        testRunner: 'vitest',
        packageManager: 'npm',
        timeoutMs: 180_000,
      });

      assert.equal(record.verdict, 'refuted', `expected refuted, got ${record.verdict}: ${record.reason ?? ''}`);
      assert.equal(record.controls.revertedSuiteStillPassesTwice, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
