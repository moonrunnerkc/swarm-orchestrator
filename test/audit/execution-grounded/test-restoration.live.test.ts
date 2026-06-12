import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runTestRestoration,
  type RestorationProofRecord,
  type TestRestorationInput,
} from '../../../src/audit/execution-grounded/test-restoration';

// Live tests gate on SWARM_EG_INTEGRATION=1 to keep the default `npm test`
// deterministic, matching the other execution-grounded live suites.
const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';

// At runtime this file lives in dist/test/audit/execution-grounded, so four
// levels up is the repo root and the fixtures live in the source tree.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIXTURES_ROOT = path.join(REPO_ROOT, 'test', 'fixtures', 'restoration');

function git(cwd: string, ...args: string[]): string {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed in ${cwd}: ${res.stderr}`);
  return res.stdout.trim();
}

function commitAll(cwd: string, message: string): void {
  git(cwd, 'add', '.');
  // commit.gpgsign=false: a developer with global signing enabled must not
  // need a key (or a pinentry prompt) to build throwaway fixture commits.
  git(
    cwd,
    '-c',
    'user.name=restoration-fixture',
    '-c',
    'user.email=restoration-fixture@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    message,
  );
}

/** npx (npm >= 7) resolves package binaries through node_modules, not PATH,
 *  so each temp workspace gets a node_modules symlink to this repo's own
 *  install: `npx mocha` then resolves the repo's mocha with no network. The
 *  link is created after the git commits so it stays untracked. */
function linkNodeModules(workspace: string): void {
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');
}

interface Workspaces {
  pre: string;
  post: string;
  headSha: string;
  prDiff: string;
}

const tempDirs: string[] = [];

/** Materialize one fixture as two real git checkouts in a temp dir: `pre` at
 *  the base commit, `post` with pr.diff applied and committed. */
function buildWorkspaces(name: string): Workspaces {
  const fixtureDir = path.join(FIXTURES_ROOT, name);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `swarm-restoration-${name}-`));
  tempDirs.push(root);

  const pre = path.join(root, 'pre');
  fs.mkdirSync(pre);
  for (const entry of ['package.json', 'src', 'test']) {
    fs.cpSync(path.join(fixtureDir, entry), path.join(pre, entry), { recursive: true });
  }
  git(pre, 'init', '-q');
  commitAll(pre, 'base');

  const post = path.join(root, 'post');
  fs.cpSync(pre, post, { recursive: true });
  const prDiff = fs.readFileSync(path.join(fixtureDir, 'pr.diff'), 'utf8');
  const applied = spawnSync('git', ['apply', '--whitespace=nowarn', '-'], {
    cwd: post,
    input: prDiff,
    encoding: 'utf8',
  });
  assert.equal(applied.status, 0, `pr.diff for '${name}' must apply cleanly: ${applied.stderr}`);
  commitAll(post, 'pr');
  const headSha = git(post, 'rev-parse', 'HEAD');

  linkNodeModules(pre);
  linkNodeModules(post);
  return { pre, post, headSha, prDiff };
}

function makeInput(
  ws: Workspaces,
  overrides?: Partial<TestRestorationInput>,
): TestRestorationInput {
  return {
    finding: { category: 'assertion-strip', file: 'test/calc.test.js' },
    prDiff: ws.prDiff,
    prRef: 'swarm-fixtures/restoration#1',
    prHeadSha: ws.headSha,
    preWorkspacePath: ws.pre,
    postWorkspacePath: ws.post,
    testRunner: 'mocha',
    packageManager: 'npm',
    timeoutMs: 60_000,
    ...overrides,
  };
}

function readTestFile(workspace: string): string {
  return fs.readFileSync(path.join(workspace, 'test', 'calc.test.js'), 'utf8');
}

/** The forward re-apply must leave the post workspace exactly as the PR
 *  submitted it, for every verdict that reached the reverse-apply. */
function assertPostRestored(ws: Workspaces, before: string): void {
  assert.equal(
    readTestFile(ws.post),
    before,
    'the post workspace test file must equal the PR-applied state after the call',
  );
}

describe('execution-grounded / test-restoration runTestRestoration (early exits, no execution)', () => {
  const minimalInput: TestRestorationInput = {
    finding: { category: 'assertion-strip', file: 'src/calc.js' },
    prDiff: [
      'diff --git a/src/calc.js b/src/calc.js',
      '--- a/src/calc.js',
      '+++ b/src/calc.js',
      '@@ -1 +1 @@',
      '-const x = 1;',
      '+const x = 2;',
      '',
    ].join('\n'),
    prRef: 'octo/calc#1',
    prHeadSha: 'deadbeefcafe',
    preWorkspacePath: null,
    postWorkspacePath: '/nonexistent-restoration-workspace',
    testRunner: 'mocha',
    packageManager: 'npm',
    timeoutMs: 1_000,
  };

  it('no-test-hunks: a finding outside a test file fails closed without executing anything', () => {
    const record = runTestRestoration(minimalInput);
    assert.equal(record.verdict, 'not-proven:no-test-hunks');
    assert.deepEqual(record.controls, {
      baseTestPasses: null,
      tamperedSuitePasses: null,
      restoredFailsTwiceSameIdentity: null,
    });
    assert.equal(record.reproduceCommand, '');
    assert.equal(record.revertedHunkPatch, '');
    assert.deepEqual(record.failingTests, []);
    assert.ok(record.reason !== undefined && record.reason.includes('src/calc.js'));
  });

  const testHunkDiff = [
    'diff --git a/test/calc.test.js b/test/calc.test.js',
    '--- a/test/calc.test.js',
    '+++ b/test/calc.test.js',
    '@@ -1 +1 @@',
    '-assert.ok(false);',
    '+assert.ok(true);',
    '',
  ].join('\n');

  it('runner-unsupported: a null runner fails closed before any execution', () => {
    const record = runTestRestoration({
      ...minimalInput,
      finding: { category: 'assertion-strip', file: 'test/calc.test.js' },
      prDiff: testHunkDiff,
      testRunner: null,
    });
    assert.equal(record.verdict, 'not-proven:runner-unsupported');
    assert.ok(record.revertedHunkPatch.includes('test/calc.test.js'), 'patch present after step 1');
    assert.equal(record.reproduceCommand, '');
    assert.ok(record.reason !== undefined && record.reason.includes('no supported test runner'));
  });

  it('runner-unsupported: a runner with no locked invocation (ava) fails closed', () => {
    const record = runTestRestoration({
      ...minimalInput,
      finding: { category: 'assertion-strip', file: 'test/calc.test.js' },
      prDiff: testHunkDiff,
      testRunner: 'ava',
    });
    assert.equal(record.verdict, 'not-proven:runner-unsupported');
    assert.ok(record.reason !== undefined && record.reason.includes("'ava'"));
  });

  it('execution-error: a spawn-level failure on control 2 never publishes tamperedSuitePasses', () => {
    // The post workspace does not exist, so the tampered-suite control run
    // dies at spawn. The record must say "execution error", not "suite
    // already failing": no test ran, so neither control value may be claimed.
    const record = runTestRestoration({
      ...minimalInput,
      finding: { category: 'assertion-strip', file: 'test/calc.test.js' },
      prDiff: testHunkDiff,
    });
    assert.equal(record.verdict, 'not-proven:execution-error');
    assert.deepEqual(record.controls, {
      baseTestPasses: null,
      tamperedSuitePasses: null,
      restoredFailsTwiceSameIdentity: null,
    });
    assert.equal(record.reproduceCommand, '');
    assert.deepEqual(record.failingTests, []);
    assert.ok(
      record.reason !== undefined && record.reason.includes('never executed'),
      `the reason must say the control run never executed, got: ${record.reason}`,
    );
    assert.ok(
      record.reason.includes('spawn-level failure'),
      'the spawn failure must be named so the operator fixes the harness, not the PR',
    );
  });
});

(INTEGRATION ? describe : describe.skip)('runTestRestoration (live, fixture repos)', function () {
  this.timeout(120_000);

  after(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('proven: tampered assertion restored, fails twice on head, passes on base', () => {
    const ws = buildWorkspaces('proven');
    const submitted = readTestFile(ws.post);

    const record = runTestRestoration(makeInput(ws));

    assert.equal(record.verdict, 'proven');
    assert.deepEqual(record.controls, {
      baseTestPasses: true,
      tamperedSuitePasses: true,
      restoredFailsTwiceSameIdentity: true,
    });
    assert.deepEqual(record.testFiles, ['test/calc.test.js']);
    assert.deepEqual(record.failingTests, ['calc › adds']);
    assert.ok(record.reproduceCommand.length > 0, 'a proven record must ship a reproduce command');
    assert.ok(record.reproduceCommand.includes("git apply -R <<'SWARM_RESTORE_PATCH'"));
    assert.ok(record.reproduceCommand.includes(ws.headSha));
    assert.ok(record.reproduceCommand.includes('&& npx mocha test/calc.test.js\n'));
    assert.ok(record.revertedHunkPatch.includes('test/calc.test.js'));
    assert.ok(!record.revertedHunkPatch.includes('src/calc.js'), 'only test hunks are reverted');
    assert.equal(record.reason, undefined);
    assertPostRestored(ws, submitted);
  });

  it('proven via deletion: control 2 is vacuous (null) and the reason says so', () => {
    const ws = buildWorkspaces('deleted');
    assert.ok(
      !fs.existsSync(path.join(ws.post, 'test', 'calc.test.js')),
      'precondition: the PR deleted the test file outright',
    );

    const record = runTestRestoration(makeInput(ws));

    assert.equal(record.verdict, 'proven');
    // No tampered run exists for a deleted file, so the published control is
    // null, never a claimed `true`: the record must not assert an execution
    // that did not happen.
    assert.deepEqual(record.controls, {
      baseTestPasses: true,
      tamperedSuitePasses: null,
      restoredFailsTwiceSameIdentity: true,
    });
    assert.deepEqual(record.testFiles, ['test/calc.test.js']);
    assert.deepEqual(record.failingTests, ['calc › adds']);
    assert.ok(record.reproduceCommand.length > 0, 'a proven record must ship a reproduce command');
    assert.ok(record.reproduceCommand.includes("git apply -R <<'SWARM_RESTORE_PATCH'"));
    assert.ok(
      record.reason !== undefined && record.reason.includes('control 2 vacuous'),
      `the null control must explain itself, got: ${record.reason}`,
    );
    assert.ok(record.reason.includes('deleted the test file'));
    assert.ok(
      !fs.existsSync(path.join(ws.post, 'test', 'calc.test.js')),
      'the forward re-apply must leave the post workspace as the PR submitted it (file deleted)',
    );
  });

  it('refuted: an equivalent test rewrite passes restored on head', () => {
    const ws = buildWorkspaces('refuted');
    const submitted = readTestFile(ws.post);

    const record = runTestRestoration(makeInput(ws));

    assert.equal(record.verdict, 'refuted');
    assert.deepEqual(record.controls, {
      baseTestPasses: null,
      tamperedSuitePasses: true,
      restoredFailsTwiceSameIdentity: false,
    });
    assert.equal(record.reproduceCommand, '');
    assert.deepEqual(record.failingTests, []);
    assertPostRestored(ws, submitted);
  });

  it('pre-existing-failure: the restored test also fails on the base checkout', () => {
    const ws = buildWorkspaces('pre-existing-failure');
    const submitted = readTestFile(ws.post);

    const record = runTestRestoration(makeInput(ws));

    assert.equal(record.verdict, 'not-proven:pre-existing-failure');
    assert.deepEqual(record.controls, {
      baseTestPasses: false,
      tamperedSuitePasses: true,
      restoredFailsTwiceSameIdentity: true,
    });
    assert.equal(record.reproduceCommand, '');
    assert.deepEqual(record.failingTests, []);
    assert.ok(record.reason !== undefined && record.reason.includes('base'));
    assertPostRestored(ws, submitted);
  });

  it('suite-already-failing: the kept assertion catches the PR as submitted', () => {
    const ws = buildWorkspaces('suite-already-failing');
    const submitted = readTestFile(ws.post);

    const record = runTestRestoration(makeInput(ws));

    assert.equal(record.verdict, 'not-proven:suite-already-failing');
    assert.deepEqual(record.controls, {
      baseTestPasses: null,
      tamperedSuitePasses: false,
      restoredFailsTwiceSameIdentity: null,
    });
    assert.equal(record.reproduceCommand, '');
    assert.ok(record.reason !== undefined && record.reason.includes('fails as submitted'));
    assertPostRestored(ws, submitted);
  });

  it('flaky: a deterministic first-run flake splits the restored runs', () => {
    const ws = buildWorkspaces('flaky');
    const submitted = readTestFile(ws.post);

    const record = runTestRestoration(makeInput(ws));

    assert.equal(record.verdict, 'not-proven:flaky');
    assert.deepEqual(record.controls, {
      baseTestPasses: null,
      tamperedSuitePasses: true,
      restoredFailsTwiceSameIdentity: false,
    });
    assert.equal(record.reproduceCommand, '');
    assert.ok(record.reason !== undefined && record.reason.includes('split'));
    assert.ok(
      fs.existsSync(path.join(ws.post, '.flake-marker')),
      'the marker the restored run wrote lives inside the workspace',
    );
    assertPostRestored(ws, submitted);
  });

  it('execution-error: a proven-shaped run without a base workspace fails closed', () => {
    const ws = buildWorkspaces('proven');
    const submitted = readTestFile(ws.post);

    const record = runTestRestoration(makeInput(ws, { preWorkspacePath: null }));

    assert.equal(record.verdict, 'not-proven:execution-error');
    assert.deepEqual(record.controls, {
      baseTestPasses: null,
      tamperedSuitePasses: true,
      restoredFailsTwiceSameIdentity: true,
    });
    assert.equal(record.reproduceCommand, '');
    assert.ok(record.reason !== undefined && record.reason.includes('base-workspace-unavailable'));
    assertPostRestored(ws, submitted);
  });

  it('patch-apply-failed: a post workspace that diverged from the diff fails closed', () => {
    const ws = buildWorkspaces('proven');
    // The tampered suite still passes, but the test file no longer matches the
    // diff's post state, so the reverse-apply must fail loudly.
    const diverged = [
      "'use strict';",
      '',
      "const assert = require('assert');",
      '',
      "describe('calc', () => {",
      "  it('adds', () => {",
      '    assert.ok(true);',
      '  });',
      '});',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(ws.post, 'test', 'calc.test.js'), diverged);

    const record = runTestRestoration(makeInput(ws));

    assert.equal(record.verdict, 'not-proven:patch-apply-failed');
    assert.deepEqual(record.controls, {
      baseTestPasses: null,
      tamperedSuitePasses: true,
      restoredFailsTwiceSameIdentity: null,
    });
    assert.equal(record.reproduceCommand, '');
    assert.ok(record.reason !== undefined && record.reason.includes('git apply -R failed'));
    assert.equal(readTestFile(ws.post), diverged, 'the workspace is left untouched');
  });

  it('execution-error: a proven run whose reproduce command cannot be built fails closed', () => {
    const ws = buildWorkspaces('proven');
    const submitted = readTestFile(ws.post);

    // An uppercase head sha violates the reproduce command's injection guard;
    // a proof that cannot ship its reproduce command is not published.
    const record: RestorationProofRecord = runTestRestoration(
      makeInput(ws, { prHeadSha: ws.headSha.toUpperCase() }),
    );

    assert.equal(record.verdict, 'not-proven:execution-error');
    assert.deepEqual(record.controls, {
      baseTestPasses: true,
      tamperedSuitePasses: true,
      restoredFailsTwiceSameIdentity: true,
    });
    assert.equal(record.reproduceCommand, '');
    assert.deepEqual(record.failingTests, []);
    assert.ok(record.reason !== undefined && record.reason.includes('reproduce command'));
    assertPostRestored(ws, submitted);
  });
});
