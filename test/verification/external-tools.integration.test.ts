import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  attachAttestationNote,
  generateSignedAttestation,
  runMutationGate,
  runPropertyGate,
  signWithCosignKey,
  verifyAttestation,
} from '../../src/verification';

const EXTERNAL_FLAG = 'SWARM_RUN_EXTERNAL_TOOL_TESTS';
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
};

function requireExternal(ctx: Mocha.Context): void {
  if (process.env[EXTERNAL_FLAG] !== '1') {
    ctx.skip();
  }
}

function requireCommand(command: string): void {
  try {
    execFileSync('bash', ['-lc', 'command -v "$1"', 'bash', command], { stdio: 'pipe' });
  } catch {
    throw new Error(`${command} is required when ${EXTERNAL_FLAG}=1`);
  }
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root: string, rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

function npmInstall(root: string, packages: string[]): void {
  execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--save-dev', ...packages], {
    cwd: root,
    stdio: 'pipe',
  });
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: GIT_ENV,
  }).trim();
}

describe('external verification tool integrations', function () {
  this.timeout(300_000);
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it('runs Stryker through the mutation gate against a minimal JS fixture', async function () {
    requireExternal(this);
    requireCommand('npm');
    const root = tempDir('swarm-stryker-');
    roots.push(root);
    writeFile(root, 'package.json', JSON.stringify({
      scripts: { test: 'node --test' },
      devDependencies: {},
    }, null, 2));
    writeFile(root, 'src/math.js', [
      'function add(a, b) { return a + b; }',
      'module.exports = { add };',
      '',
    ].join('\n'));
    writeFile(root, 'test/math.test.js', [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const { add } = require('../src/math');",
      "test('add', () => assert.equal(add(2, 3), 5));",
      '',
    ].join('\n'));
    writeFile(root, 'stryker.conf.cjs', [
      'module.exports = {',
      '  mutate: ["src/math.js"],',
      '  testRunner: "command",',
      '  commandRunner: { command: "npm test" },',
      '  reporters: ["clear-text"],',
      '  coverageAnalysis: "off"',
      '};',
      '',
    ].join('\n'));
    npmInstall(root, ['@stryker-mutator/core', '@stryker-mutator/command-runner']);

    const result = await runMutationGate({
      targetRepoPath: root,
      changedFiles: ['src/math.js'],
      timeoutMs: 240_000,
    });

    assert.ok(result.results[0]?.command.includes('stryker'), 'must run Stryker');
    assert.ok(result.totalMutants > 0, 'Stryker should produce mutants');
    assert.ok(result.mutationScore >= 0 && result.mutationScore <= 1);
  });

  it('runs fast-check through the property gate against a minimal JS fixture', async function () {
    requireExternal(this);
    requireCommand('npm');
    const root = tempDir('swarm-fast-check-');
    roots.push(root);
    writeFile(root, 'package.json', JSON.stringify({ devDependencies: {} }, null, 2));
    writeFile(root, 'src/unsafe.js', [
      'function lowercase(value) { return value.toLowerCase(); }',
      'module.exports = { lowercase };',
      '',
    ].join('\n'));
    npmInstall(root, ['fast-check']);

    const result = await runPropertyGate({
      targetRepoPath: root,
      changedFiles: ['src/unsafe.js'],
      timeoutMsPerFunction: 60_000,
    });

    assert.strictEqual(result.status, 'ADVISORY');
    assert.ok(result.targets.some(target => target.functionName === 'lowercase'));
    assert.ok(result.findings.length > 0, 'fast-check should find a generic-input failure');
  });

  it('uses cosign to sign and verify an attestation git note', async function () {
    requireExternal(this);
    requireCommand('cosign');
    const root = tempDir('swarm-cosign-');
    roots.push(root);
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.com']);
    git(root, ['config', 'user.name', 'test']);
    writeFile(root, 'README.md', '# cosign integration\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'init']);
    const commit = git(root, ['rev-parse', 'HEAD']);
    const password = 'swarm-integration-test';

    execFileSync('cosign', ['generate-key-pair'], {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, COSIGN_PASSWORD: password },
    });

    const privateKeyPath = path.join(root, 'cosign.key');
    const publicKeyPath = path.join(root, 'cosign.pub');
    const attestation = await generateSignedAttestation({
      repoPath: root,
      commit,
      goalText: 'Verify cosign integration',
      planHash: 'integration-plan',
      agent: { tool: 'codex', version: 'integration', model: 'gpt-5.4' },
      transcript: 'integration transcript',
      compositeScore: 1,
      layerResults: [],
      signer: (envelope, repoPath) => signWithCosignKey(envelope, repoPath, {
        privateKeyPath,
        publicKeyPath,
        password,
      }),
    });
    attachAttestationNote(root, commit, attestation);

    const result = await verifyAttestation(root, commit);

    assert.strictEqual(result.found, true);
    assert.strictEqual(result.verified, true);
    assert.match(result.reason, /cosign key signature verified/);
  });
});
