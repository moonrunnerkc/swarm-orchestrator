import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runDifferentialGate } from '../../src/verification';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: GIT_ENV,
  }).trim();
}

function writeFile(repo: string, rel: string, body: string): void {
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

function seedRepo(): { repo: string; baseCommit: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-gate-test-'));
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@test.com']);
  git(repo, ['config', 'user.name', 'test']);

  writeFile(repo, 'calc.js', 'exports.add = (a, b) => a - b;\n');
  writeFile(repo, 'calc.test.js', [
    "const assert = require('assert');",
    "const { add } = require('./calc');",
    'assert.strictEqual(add(2, 3), 5);',
    '',
  ].join('\n'));
  writeFile(repo, 'passing.test.js', "const assert = require('assert');\nassert.strictEqual(1, 1);\n");
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base']);
  const baseCommit = git(repo, ['rev-parse', 'HEAD']);

  git(repo, ['checkout', '-b', 'fix']);
  writeFile(repo, 'calc.js', 'exports.add = (a, b) => a + b;\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'fix add']);

  git(repo, ['checkout', 'main']);
  git(repo, ['checkout', '-b', 'no-fix']);
  git(repo, ['checkout', 'main']);

  return { repo, baseCommit };
}

describe('runDifferentialGate', () => {
  let repos: string[] = [];

  afterEach(() => {
    for (const repo of repos) {
      fs.rmSync(repo, { recursive: true, force: true });
    }
    repos = [];
  });

  it('passes when a test fails at base and passes on the patch branch', async () => {
    const { repo, baseCommit } = seedRepo();
    repos.push(repo);

    const result = await runDifferentialGate({
      repoPath: repo,
      baseCommit,
      agentBranch: 'fix',
      testCommand: 'node calc.test.js',
      timeoutMs: 30_000,
    });

    assert.strictEqual(result.status, 'PASS');
    assert.ok(result.base, 'base command evidence should be captured');
    assert.ok(result.patch, 'patch command evidence should be captured');
    assert.notStrictEqual(result.base.exitCode, 0);
    assert.strictEqual(result.patch.exitCode, 0);
    assert.deepStrictEqual(result.findings, []);
  });

  it('marks a test invalid when it already passes at the base commit', async () => {
    const { repo, baseCommit } = seedRepo();
    repos.push(repo);

    const result = await runDifferentialGate({
      repoPath: repo,
      baseCommit,
      agentBranch: 'fix',
      testCommand: 'node passing.test.js',
      timeoutMs: 30_000,
    });

    assert.strictEqual(result.status, 'INVALID_TEST');
    assert.ok(result.base, 'base command evidence should be captured');
    assert.strictEqual(result.base.exitCode, 0);
    assert.strictEqual(result.patch, undefined);
    assert.strictEqual(result.findings[0].ruleId, 'invalid-regression-test');
  });

  it('fails when the test fails at both base and patch', async () => {
    const { repo, baseCommit } = seedRepo();
    repos.push(repo);

    const result = await runDifferentialGate({
      repoPath: repo,
      baseCommit,
      agentBranch: 'no-fix',
      testCommand: 'node calc.test.js',
      timeoutMs: 30_000,
    });

    assert.strictEqual(result.status, 'FAIL');
    assert.ok(result.base, 'base command evidence should be captured');
    assert.ok(result.patch, 'patch command evidence should be captured');
    assert.notStrictEqual(result.base.exitCode, 0);
    assert.notStrictEqual(result.patch.exitCode, 0);
    assert.strictEqual(result.findings[0].scope, 'line');
    assert.strictEqual(result.findings[0].filePath, 'calc.test.js');
    assert.strictEqual(result.findings[0].line, 3);
  });
});
