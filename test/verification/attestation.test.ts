import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  attachAttestationNote,
  generateSignedAttestation,
  readAttestationNote,
  unsignedTestSigner,
  verifyAttestation,
} from '../../src/verification';

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

function seedRepo(): { repo: string; commit: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'attestation-test-'));
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@test.com']);
  git(repo, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n', 'utf8');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'init']);
  return { repo, commit: git(repo, ['rev-parse', 'HEAD']) };
}

describe('attestation', () => {
  let repos: string[] = [];

  afterEach(() => {
    for (const repo of repos) {
      fs.rmSync(repo, { recursive: true, force: true });
    }
    repos = [];
  });

  it('round-trips an attestation through a git note', async () => {
    const { repo, commit } = seedRepo();
    repos.push(repo);

    const attestation = await generateSignedAttestation({
      repoPath: repo,
      commit,
      goalText: 'Fix the bug',
      planHash: 'plan-abc',
      agent: { tool: 'codex', version: '1.0.0', model: 'gpt-5.4' },
      transcript: 'agent transcript',
      compositeScore: 0.92,
      layerResults: [
        { layer: 'intent', status: 'PASS', evidenceSummary: 'base failed patch passed', durationMs: 12 },
      ],
      timestamp: '2026-04-26T00:00:00.000Z',
      signer: unsignedTestSigner,
    });

    attachAttestationNote(repo, commit, attestation);
    const note = readAttestationNote(repo, commit);
    const verification = await verifyAttestation(repo, commit);

    assert.ok(note, 'git note should be readable');
    assert.strictEqual(note.envelope.subject[0].digest.sha1, commit);
    assert.strictEqual(verification.found, true);
    assert.strictEqual(verification.verified, true);
    assert.strictEqual(verification.attestation?.envelope.predicate.metadata.compositeScore, 0.92);
  });

  it('reports a missing attestation', async () => {
    const { repo, commit } = seedRepo();
    repos.push(repo);

    const verification = await verifyAttestation(repo, commit);

    assert.strictEqual(verification.found, false);
    assert.strictEqual(verification.verified, false);
    assert.match(verification.reason, /no attestation found/);
  });

  it('rejects an attestation whose subject does not match the commit', async () => {
    const { repo, commit } = seedRepo();
    repos.push(repo);

    const attestation = await generateSignedAttestation({
      repoPath: repo,
      commit: '0000000000000000000000000000000000000000',
      goalText: 'Fix the bug',
      planHash: 'plan-abc',
      agent: { tool: 'codex', version: '1.0.0', model: 'gpt-5.4' },
      transcript: 'agent transcript',
      compositeScore: 0.92,
      layerResults: [],
      timestamp: '2026-04-26T00:00:00.000Z',
      signer: unsignedTestSigner,
    });

    attachAttestationNote(repo, commit, attestation);
    const verification = await verifyAttestation(repo, commit);

    assert.strictEqual(verification.found, true);
    assert.strictEqual(verification.verified, false);
    assert.match(verification.reason, /does not match commit/);
  });
});
