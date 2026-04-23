import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPostExecution, PostRunContext } from '../src/post-run-reporter';
import type { ExecutionPlan } from '../src/plan-generator';
import PRAutomation from '../src/pr-automation';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'post-run-'));
}

function makePlan(steps = 2): ExecutionPlan {
  return {
    goal: 'Test goal',
    createdAt: new Date().toISOString(),
    steps: Array.from({ length: steps }, (_, i) => ({
      stepNumber: i + 1,
      agentName: `Agent${i + 1}`,
      task: `Task ${i + 1}`,
      dependencies: i > 0 ? [i] : [],
      expectedOutputs: ['out.ts'],
    })),
    metadata: { totalSteps: steps },
  };
}

/**
 * Minimal MetricsCollector stub that satisfies the interface used by
 * runPostExecution without requiring the real class and its side-effects.
 */
function makeMetricsStub(runDir: string) {
  return {
    finalize: () => ({
      totalSteps: 2,
      completedSteps: 2,
      failedSteps: 0,
      totalDurationMs: 1000,
    }),
    saveSession: (_id: string, _state: any) => { /* no-op */ },
  };
}

describe('post-run-reporter', () => {
  let runDir: string;
  let workDir: string;

  beforeEach(() => {
    workDir = tmpDir();
    runDir = path.join(workDir, 'runs', 'test-run');
    fs.mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('writes metrics.json and session-state.json when metricsCollector is provided', async () => {
    const context: PostRunContext = {
      executionId: 'test-run',
      mainBranch: 'main',
      results: [
        { stepNumber: 1, status: 'completed' } as any,
        { stepNumber: 2, status: 'completed' } as any,
      ],
      metricsCollector: makeMetricsStub(runDir) as any,
    };

    await runPostExecution(workDir, runDir, context, makePlan());

    assert.ok(fs.existsSync(path.join(runDir, 'metrics.json')), 'metrics.json should exist');
    assert.ok(fs.existsSync(path.join(runDir, 'session-state.json')), 'session-state.json should exist');

    const metrics = JSON.parse(fs.readFileSync(path.join(runDir, 'metrics.json'), 'utf8'));
    assert.equal(metrics.totalSteps, 2);

    const session = JSON.parse(fs.readFileSync(path.join(runDir, 'session-state.json'), 'utf8'));
    assert.equal(session.status, 'completed');
    assert.equal(session.lastCompletedStep, 2);
  });

  it('sets session status to failed when not all steps completed', async () => {
    const context: PostRunContext = {
      executionId: 'test-run',
      mainBranch: 'main',
      results: [
        { stepNumber: 1, status: 'completed' } as any,
        { stepNumber: 2, status: 'failed' } as any,
      ],
      metricsCollector: makeMetricsStub(runDir) as any,
    };

    await runPostExecution(workDir, runDir, context, makePlan());

    const session = JSON.parse(fs.readFileSync(path.join(runDir, 'session-state.json'), 'utf8'));
    assert.equal(session.status, 'failed');
    assert.equal(session.lastCompletedStep, 1);
  });

  it('skips metrics when no metricsCollector is provided', async () => {
    const context: PostRunContext = {
      executionId: 'test-run',
      mainBranch: 'main',
      results: [{ stepNumber: 1, status: 'completed' } as any],
    };

    await runPostExecution(workDir, runDir, context, makePlan(1));

    assert.ok(!fs.existsSync(path.join(runDir, 'metrics.json')), 'metrics.json should not exist');
  });

  it('threads mainBranch into generatePRSummary when autoPR is set', async () => {
    // Capture what generatePRSummary receives without running the real gh CLI.
    // dryRun in ExternalToolManager short-circuits the subprocess, so PRAutomation
    // never spawns gh — we only need the summary-build step to fire with the right ctx.
    const originalGenerate = PRAutomation.prototype.generatePRSummary;
    const calls: Array<{ mainBranch: unknown; plan: unknown; runDir: unknown }> = [];
    PRAutomation.prototype.generatePRSummary = function(ctx: any, deps: any) {
      calls.push({ mainBranch: ctx.mainBranch, plan: ctx.plan, runDir: ctx.runDir });
      return originalGenerate.call(this, ctx, deps);
    };

    try {
      const context: PostRunContext = {
        executionId: 'test-run',
        mainBranch: 'trunk',
        results: [{ stepNumber: 1, status: 'completed', agentName: 'A' } as any],
      };

      await runPostExecution(workDir, runDir, context, makePlan(1), {
        autoPR: true,
        dryRun: true,
      });

      assert.equal(calls.length, 1, 'generatePRSummary should be called exactly once');
      assert.equal(calls[0].mainBranch, 'trunk', 'mainBranch must flow into generatePRSummary');
      assert.equal((calls[0].runDir as string), runDir, 'runDir should be passed through');
      assert.ok(calls[0].plan, 'plan should be passed through');
    } finally {
      PRAutomation.prototype.generatePRSummary = originalGenerate;
    }
  });
});
