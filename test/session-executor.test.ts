import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import SessionExecutor from '../src/session-executor';
import { AgentAdapter, AgentResult, AgentSpawnOptions } from '../src/adapters/agent-adapter';

/** Minimal adapter stub that returns a preconfigured result. */
class StubAdapter implements AgentAdapter {
  readonly name = 'stub';
  constructor(private result: AgentResult) {}
  async spawn(_opts: AgentSpawnOptions): Promise<AgentResult> {
    return this.result;
  }
}

describe('SessionExecutor', () => {
  const testDir = path.join(process.cwd(), 'test', 'fixtures', 'session-executor');

  before(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  after(() => {
    // clean up test files
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('buildStepPrompt', () => {
    it('should include human-like commit instructions', () => {
      const executor = new SessionExecutor();
      
      const step = {
        stepNumber: 1,
        task: 'Add user authentication',
        agentName: 'worker',
        dependencies: [],
        expectedOutputs: ['Auth module', 'Tests']
      };

      const agent = {
        name: 'worker',
        purpose: 'Server-side development',
        scope: ['Backend code', 'APIs'],
        boundaries: ['No frontend'],
        done_definition: ['Tests pass'],
        refusal_rules: ['No invented APIs'],
        output_contract: {
          transcript: 'proof/step-{N}-backend.md',
          artifacts: []
        }
      };

      const context = {
        plan: {
          goal: 'Build auth system',
          steps: [step],
          agentAssignments: ['worker']
        },
        planFilename: 'test-plan.json',
        executionId: 'test-123',
        startTime: new Date().toISOString(),
        currentStep: 0,
        stepResults: [],
        priorContext: []
      };

      // access private method via any cast for testing
      const prompt = (executor as any).buildStepPrompt(step, agent, context);

      // verify critical commit instructions are present
      assert(prompt.includes('INCREMENTAL commits'), 'should mention incremental commits');
      assert(prompt.includes('Natural and human-written'), 'should mention natural messages');
      assert(prompt.includes('Descriptive and imperative'), 'should mention imperative style');
      assert(prompt.includes('git add'), 'should show git add command');
      assert(prompt.includes('git commit -m'), 'should show git commit command');
      assert(prompt.includes('Good commit message examples'), 'should include examples');
      assert(prompt.includes('add user authentication'), 'should have example messages');
      assert(prompt.includes('fix:'), 'should show conventional commit example');
      assert(prompt.includes('Multiple small commits'), 'should emphasize multiple commits');
    });

    it('should include agent scope and boundaries', () => {
      const executor = new SessionExecutor();
      
      const step = {
        stepNumber: 1,
        task: 'Test task',
        agentName: 'TestAgent',
        dependencies: [],
        expectedOutputs: []
      };

      const agent = {
        name: 'TestAgent',
        purpose: 'Testing',
        scope: ['Unit tests', 'Integration tests'],
        boundaries: ['No production code'],
        done_definition: ['All pass'],
        refusal_rules: ['No mocking real behavior'],
        output_contract: {
          transcript: 'proof/step-{N}-test.md',
          artifacts: []
        }
      };

      const context = {
        plan: {
          goal: 'Test goal',
          steps: [step],
          agentAssignments: ['TestAgent']
        },
        planFilename: 'plan.json',
        executionId: 'exec-1',
        startTime: new Date().toISOString(),
        currentStep: 0,
        stepResults: [],
        priorContext: []
      };

      const prompt = (executor as any).buildStepPrompt(step, agent, context);

      assert(prompt.includes('Unit tests'), 'should include scope items');
      assert(prompt.includes('No production code'), 'should include boundaries');
      assert(prompt.includes('All pass'), 'should include done definition');
    });

    it('should include prior context when dependencies exist', () => {
      const executor = new SessionExecutor();
      
      const step = {
        stepNumber: 2,
        task: 'Second step',
        agentName: 'Agent2',
        dependencies: [1],
        expectedOutputs: []
      };

      const agent = {
        name: 'Agent2',
        purpose: 'Second agent',
        scope: ['Task 2'],
        boundaries: [],
        done_definition: [],
        refusal_rules: [],
        output_contract: {
          transcript: 'proof/step-2.md',
          artifacts: []
        }
      };

      const context = {
        plan: {
          goal: 'Multi-step',
          steps: [step],
          agentAssignments: ['Agent1', 'Agent2']
        },
        planFilename: 'plan.json',
        executionId: 'exec-2',
        startTime: new Date().toISOString(),
        currentStep: 1,
        stepResults: [],
        priorContext: ['Step 1 (Agent1): Created module']
      };

      const prompt = (executor as any).buildStepPrompt(step, agent, context);

      assert(prompt.includes('Dependencies'), 'should mention dependencies');
      assert(prompt.includes('Step 1 (Agent1): Created module'), 'should include prior context');
    });
  });

  describe('executeSession', () => {
    it('should construct correct command args', async function() {
      this.timeout(10000);
      this.skip(); // skip for now - requires full copilot CLI setup
      
      const executor = new SessionExecutor(testDir);

      // note: this test will fail if copilot is not installed
      // we're just verifying the command construction
      const result = await executor.executeSession(
        'echo test',
        {
          model: 'gpt-5-mini',
          silent: true,
          allowAllTools: true
        }
      );

      // verify result structure
      assert(typeof result.success === 'boolean', 'should have success field');
      assert(typeof result.output === 'string', 'should have output field');
      assert(typeof result.exitCode === 'number', 'should have exitCode field');
      assert(typeof result.duration === 'number', 'should have duration field');
    });
  });

  describe('executeWithRetry', () => {
    it('should retry on failure up to max attempts', async function() {
      this.timeout(10000);
      
      const executor = new SessionExecutor(testDir);

      let attemptCount = 0;
      
      // override executeSession to simulate failures
      const originalExecute = executor.executeSession.bind(executor);
      executor.executeSession = async (prompt, options) => {
        attemptCount++;
        if (attemptCount < 2) {
          // fail first attempt
          return {
            success: false,
            output: 'error',
            error: 'simulated error',
            exitCode: 1,
            duration: 100
          };
        }
        // succeed on second attempt
        return {
          success: true,
          output: 'success',
          exitCode: 0,
          duration: 100
        };
      };

      const result = await executor.executeWithRetry('test', {}, 3);

      assert.strictEqual(attemptCount, 2, 'should have attempted twice');
      assert.strictEqual(result.success, true, 'should succeed after retry');
    });

    it('should return last failure if all retries exhausted', async function() {
      this.timeout(10000);
      
      const executor = new SessionExecutor(testDir);

      // override to always fail
      executor.executeSession = async () => {
        return {
          success: false,
          output: 'error',
          error: 'persistent error',
          exitCode: 1,
          duration: 100
        };
      };

      const result = await executor.executeWithRetry('test', {}, 2);

      assert.strictEqual(result.success, false, 'should fail after all retries');
      assert(result.error?.includes('persistent error'), 'should include error message');
    });
  });

  describe('transcript capture on non-zero exit', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-transcript-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should write transcript to shareToFile even when agent exits non-zero', async () => {
      const adapter = new StubAdapter({
        stdout: 'Created tests/api.test.js\nAll tests pass',
        stderr: 'warning: some cleanup failed',
        exitCode: 1,
        durationMs: 5000,
      });
      const executor = new SessionExecutor(tmpDir, adapter);
      const shareFile = path.join(tmpDir, 'steps', 'step-4', 'share.md');

      const result = await executor.executeSession('write api tests', { shareToFile: shareFile });

      assert.strictEqual(result.success, false, 'session should report failure');
      assert.ok(fs.existsSync(shareFile), 'transcript file must exist despite non-zero exit');
      const content = fs.readFileSync(shareFile, 'utf8');
      assert.ok(content.includes('Created tests/api.test.js'), 'transcript should contain agent stdout');
    });

    it('should include stderr in transcript when stdout is empty on failure', async () => {
      const adapter = new StubAdapter({
        stdout: '',
        stderr: 'fatal: model quota exceeded',
        exitCode: 1,
        durationMs: 1000,
      });
      const executor = new SessionExecutor(tmpDir, adapter);
      const shareFile = path.join(tmpDir, 'share.md');

      await executor.executeSession('do something', { shareToFile: shareFile });

      const content = fs.readFileSync(shareFile, 'utf8');
      assert.ok(content.includes('fatal: model quota exceeded'), 'stderr should appear in transcript when stdout is empty');
    });

    it('should still write transcript on success (no regression)', async () => {
      const adapter = new StubAdapter({
        stdout: 'All done successfully',
        stderr: '',
        exitCode: 0,
        durationMs: 3000,
      });
      const executor = new SessionExecutor(tmpDir, adapter);
      const shareFile = path.join(tmpDir, 'share.md');

      const result = await executor.executeSession('test prompt', { shareToFile: shareFile });

      assert.strictEqual(result.success, true);
      assert.ok(fs.existsSync(shareFile), 'transcript should exist on success');
      const content = fs.readFileSync(shareFile, 'utf8');
      assert.ok(content.includes('All done successfully'));
    });

    it('should set transcriptPath in result even on failure', async () => {
      const adapter = new StubAdapter({
        stdout: 'partial work done',
        stderr: 'timeout',
        exitCode: 1,
        durationMs: 600000,
      });
      const executor = new SessionExecutor(tmpDir, adapter);
      const shareFile = path.join(tmpDir, 'share.md');

      const result = await executor.executeSession('do work', { shareToFile: shareFile });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.transcriptPath, shareFile, 'transcriptPath must be set even on failure');
    });
  });
});
