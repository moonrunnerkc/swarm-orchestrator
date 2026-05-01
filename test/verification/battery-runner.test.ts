import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  attachAttestationNote,
  generateSignedAttestation,
  runBatteryVerification,
  unsignedTestSigner,
  type BatteryCommandRunner,
} from '../../src/verification';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
};

interface RepoFixture {
  root: string;
  baseCommit: string;
  patchCommit: string;
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: GIT_ENV,
  }).trim();
}

function writeFile(root: string, rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

function commandResult(command: string, cwd: string, stdout: string) {
  return {
    command,
    cwd,
    exitCode: 0,
    stdout,
    stderr: '',
    durationMs: 1,
    timedOut: false,
  };
}

const mutationPassRunner: BatteryCommandRunner = async (command, cwd) => commandResult(
  command,
  cwd,
  'total mutants: 2\nkilled mutants: 2\nsurvived mutants: 0\nmutation score 100%',
);

const propertyPassRunner: BatteryCommandRunner = async (command, cwd) => commandResult(command, cwd, '');

function createCleanPatchRepo(): RepoFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'battery-clean-'));
  git(root, ['init', '-b', 'main']);
  writeFile(root, 'src/calc.js', [
    'function add(a, b) { return a - b; }',
    'module.exports = { add };',
    '',
  ].join('\n'));
  writeFile(root, 'test.js', [
    "const { add } = require('./src/calc');",
    'if (add(2, 3) !== 5) { throw new Error(`expected 5, got ${add(2, 3)}`); }',
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);

  writeFile(root, 'src/calc.js', [
    'function add(a, b) { return a + b; }',
    'module.exports = { add };',
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fix add']);
  const patchCommit = git(root, ['rev-parse', 'HEAD']);
  return { root, baseCommit, patchCommit };
}

function createCheatPatchRepo(): RepoFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'battery-cheat-'));
  git(root, ['init', '-b', 'main']);
  writeFile(root, 'src/token.js', [
    "function token() { return 'pending'; }",
    'module.exports = { token };',
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);

  writeFile(root, 'src/token.js', [
    "function token() { return 'SECRET'; }",
    'module.exports = { token };',
    '',
  ].join('\n'));
  writeFile(root, 'test/token.test.js', [
    "const { token } = require('../src/token');",
    "if (token() !== 'SECRET') throw new Error('wrong token');",
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'hardcode token']);
  const patchCommit = git(root, ['rev-parse', 'HEAD']);
  return { root, baseCommit, patchCommit };
}

async function attachPassingAttestation(repo: RepoFixture): Promise<void> {
  const attestation = await generateSignedAttestation({
    repoPath: repo.root,
    commit: repo.patchCommit,
    goalText: 'fixture goal',
    planHash: 'fixture-plan',
    agent: { tool: 'test', version: '1', model: 'fixture' },
    transcript: 'fixture transcript',
    layerResults: [],
    compositeScore: 1,
    signer: unsignedTestSigner,
  });
  attachAttestationNote(repo.root, repo.patchCommit, attestation);
}

describe('runBatteryVerification', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('runs all end-of-run layers and computes a composite score for a clean patch', async () => {
    const repo = createCleanPatchRepo();
    roots.push(repo.root);
    await attachPassingAttestation(repo);

    const result = await runBatteryVerification({
      repoPath: repo.root,
      baseCommit: repo.baseCommit,
      patchCommit: repo.patchCommit,
      goalText: 'Fix add',
      differentialTestCommand: 'node test.js',
      regressionCommand: 'node test.js',
      mutationCommandRunner: mutationPassRunner,
      propertyCommandRunner: propertyPassRunner,
    });

    assert.deepEqual(result.layerResults.map(layer => layer.layer), [
      'differential-gate',
      'mutation-gate',
      'cheat-detector',
      'property-gate',
      'attestation',
    ]);
    assert.equal(result.hardGatePassed, true);
    assert.equal(result.compositeScore, 1);
    assert.equal(result.findings.length, 0);
  });

  it('fails closed when a hard-gate layer crashes', async () => {
    const repo = createCleanPatchRepo();
    roots.push(repo.root);
    await attachPassingAttestation(repo);

    const result = await runBatteryVerification({
      repoPath: repo.root,
      baseCommit: repo.baseCommit,
      patchCommit: repo.patchCommit,
      goalText: 'Fix add',
      differentialTestCommand: 'node test.js',
      regressionCommand: 'node test.js',
      mutationCommandRunner: async () => {
        throw new Error('mutation command runner exploded');
      },
      propertyCommandRunner: propertyPassRunner,
    });

    assert.equal(result.compositeScore, 0);
    assert.equal(result.hardGatePassed, false);
    assert.deepEqual(result.failedLayers, ['mutation-gate']);
  });

  it('keeps succeeding findings when an advisory layer crashes', async () => {
    const repo = createCheatPatchRepo();
    roots.push(repo.root);

    const result = await runBatteryVerification({
      repoPath: repo.root,
      baseCommit: repo.baseCommit,
      patchCommit: repo.patchCommit,
      goalText: 'Return a generated token',
      regressionCommand: 'node -e "process.exit(0)"',
      mutationCommandRunner: mutationPassRunner,
      propertyCommandRunner: async () => {
        throw new Error('property command runner exploded');
      },
    });

    assert.equal(result.hardGatePassed, true);
    assert.deepEqual(result.failedLayers, ['property-gate']);
    assert.ok(
      result.findings.some(finding => finding.producerId === 'cheat-detector'),
      'cheat-detector findings should survive an advisory property crash',
    );
    assert.equal(result.humanReviewRequired, true);
  });
});
