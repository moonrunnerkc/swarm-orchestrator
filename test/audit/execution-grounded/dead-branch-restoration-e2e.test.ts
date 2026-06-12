import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runDeadBranchRestoration } from '../../../src/audit/execution-grounded/dead-branch-restoration';

// End-to-end demonstration of the dead-branch-proven proof against a real git
// repo and a real test runner (mocha, CommonJS), gated behind
// SWARM_EG_INTEGRATION so the default `npm test` stays offline and
// deterministic. It builds two synthetic PRs: one that inserts a genuinely dead
// `if (false)` branch the suite reaches but never enters (proven), and one that
// inserts a live branch the suite does enter (refuted). The runner is mocha and
// the workspace is CommonJS so the injected `require('node:fs')` probe records
// reliably; pure-ESM projects fail closed to not-proven:control-not-reached,
// which the unit test covers.
const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

function runMocha(cwd: string, file: string): boolean {
  const r = spawnSync('npx', ['mocha', file], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  });
  return r.status === 0;
}

const TEST_BODY = [
  "const assert = require('assert');",
  "const { compute } = require('../src/totals');",
  '',
  "describe('totals', () => {",
  "  it('sums the line items', () => {",
  '    assert.equal(compute({ a: 2, b: 3 }), 5);',
  '  });',
  '});',
  '',
].join('\n');

function scaffold(dir: string, totalsSource: string): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'deadbranch-demo', version: '1.0.0', private: true }, null, 2),
  );
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(dir, 'src', 'totals.js'), totalsSource);
  fs.writeFileSync(path.join(dir, 'test', 'totals.test.js'), TEST_BODY);
}

function commitAll(dir: string, message: string): string {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
}

const BASE_TOTALS = 'function compute(x) {\n  return x.a + x.b;\n}\nmodule.exports = { compute };\n';

(INTEGRATION ? describe : describe.skip)('dead-branch-proven e2e (live mocha, CommonJS)', function () {
  this.timeout(240_000);

  it('proves an inserted dead branch the suite reaches but never enters', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-deadbranch-'));
    try {
      scaffold(dir, BASE_TOTALS);
      git(dir, ['init', '-q']);
      git(dir, ['config', 'user.email', 'demo@example.com']);
      git(dir, ['config', 'user.name', 'demo']);
      commitAll(dir, 'base: compute');

      // The PR inserts a literal-false branch (the `if (false)` is line 2).
      fs.writeFileSync(
        path.join(dir, 'src', 'totals.js'),
        'function compute(x) {\n  if (false) {\n    return -1;\n  }\n  return x.a + x.b;\n}\nmodule.exports = { compute };\n',
      );
      const headSha = commitAll(dir, 'feat: guard (#1)');
      assert.equal(runMocha(dir, 'test/totals.test.js'), true, 'submitted suite passes');
      const prDiff = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;

      const record = runDeadBranchRestoration({
        finding: { category: 'dead-branch-insertion', file: 'src/totals.js', line: 2 },
        prDiff,
        prRef: 'acme/totals#1',
        prHeadSha: headSha,
        postWorkspacePath: dir,
        repoRoot: dir,
        testRunner: 'mocha',
        packageManager: 'npm',
        timeoutMs: 180_000,
      });

      assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
      assert.equal(record.controls.branchResolved, true);
      assert.equal(record.controls.suitePassesAsSubmitted, true);
      assert.equal(record.controls.branchNeverExecuted, true);
      assert.equal(record.branchCondition, 'false');
      assert.equal(record.branchLine, 2);
      assert.deepEqual(record.affectedTestFiles, ['test/totals.test.js']);
      assert.ok(record.reproduceCommand.includes('src/totals.js:2'), 'reproduce names the branch');

      // The branch file must be byte-identical after the run (instrumentation
      // is always restored).
      assert.equal(
        fs.readFileSync(path.join(dir, 'src', 'totals.js'), 'utf8'),
        'function compute(x) {\n  if (false) {\n    return -1;\n  }\n  return x.a + x.b;\n}\nmodule.exports = { compute };\n',
        'the instrumented file is restored byte-for-byte',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refutes an inserted branch the suite does enter', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-deadbranch-refute-'));
    try {
      scaffold(dir, BASE_TOTALS);
      git(dir, ['init', '-q']);
      git(dir, ['config', 'user.email', 'demo@example.com']);
      git(dir, ['config', 'user.name', 'demo']);
      commitAll(dir, 'base: compute');

      // The PR inserts an `if (x.a > 0)` branch the test (a=2) DOES enter.
      fs.writeFileSync(
        path.join(dir, 'src', 'totals.js'),
        'function compute(x) {\n  let acc = x.a + x.b;\n  if (x.a > 0) {\n    acc = acc + 0;\n  }\n  return acc;\n}\nmodule.exports = { compute };\n',
      );
      const headSha = commitAll(dir, 'feat: guard (#1)');
      assert.equal(runMocha(dir, 'test/totals.test.js'), true, 'submitted suite passes');
      const prDiff = spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;

      const record = runDeadBranchRestoration({
        finding: { category: 'dead-branch-insertion', file: 'src/totals.js', line: 3 },
        prDiff,
        prRef: 'acme/totals#1',
        prHeadSha: headSha,
        postWorkspacePath: dir,
        repoRoot: dir,
        testRunner: 'mocha',
        packageManager: 'npm',
        timeoutMs: 180_000,
      });

      assert.equal(record.verdict, 'refuted', `expected refuted, got ${record.verdict}: ${record.reason ?? ''}`);
      assert.equal(record.controls.branchResolved, true);
      assert.equal(record.controls.branchNeverExecuted, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
