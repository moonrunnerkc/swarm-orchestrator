import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import ContextBroker from '../src/context-broker';

describe('ContextBroker', () => {
  const testRunDir = path.join(process.cwd(), 'test', 'fixtures', 'context-broker-test');

  beforeEach(() => {
    if (fs.existsSync(testRunDir)) {
      fs.rmSync(testRunDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testRunDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testRunDir)) {
      fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  describe('git locking', () => {
    it('should acquire and release git lock', async () => {
      const broker = new ContextBroker(testRunDir);

      const lockId = await broker.acquireGitLock('agent1', 'commit');

      assert(lockId !== null, 'should acquire lock');
      assert(typeof lockId === 'string', 'lock ID should be string');

      broker.releaseGitLock(lockId);

      // should be able to acquire again after release
      const lockId2 = await broker.acquireGitLock('agent2', 'merge');
      assert(lockId2 !== null, 'should acquire lock after release');

      broker.releaseGitLock(lockId2);
    });

    it('should block concurrent lock acquisition', async () => {
      const broker = new ContextBroker(testRunDir);

      const lock1 = await broker.acquireGitLock('agent1', 'commit');
      assert(lock1 !== null);

      // try to acquire while locked (should timeout quickly for test)
      const broker2 = new ContextBroker(testRunDir);
      (broker2 as any).maxLockWaitMs = 500; // reduce timeout for test

      const lock2 = await broker2.acquireGitLock('agent2', 'push');
      assert.strictEqual(lock2, null, 'second lock should timeout');

      broker.releaseGitLock(lock1);
    });

    it('should force-release all locks via forceReleaseStaleLocks', async () => {
      const broker = new ContextBroker(testRunDir);

      // Create a lock
      const lockId = await broker.acquireGitLock('agent1', 'merge');
      assert(lockId !== null);

      // Force release it
      broker.forceReleaseStaleLocks();

      // Should be able to acquire again immediately
      const lockId2 = await broker.acquireGitLock('agent2', 'merge');
      assert(lockId2 !== null);
      broker.releaseGitLock(lockId2);
    });

    it('should remove stale locks', async function() {
      this.timeout(10000);

      const broker = new ContextBroker(testRunDir);

      // create a stale lock manually
      const lockDir = path.join(testRunDir, '.locks');
      const lockFile = path.join(lockDir, 'git.lock');

      const staleLock = {
        lockId: 'stale-123',
        agentName: 'old-agent',
        operation: 'old-op',
        acquiredAt: new Date(Date.now() - 400000).toISOString() // 6 minutes ago
      };

      fs.writeFileSync(lockFile, JSON.stringify(staleLock));

      // should remove stale lock and acquire
      const lockId = await broker.acquireGitLock('new-agent', 'new-op');
      assert(lockId !== null, 'should acquire after removing stale lock');

      broker.releaseGitLock(lockId);
    });
  });

  describe('shared context', () => {
    it('should add and retrieve step context', () => {
      const broker = new ContextBroker(testRunDir);

      broker.addStepContext({
        stepNumber: 1,
        agentName: 'worker',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['src/app.tsx', 'src/styles.css'],
          outputsSummary: 'UI components created',
          branchName: 'swarm/exec-1/step-1-frontend',
          commitShas: ['abc123']
        }
      });

      const allContext = broker.getAllContext();
      assert.strictEqual(allContext.length, 1);
      assert.strictEqual(allContext[0]?.stepNumber, 1);
      assert.strictEqual(allContext[0]?.agentName, 'worker');
    });

    it('should retrieve context for specific steps', () => {
      const broker = new ContextBroker(testRunDir);

      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['file1.ts'],
          outputsSummary: 'output1'
        }
      });

      broker.addStepContext({
        stepNumber: 2,
        agentName: 'Agent2',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['file2.ts'],
          outputsSummary: 'output2'
        }
      });

      broker.addStepContext({
        stepNumber: 3,
        agentName: 'Agent3',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['file3.ts'],
          outputsSummary: 'output3'
        }
      });

      const context = broker.getContextForSteps([1, 3]);
      assert.strictEqual(context.length, 2);
      assert.strictEqual(context[0]?.stepNumber, 1);
      assert.strictEqual(context[1]?.stepNumber, 3);
    });

    it('should generate dependency context summary', () => {
      const broker = new ContextBroker(testRunDir);

      broker.addStepContext({
        stepNumber: 1,
        agentName: 'worker',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['api/users.ts', 'api/auth.ts'],
          outputsSummary: 'User API endpoints created',
          branchName: 'swarm/exec-1/step-1-backend',
          commitShas: ['abc123', 'def456']
        }
      });

      const summary = broker.getDependencyContext([1]);

      assert(summary.includes('Step 1'), 'should mention step number');
      assert(summary.includes('worker'), 'should mention agent');
      assert(summary.includes('User API endpoints created'), 'should include summary');
      assert(summary.includes('api/users.ts'), 'should list files');
      assert(summary.includes('Commits: 2'), 'should show commit count');
    });

    it('should check if dependencies are satisfied', () => {
      const broker = new ContextBroker(testRunDir);

      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: [],
          outputsSummary: 'done'
        }
      });

      assert.strictEqual(broker.areDependenciesSatisfied([1]), true);
      assert.strictEqual(broker.areDependenciesSatisfied([1, 2]), false);
      assert.strictEqual(broker.areDependenciesSatisfied([]), true);
    });

    it('should wait for dependencies', async function() {
      this.timeout(5000);

      const broker = new ContextBroker(testRunDir);

      // simulate async dependency completion
      setTimeout(() => {
        broker.addStepContext({
          stepNumber: 1,
          agentName: 'Agent1',
          timestamp: new Date().toISOString(),
          data: {
            filesChanged: [],
            outputsSummary: 'done'
          }
        });
      }, 500);

      const satisfied = await broker.waitForDependencies([1], 2000);
      assert.strictEqual(satisfied, true);
    });

    it('should timeout waiting for dependencies', async function() {
      this.timeout(3000);

      const broker = new ContextBroker(testRunDir);

      const satisfied = await broker.waitForDependencies([1], 1000);
      assert.strictEqual(satisfied, false);
    });

    it('should clear context', () => {
      const broker = new ContextBroker(testRunDir);

      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: [],
          outputsSummary: 'done'
        }
      });

      assert.strictEqual(broker.getAllContext().length, 1);

      broker.clearContext();

      assert.strictEqual(broker.getAllContext().length, 0);
    });
  });

  describe('strict isolation', () => {
    it('should return all entries when strictIsolation is false', () => {
      const broker = new ContextBroker(testRunDir);

      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['a.ts'],
          outputsSummary: 'done'
        }
      });

      broker.addStepContext({
        stepNumber: 2,
        agentName: 'Agent2',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['b.ts'],
          outputsSummary: 'done',
          transcript: '/runs/123/steps/step-2/share.md'
        }
      });

      const result = broker.getContextForSteps([1, 2], false);
      assert.strictEqual(result.length, 2, 'non-strict mode returns all entries');
    });

    it('should filter entries without transcript in strict mode', () => {
      const broker = new ContextBroker(testRunDir);

      // entry WITHOUT transcript (should be rejected in strict mode)
      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['a.ts'],
          outputsSummary: 'done'
        }
      });

      // entry WITH transcript (should pass)
      broker.addStepContext({
        stepNumber: 2,
        agentName: 'Agent2',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['b.ts'],
          outputsSummary: 'done',
          transcript: '/runs/123/steps/step-2/share.md'
        }
      });

      const result = broker.getContextForSteps([1, 2], true);
      assert.strictEqual(result.length, 1, 'strict mode rejects non-transcript entries');
      assert.strictEqual(result[0]?.stepNumber, 2);
    });

    it('should reject entries with empty transcript string in strict mode', () => {
      const broker = new ContextBroker(testRunDir);

      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['a.ts'],
          outputsSummary: 'done',
          transcript: ''
        }
      });

      const result = broker.getContextForSteps([1], true);
      assert.strictEqual(result.length, 0, 'empty transcript string is rejected');
    });

    it('should propagate strict isolation through getDependencyContext', () => {
      const broker = new ContextBroker(testRunDir);

      // entry without transcript
      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['file.ts'],
          outputsSummary: 'API created',
          branchName: 'swarm/exec-1/step-1',
          commitShas: ['abc123']
        }
      });

      // strict mode: no transcript-backed entries for step 1
      const strictSummary = broker.getDependencyContext([1], true);
      assert(
        strictSummary.includes('context not yet available'),
        'strict mode should show no context for non-transcript entries'
      );

      // non-strict mode: returns normal context
      const normalSummary = broker.getDependencyContext([1], false);
      assert(normalSummary.includes('API created'), 'non-strict returns full context');
    });
  });

  describe('EventEmitter integration', () => {
    it('should emit step-completed when addStepContext is called', (done) => {
      const broker = new ContextBroker(testRunDir);

      broker.once('step-completed', (stepNumber: number) => {
        assert.strictEqual(stepNumber, 3);
        done();
      });

      broker.addStepContext({
        stepNumber: 3,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: ['app.ts'],
          outputsSummary: 'created app',
          transcript: '/runs/test/steps/step-3/share.md'
        }
      });
    });

    it('should emit distinct events for different steps', () => {
      const broker = new ContextBroker(testRunDir);
      const received: number[] = [];

      broker.on('step-completed', (stepNumber: number) => {
        received.push(stepNumber);
      });

      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: { filesChanged: ['a.ts'], outputsSummary: 'done' }
      });

      broker.addStepContext({
        stepNumber: 2,
        agentName: 'Agent2',
        timestamp: new Date().toISOString(),
        data: { filesChanged: ['b.ts'], outputsSummary: 'done' }
      });

      assert.deepStrictEqual(received, [1, 2]);
    });

    it('should resolve waitForDependencies via events', async () => {
      const broker = new ContextBroker(testRunDir);

      // Add step 1 context immediately
      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Agent1',
        timestamp: new Date().toISOString(),
        data: { filesChanged: ['a.ts'], outputsSummary: 'done' }
      });

      // Step 2 context arrives after a short delay
      setTimeout(() => {
        broker.addStepContext({
          stepNumber: 2,
          agentName: 'Agent2',
          timestamp: new Date().toISOString(),
          data: { filesChanged: ['b.ts'], outputsSummary: 'done' }
        });
      }, 50);

      const satisfied = await broker.waitForDependencies([1, 2], 5000);
      assert.strictEqual(satisfied, true);
    });

    it('should timeout if dependency never appears', async () => {
      const broker = new ContextBroker(testRunDir);

      const satisfied = await broker.waitForDependencies([99], 200);
      assert.strictEqual(satisfied, false);
    });
  });

  describe('rapid sequential writes', () => {
    it('should preserve all entries when addStepContext is called 20 times rapidly', () => {
      const broker = new ContextBroker(testRunDir);

      for (let i = 1; i <= 20; i++) {
        broker.addStepContext({
          stepNumber: i,
          agentName: `Agent${i}`,
          timestamp: new Date().toISOString(),
          data: { filesChanged: [`file${i}.ts`], outputsSummary: `step ${i} done` }
        });
      }

      const allContext = broker.getAllContext();
      assert.strictEqual(allContext.length, 20, 'all 20 entries should be persisted');
      for (let i = 1; i <= 20; i++) {
        const entry = allContext.find(e => e.stepNumber === i);
        assert.ok(entry, `entry for step ${i} should exist`);
        assert.strictEqual(entry.agentName, `Agent${i}`);
      }
    });

    it('should release lock even when write data causes getAllContext to return empty', () => {
      const broker = new ContextBroker(testRunDir);

      // Write a corrupt context file, then call addStepContext.
      // getAllContext returns [] on parse failure, so the entry should still be written.
      const contextFile = path.join(testRunDir, '.context', 'shared-context.json');
      fs.mkdirSync(path.dirname(contextFile), { recursive: true });
      fs.writeFileSync(contextFile, '<<<not json>>>', 'utf8');

      broker.addStepContext({
        stepNumber: 1,
        agentName: 'Recovery',
        timestamp: new Date().toISOString(),
        data: { filesChanged: [], outputsSummary: 'recovered' }
      });

      const allContext = broker.getAllContext();
      assert.strictEqual(allContext.length, 1, 'should recover from corrupt file');
      assert.strictEqual(allContext[0]?.agentName, 'Recovery');

      // Lock should be released; a second write must succeed
      broker.addStepContext({
        stepNumber: 2,
        agentName: 'FollowUp',
        timestamp: new Date().toISOString(),
        data: { filesChanged: [], outputsSummary: 'ok' }
      });
      assert.strictEqual(broker.getAllContext().length, 2);
    });
  });
});
