import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager } from '../src/session-manager';

describe('SessionManager', () => {
  const testRunsDir = path.join(__dirname, '..', '..', 'test-runs');
  let manager: SessionManager;

  beforeEach(() => {
    // clean up
    if (fs.existsSync(testRunsDir)) {
      fs.rmSync(testRunsDir, { recursive: true });
    }
    manager = new SessionManager(testRunsDir);
  });

  afterEach(() => {
    // clean up
    if (fs.existsSync(testRunsDir)) {
      fs.rmSync(testRunsDir, { recursive: true });
    }
  });

  describe('createRun', () => {
    it('should create run directory structure', () => {
      const runDir = manager.createRun('test-run-001');

      assert.ok(fs.existsSync(runDir));
      assert.ok(fs.existsSync(path.join(runDir, 'steps')));
    });

    it('should throw error if run already exists', () => {
      manager.createRun('test-run-001');

      assert.throws(() => {
        manager.createRun('test-run-001');
      }, /already exists/);
    });
  });

  describe('createStepDir', () => {
    it('should create step directory with padded number', () => {
      manager.createRun('test-run-001');
      const stepDir = manager.createStepDir('test-run-001', 1);

      assert.ok(fs.existsSync(stepDir));
      assert.ok(stepDir.endsWith('01'));
    });

    it('should create step directory for double-digit steps', () => {
      manager.createRun('test-run-001');
      const stepDir = manager.createStepDir('test-run-001', 12);

      assert.ok(stepDir.endsWith('12'));
    });
  });

  describe('importShare', () => {
    it('should import and parse share transcript from file', () => {
      manager.createRun('test-run-001');

      // create a test transcript
      const tempDir = path.join(testRunsDir, 'temp');
      fs.mkdirSync(tempDir, { recursive: true });
      const transcriptPath = path.join(tempDir, 'share.md');

      const transcript = `
$ npm test

  14 passing (10ms)

All tests passed.
`;

      fs.writeFileSync(transcriptPath, transcript, 'utf8');

      const stepShare = manager.importShare('test-run-001', 1, 'worker', transcriptPath);

      assert.strictEqual(stepShare.stepNumber, 1);
      assert.strictEqual(stepShare.agentName, 'worker');
      assert.ok(stepShare.index);
      assert.ok(stepShare.index.testsRun.length > 0);
    });

    it('should import inline content', () => {
      manager.createRun('test-run-001');

      const transcript = '$ npm test\n\n14 passing';

      const stepShare = manager.importShare('test-run-001', 1, 'worker', transcript);

      assert.ok(stepShare.index);
      assert.ok(fs.existsSync(stepShare.transcriptPath));
    });

    it('should save index to step directory', () => {
      manager.createRun('test-run-001');

      const transcript = '$ npm test\n\n14 passing';
      const stepShare = manager.importShare('test-run-001', 1, 'worker', transcript);

      const stepDir = path.dirname(stepShare.transcriptPath);
      const indexPath = path.join(stepDir, 'index.json');

      assert.ok(fs.existsSync(indexPath));

      const indexContent = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      assert.ok(indexContent.testsRun);
    });

    it('should update run context', () => {
      manager.createRun('test-run-001');

      manager.importShare('test-run-001', 1, 'worker', '$ npm test\n\n14 passing');

      const contextPath = path.join(testRunsDir, 'test-run-001', 'context.json');
      assert.ok(fs.existsSync(contextPath));

      const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
      assert.strictEqual(context.shares.length, 1);
      assert.strictEqual(context.shares[0].stepNumber, 1);
    });
  });

  describe('getPriorContext', () => {
    it('should return empty array for first step', () => {
      manager.createRun('test-run-001');

      const priorContext = manager.getPriorContext('test-run-001', 1);

      assert.deepStrictEqual(priorContext, []);
    });

    it('should return previous step for step 2', () => {
      manager.createRun('test-run-001');

      manager.importShare('test-run-001', 1, 'worker', '$ npm test\n\n14 passing');

      const priorContext = manager.getPriorContext('test-run-001', 2);

      assert.strictEqual(priorContext.length, 1);
      assert.strictEqual(priorContext[0]?.stepNumber, 1);
    });

    it('should return all previous steps in order', () => {
      manager.createRun('test-run-001');

      manager.importShare('test-run-001', 1, 'worker', '$ npm test');
      manager.importShare('test-run-001', 2, 'worker', '$ npm test');
      manager.importShare('test-run-001', 3, 'worker', '$ npm test');

      const priorContext = manager.getPriorContext('test-run-001', 4);

      assert.strictEqual(priorContext.length, 3);
      assert.strictEqual(priorContext[0]?.stepNumber, 1);
      assert.strictEqual(priorContext[1]?.stepNumber, 2);
      assert.strictEqual(priorContext[2]?.stepNumber, 3);
    });
  });

  describe('generateContextSummary', () => {
    it('should return "no prior context" for first step', () => {
      manager.createRun('test-run-001');

      const summary = manager.generateContextSummary('test-run-001', 1);

      assert.strictEqual(summary, 'no prior context');
    });

    it('should include changed files from prior steps', () => {
      manager.createRun('test-run-001');

      const transcript = `
modified: src/api.ts
modified: src/db.ts
`;

      manager.importShare('test-run-001', 1, 'worker', transcript);

      const summary = manager.generateContextSummary('test-run-001', 2);

      assert.ok(summary.includes('step 1'));
      assert.ok(summary.includes('worker'));
    });

    it('should include verified tests from prior steps', () => {
      manager.createRun('test-run-001');

      const transcript = `
$ npm test

  14 passing
`;

      manager.importShare('test-run-001', 1, 'worker', transcript);

      const summary = manager.generateContextSummary('test-run-001', 2);

      assert.ok(summary.includes('tests verified'));
      assert.ok(summary.includes('npm test'));
    });

    it('should warn about unverified claims', () => {
      manager.createRun('test-run-001');

      const transcript = `
All tests passed.
Build succeeded.
`;

      manager.importShare('test-run-001', 1, 'worker', transcript);

      const summary = manager.generateContextSummary('test-run-001', 2);

      assert.ok(summary.includes('⚠ unverified claims'));
    });
  });

  describe('getUnverifiedClaims', () => {
    it('should return empty array when all claims verified', () => {
      manager.createRun('test-run-001');

      const transcript = `
$ npm test

  14 passing

All tests passed.
`;

      manager.importShare('test-run-001', 1, 'worker', transcript);

      const unverified = manager.getUnverifiedClaims('test-run-001');

      assert.strictEqual(unverified.length, 0);
    });

    it('should return unverified claims across steps', () => {
      manager.createRun('test-run-001');

      manager.importShare('test-run-001', 1, 'worker', 'All tests passed.');
      manager.importShare('test-run-001', 2, 'worker', 'Build succeeded.');

      const unverified = manager.getUnverifiedClaims('test-run-001');

      assert.strictEqual(unverified.length, 2);
      assert.strictEqual(unverified[0]?.step, 1);
      assert.strictEqual(unverified[1]?.step, 2);
    });
  });

  describe('saveSummary and saveVerification', () => {
    it('should save summary to step directory', () => {
      manager.createRun('test-run-001');

      manager.saveSummary('test-run-001', 1, 'step summary');

      const summaryPath = path.join(testRunsDir, 'test-run-001', 'steps', '01', 'summary.md');
      assert.ok(fs.existsSync(summaryPath));

      const content = fs.readFileSync(summaryPath, 'utf8');
      assert.strictEqual(content, 'step summary');
    });

    it('should save verification to step directory', () => {
      manager.createRun('test-run-001');

      manager.saveVerification('test-run-001', 1, 'verification notes');

      const verificationPath = path.join(testRunsDir, 'test-run-001', 'steps', '01', 'verification.md');
      assert.ok(fs.existsSync(verificationPath));

      const content = fs.readFileSync(verificationPath, 'utf8');
      assert.strictEqual(content, 'verification notes');
    });
  });
});
