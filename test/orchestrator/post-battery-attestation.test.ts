import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateAndAttachAttestation } from '../../src/orchestrator/post-battery-attestation';
import { unsignedTestSigner, readAttestationNote } from '../../src/verification/attestation';
import type { BatteryResult } from '../../src/verification/battery-types';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
};

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: GIT_ENV,
  }).trim();
}

function makeGitRepo(): { root: string; commit: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pba-test-'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@test.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(root, 'src.ts'), 'export const x = 1;', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial commit']);
  const commit = git(root, ['rev-parse', 'HEAD']);
  return { root, commit };
}

function makeBatteryResult(passed: boolean): BatteryResult {
  return {
    findings: [],
    layerResults: [
      {
        layer: 'differential-gate',
        status: passed ? 'pass' : 'fail',
        score: passed ? 1 : 0,
        evidenceSummary: passed ? 'test passed' : 'test failed',
        durationMs: 100,
        findings: [],
      },
    ],
    compositeScore: passed ? 1 : 0,
    hardGatePassed: passed,
    failedHardLayers: passed ? [] : ['differential-gate'],
    advisoryWarningLayers: [],
    environmentErrorLayers: [],
    failedLayers: passed ? [] : ['differential-gate'],
    humanReviewRequired: !passed,
    wallClock: 500,
  };
}

describe('generateAndAttachAttestation', () => {
  it('attaches a signed attestation note and writes attestation.json on success', async () => {
    const { root, commit } = makeGitRepo();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pba-run-'));
    try {
      await generateAndAttachAttestation({
        repoPath: root,
        runDir,
        plan: { goal: 'add a feature', steps: [], createdAt: new Date().toISOString() },
        batteryResult: makeBatteryResult(true),
        agentTool: 'copilot',
        agentModel: 'claude-opus-4.5',
        signer: unsignedTestSigner,
      });

      // Attestation note should be readable.
      const note = readAttestationNote(root, commit);
      assert.ok(note !== undefined, 'attestation note should exist');
      assert.ok(note.signature.kind === 'unsigned-test');

      // attestation.json should be written.
      const jsonPath = path.join(runDir, 'verification', 'attestation.json');
      assert.ok(fs.existsSync(jsonPath), 'attestation.json should exist');
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      assert.ok(typeof parsed.envelope === 'object', 'parsed attestation should have envelope');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('includes transcript from steps/*/share.md files', async () => {
    const { root, commit } = makeGitRepo();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pba-run-'));
    try {
      // Write step share.md files.
      const stepsDir = path.join(runDir, 'steps');
      fs.mkdirSync(path.join(stepsDir, 'step-1'), { recursive: true });
      fs.writeFileSync(path.join(stepsDir, 'step-1', 'share.md'), '# step 1 transcript', 'utf8');
      fs.mkdirSync(path.join(stepsDir, 'step-2'), { recursive: true });
      fs.writeFileSync(path.join(stepsDir, 'step-2', 'share.md'), '# step 2 transcript', 'utf8');

      await generateAndAttachAttestation({
        repoPath: root,
        runDir,
        plan: { goal: 'fix bug', steps: [], createdAt: new Date().toISOString() },
        batteryResult: makeBatteryResult(true),
        agentTool: 'claude-code',
        agentModel: 'claude-opus-4.5',
        signer: unsignedTestSigner,
      });

      const note = readAttestationNote(root, commit);
      assert.ok(note !== undefined, 'attestation note should exist');
      // The transcript hash in the predicate should reflect the steps transcript.
      const transcriptHash = note.envelope.predicate.metadata.transcriptHash;
      assert.ok(typeof transcriptHash === 'string' && transcriptHash.length === 64, 'transcript hash should be a SHA256');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('swallows signing error and does not throw', async () => {
    const { root } = makeGitRepo();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pba-run-'));
    try {
      const failingSigner = async () => {
        throw new Error('cosign not installed');
      };

      // Must not throw.
      await generateAndAttachAttestation({
        repoPath: root,
        runDir,
        plan: { goal: 'refactor', steps: [], createdAt: new Date().toISOString() },
        batteryResult: makeBatteryResult(true),
        agentTool: 'copilot',
        agentModel: 'gpt-4o',
        signer: failingSigner,
      });

      // No attestation file should be written.
      const jsonPath = path.join(runDir, 'verification', 'attestation.json');
      assert.ok(!fs.existsSync(jsonPath), 'attestation.json should not exist when signing fails');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
