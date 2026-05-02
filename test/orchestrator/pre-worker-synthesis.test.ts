import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPreWorkerSynthesis } from '../../src/orchestrator/pre-worker-synthesis';
import type { SynthesizerFn } from '../../src/orchestrator/pre-worker-synthesis';
import type { TestSynthesisResult } from '../../src/verification/test-synthesizer-types';

function makeRunDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pws-test-'));
}

function makeSynthesizer(result: TestSynthesisResult): SynthesizerFn {
  return async () => result;
}

describe('runPreWorkerSynthesis', () => {
  it('returns success and copies test file to run evidence dir when synthesizer succeeds', async () => {
    const runDir = makeRunDir();
    try {
      const testFile = path.join(runDir, 'synthesized.test.js');
      fs.writeFileSync(testFile, '// synthesized test content', 'utf8');

      const result = await runPreWorkerSynthesis({
        goal: 'add a feature',
        repoPath: '/fake/repo',
        runDir,
        _synthesize: makeSynthesizer({
          status: 'GENERATED',
          reason: 'ok',
          attempts: [],
          testFilePath: testFile,
          testCommand: 'node synthesized.test.js',
        }),
      });

      assert.equal(result.status, 'success');
      assert.equal(result.testCommand, 'node synthesized.test.js');
      assert.equal(result.testFilePath, testFile);

      const evidenceCopy = path.join(runDir, 'verification', 'synthesized-intent-test.js');
      assert.ok(fs.existsSync(evidenceCopy), 'evidence copy should exist');
      assert.equal(fs.readFileSync(evidenceCopy, 'utf8'), '// synthesized test content');
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('returns GENERATION_FAILED when synthesizer reports generation failure', async () => {
    const runDir = makeRunDir();
    try {
      const result = await runPreWorkerSynthesis({
        goal: 'vague goal',
        repoPath: '/fake/repo',
        runDir,
        _synthesize: makeSynthesizer({
          status: 'GENERATION_FAILED',
          reason: 'model returned empty output after 3 attempts',
          attempts: [],
        }),
      });

      assert.equal(result.status, 'GENERATION_FAILED');
      assert.match(result.reason, /model returned empty output/);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('returns AMBIGUOUS_GOAL when synthesizer cannot make the test fail on base', async () => {
    const runDir = makeRunDir();
    try {
      const result = await runPreWorkerSynthesis({
        goal: 'update docs',
        repoPath: '/fake/repo',
        runDir,
        _synthesize: makeSynthesizer({
          status: 'AMBIGUOUS_GOAL',
          reason: 'every candidate test passed against base commit',
          attempts: [],
        }),
      });

      assert.equal(result.status, 'AMBIGUOUS_GOAL');
      assert.match(result.reason, /passed against base/);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('succeeds even when evidence copy fails due to filesystem error', async () => {
    const runDir = makeRunDir();
    try {
      const missingTestFile = path.join(runDir, 'nonexistent.test.js');

      const result = await runPreWorkerSynthesis({
        goal: 'add feature',
        repoPath: '/fake/repo',
        runDir,
        _synthesize: makeSynthesizer({
          status: 'GENERATED',
          reason: 'ok',
          attempts: [],
          testFilePath: missingTestFile,
          testCommand: 'node nonexistent.test.js',
        }),
      });

      assert.equal(result.status, 'success');
      assert.equal(result.testCommand, 'node nonexistent.test.js');
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('creates the verification sub-directory if it does not already exist', async () => {
    const runDir = makeRunDir();
    try {
      const testFile = path.join(runDir, 'test.ts');
      fs.writeFileSync(testFile, '// ts test', 'utf8');

      await runPreWorkerSynthesis({
        goal: 'add feature',
        repoPath: '/fake/repo',
        runDir,
        _synthesize: makeSynthesizer({
          status: 'GENERATED',
          reason: 'ok',
          attempts: [],
          testFilePath: testFile,
          testCommand: 'npx ts-mocha test.ts',
        }),
      });

      assert.ok(
        fs.existsSync(path.join(runDir, 'verification')),
        'verification dir should be created',
      );
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
