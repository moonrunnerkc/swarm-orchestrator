import * as assert from 'assert';
import { EventEmitter } from 'events';
import { AgentProfile } from '../src/config-loader';
import { ExecutionQueue } from '../src/execution-queue';
import { ExecutionPlan, PlanStep } from '../src/plan-generator';
import { PauseController } from '../src/orchestrator/pause-controller';
import {
  runWaveLoop,
  SchedulerContext,
  SchedulerContextBroker,
  SchedulerHost,
  SchedulerOptions,
  SchedulerStepResult,
} from '../src/orchestrator/wave-scheduler-loop';

/**
 * Regression test for the codex-quota smoke run (2026-04-28).
 *
 * Failure mode reproduced here:
 *   1. Step 1 fails (codex hit usage limit; the replan path will retry).
 *   2. Steps 2, 3 are blocked because they depended on step 1.
 *   3. The scheduler used to log "blocked by failed dependencies: 2, 3"
 *      and break, leaving steps 2 and 3 in `pending` status with NO
 *      context-broker entry.
 *   4. Any later replan step that depended on step 2 or 3 then waited the
 *      full DEFAULT_DEPENDENCY_WAIT_MS (10 minutes) for a step that could
 *      never satisfy, burning the per-instance budget.
 *
 * The fix: when the scheduler detects blocked steps, it marks each as
 * `failed`, calls `addStepContext` (which emits step-completed), and only
 * then breaks. This locks in that contract: every blocked step must be
 * surfaced to the broker so future waitForDependencies returns immediately.
 */

function makeStep(stepNumber: number, dependencies: number[] = []): PlanStep {
  return {
    stepNumber,
    agentName: 'TestAgent',
    task: `task ${stepNumber}`,
    dependencies,
    expectedOutputs: [`output-${stepNumber}.ts`],
  };
}

function makePlan(steps: PlanStep[]): ExecutionPlan {
  return {
    goal: 'blocked-step signaling test',
    createdAt: new Date().toISOString(),
    steps,
    metadata: { totalSteps: steps.length },
  };
}

function makeAgent(name: string): AgentProfile {
  return {
    name,
    purpose: 'test agent',
    scope: [],
    boundaries: [],
    done_definition: [],
    refusal_rules: [],
    output_contract: { transcript: '/tmp/transcript.md', artifacts: [] },
  };
}

class RecordingContextBroker implements SchedulerContextBroker {
  private readonly emitter = new EventEmitter();
  readonly stepContextEntries: Array<{
    stepNumber: number;
    agentName: string;
    timestamp: string;
    data: Record<string, unknown>;
  }> = [];
  readonly emittedStepNumbers: number[] = [];
  forceReleaseStaleLocks(): void { /* no-op */ }
  once(event: string, handler: () => void): void {
    this.emitter.once(event, handler);
  }
  removeListener(event: string, handler: () => void): void {
    this.emitter.removeListener(event, handler);
  }
  addStepContext(entry: {
    stepNumber: number;
    agentName: string;
    timestamp: string;
    data: Record<string, unknown>;
  }): void {
    this.stepContextEntries.push(entry);
    this.emittedStepNumbers.push(entry.stepNumber);
    this.emitter.emit('step-completed', entry.stepNumber);
  }
}

describe('wave-scheduler-loop: blocked-step signaling', () => {
  it('publishes blocked steps to the context broker so future waiters unblock', async () => {
    const initialSteps = [
      makeStep(1, []),       // will fail
      makeStep(2, [1]),      // blocked
      makeStep(3, [1]),      // blocked
    ];
    const plan = makePlan(initialSteps);
    const agents = new Map<string, AgentProfile>([['TestAgent', makeAgent('TestAgent')]]);

    const broker = new RecordingContextBroker();
    const context: SchedulerContext = {
      plan,
      results: initialSteps.map((s) => ({
        stepNumber: s.stepNumber,
        agentName: s.agentName,
        status: 'pending' as const,
      })),
      contextBroker: broker,
      mainBranch: 'main',
      executionId: 'blocked-signal-test',
      runDir: '/tmp/blocked-signal-test',
      startTime: new Date().toISOString(),
      executionQueue: new ExecutionQueue(3),
    };

    const host: SchedulerHost = {
      workingDir: '/tmp/blocked-signal-test',
      pauseController: new PauseController(),
      resolveAgent(map, _name) {
        return map.get('TestAgent');
      },
      async executeStepInSwarm(step: PlanStep, _agent: AgentProfile, ctx: SchedulerContext, _opts?: SchedulerOptions) {
        if (step.stepNumber === 1) {
          // Fail step 1, mirroring the codex-quota path.
          const result = ctx.results.find((r) => r.stepNumber === 1)!;
          result.status = 'failed';
          result.error = 'simulated quota failure';
          throw new Error('simulated quota failure');
        }
        // Steps 2 and 3 should never be reached.
        const result = ctx.results.find((r) => r.stepNumber === step.stepNumber)!;
        result.status = 'completed';
      },
      async mergeWaveBranches(_completed: SchedulerStepResult[], _ctx: SchedulerContext, _opts?: SchedulerOptions) {
        // No-op
      },
    };

    await runWaveLoop(host, plan, agents, context, {});

    // The broker must have entries for the blocked steps. Without this,
    // a later replan step depending on step 2 or 3 would wait 10 minutes.
    assert.ok(
      broker.emittedStepNumbers.includes(2),
      `broker should emit step-completed for blocked step 2; got [${broker.emittedStepNumbers.join(',')}]`,
    );
    assert.ok(
      broker.emittedStepNumbers.includes(3),
      `broker should emit step-completed for blocked step 3; got [${broker.emittedStepNumbers.join(',')}]`,
    );

    const result2 = context.results.find((r) => r.stepNumber === 2);
    const result3 = context.results.find((r) => r.stepNumber === 3);
    assert.equal(result2?.status, 'failed', 'blocked step 2 should be marked failed in results');
    assert.equal(result3?.status, 'failed', 'blocked step 3 should be marked failed in results');
    assert.match(
      result2?.error ?? '',
      /blocked by failed dependencies/i,
      'blocked step 2 should record the structural reason',
    );

    const entry2 = broker.stepContextEntries.find((e) => e.stepNumber === 2);
    assert.equal(entry2?.data.verificationPassed, false);
  });
});
