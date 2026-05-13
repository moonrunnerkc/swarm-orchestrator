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

  it('overlays a test file that lives outside the commit history onto both worktrees', async () => {
    // Regression for the 2026-05 ow run: the pre-worker synthesizer
    // writes its regression test under `<repo>/test/swarm_synth_*.ts`
    // as an UNTRACKED file. Neither baseCommit nor agentBranch carries
    // it in their tree. Pre-fix, the differential-gate created
    // detached worktrees at those commits and the test file was
    // missing from both — the test command exited non-zero because
    // the file did not exist, which presented as "patch fails the
    // regression" when in fact the regression was never executed.
    const { repo, baseCommit } = seedRepo();
    repos.push(repo);

    // The synthesizer-style test file: lives in a scratch directory
    // outside the repo. It asserts on the FIXED implementation (post-
    // patch state). At base it will fail (calc.js still uses `-`); at
    // patch it will pass (calc.js uses `+`).
    const synthSource = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'synth-scratch-')),
      'overlay-regression.test.js',
    );
    fs.writeFileSync(
      synthSource,
      [
        "const assert = require('assert');",
        "const { add } = require('./calc');",
        // Assertion the patch must satisfy.
        'assert.strictEqual(add(7, 5), 12);',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await runDifferentialGate({
      repoPath: repo,
      baseCommit,
      agentBranch: 'fix',
      // Reference the overlay's destination, not the synth's host path.
      testCommand: 'node overlay-regression.test.js',
      timeoutMs: 30_000,
      overlayFiles: [
        {
          absoluteSource: synthSource,
          relativeDestination: 'overlay-regression.test.js',
        },
      ],
    });

    assert.strictEqual(result.status, 'PASS',
      'overlay must make the regression test runnable in both worktrees so the gate can report PASS on a correct patch');
    assert.ok(result.base);
    assert.ok(result.patch);
    assert.notStrictEqual(result.base.exitCode, 0,
      'overlaid test fails at base — that is the regression signal');
    assert.strictEqual(result.patch.exitCode, 0,
      'overlaid test passes at patch — the worker made the regression go away');
  });

  it('skips overlay entries whose source file does not exist (best-effort)', async () => {
    // A missing overlay source must not crash the gate. The test
    // command then exits non-zero in both worktrees because the file
    // is absent — gate reports FAIL with no overlay-related throw.
    const { repo, baseCommit } = seedRepo();
    repos.push(repo);

    const result = await runDifferentialGate({
      repoPath: repo,
      baseCommit,
      agentBranch: 'fix',
      testCommand: 'node nonexistent.test.js',
      timeoutMs: 30_000,
      overlayFiles: [
        {
          absoluteSource: '/nonexistent/source/path.js',
          relativeDestination: 'nonexistent.test.js',
        },
      ],
    });

    // The gate completes without throwing. Status is FAIL (or
    // INVALID_TEST depending on exit-code ordering) but the gate
    // produced a structured result rather than crashing.
    assert.ok(['FAIL', 'INVALID_TEST'].includes(result.status),
      `missing overlay source must produce a structured result, not a crash; got status ${result.status}`);
  });

  it('refuses overlay destinations that escape the worktree', async () => {
    // A destination starting with `/` or containing `..` would write
    // outside the worktree. The overlay applier silently skips those
    // entries; the test command then runs against the natural
    // worktree content. This test pins that the gate never writes
    // outside the worktree root regardless of the caller's input.
    const { repo, baseCommit } = seedRepo();
    repos.push(repo);

    const escapingSource = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'escape-source-')),
      'should-not-land.txt',
    );
    fs.writeFileSync(escapingSource, 'malicious content\n', 'utf8');

    // The gate's worktreeRoot directory is created under os.tmpdir().
    // If the destination "../../escaped.txt" were honored, the file
    // would end up at the tmp dir's parent (os.tmpdir()). We verify
    // by listing os.tmpdir() before/after.
    const beforeListing = fs.readdirSync(os.tmpdir());

    await runDifferentialGate({
      repoPath: repo,
      baseCommit,
      agentBranch: 'fix',
      testCommand: 'true', // no-op so the gate completes cleanly
      timeoutMs: 30_000,
      overlayFiles: [
        { absoluteSource: escapingSource, relativeDestination: '/etc/escaped.txt' },
        { absoluteSource: escapingSource, relativeDestination: '../../escaped.txt' },
      ],
    });

    const afterListing = fs.readdirSync(os.tmpdir());
    // No NEW file named `escaped.txt` at the tmpdir root.
    const newEscaped = afterListing.filter(
      (name) => name === 'escaped.txt' && !beforeListing.includes(name),
    );
    assert.deepStrictEqual(newEscaped, [],
      'overlay must refuse destinations that escape the worktree root');
  });
});
