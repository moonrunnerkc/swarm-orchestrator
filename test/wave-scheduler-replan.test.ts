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
 * Locks the plan-swap invariant documented at the top of
 * wave-scheduler-loop.ts: executeReplan mutates context.plan by
 * assignment; the scheduler must re-read context.plan.steps on every
 * iteration so replan-added steps are scheduled and replan-removed
 * steps are not.
 */

function makeStep(stepNumber: number, dependencies: number[] = [], task = `task ${stepNumber}`): PlanStep {
  return {
    stepNumber,
    agentName: 'TestAgent',
    task,
    dependencies,
    expectedOutputs: [`output-${stepNumber}.ts`],
  };
}

function makePlan(steps: PlanStep[]): ExecutionPlan {
  return {
    goal: 'replan-invariant test',
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

/**
 * Minimal stub for `SchedulerContextBroker` backed by EventEmitter.
 * forceReleaseStaleLocks is a no-op; once/removeListener delegate to
 * the emitter so the scheduler's step-completed wait path is exercised.
 */
class StubContextBroker implements SchedulerContextBroker {
  private readonly emitter = new EventEmitter();
  readonly stepContextEntries: Array<{
    stepNumber: number;
    agentName: string;
    timestamp: string;
    data: Record<string, unknown>;
  }> = [];
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
    this.emitter.emit('step-completed', entry.stepNumber);
  }
}

describe('wave-scheduler-loop: plan-swap invariant', () => {
  it('picks up replan-added steps and does not schedule replan-removed steps', async () => {
    // Initial plan: A, B (depends on A), C (depends on A).
    const initialSteps = [
      makeStep(1, [], 'step A - will trigger replan'),
      makeStep(2, [1], 'step B - removed by replan'),
      makeStep(3, [1], 'step C - removed by replan'),
    ];
    const plan = makePlan(initialSteps);
    const agents = new Map<string, AgentProfile>([['TestAgent', makeAgent('TestAgent')]]);

    const context: SchedulerContext = {
      plan,
      results: initialSteps.map(s => ({
        stepNumber: s.stepNumber,
        agentName: s.agentName,
        status: 'pending' as const,
      })),
      contextBroker: new StubContextBroker(),
      mainBranch: 'main',
      executionId: 'test-run',
      runDir: '/tmp/test-run',
      startTime: new Date().toISOString(),
      executionQueue: new ExecutionQueue(3),
    };

    // Track which steps executeStepInSwarm was called for.
    const scheduledSteps: number[] = [];

    const host: SchedulerHost = {
      workingDir: '/tmp/test-run',
      pauseController: new PauseController(),
      resolveAgent(map: Map<string, AgentProfile>, _name: string) {
        return map.get('TestAgent');
      },
      async executeStepInSwarm(step: PlanStep, _agent: AgentProfile, ctx: SchedulerContext, _opts?: SchedulerOptions) {
        scheduledSteps.push(step.stepNumber);
        const result = ctx.results.find(r => r.stepNumber === step.stepNumber);
        if (!result) throw new Error(`result missing for step ${step.stepNumber}`);
        result.status = 'completed';
        result.branchName = `swarm/step-${step.stepNumber}`;

        // When step 1 (A) finishes, simulate a replan: mutate context.plan
        // by assignment to a new plan with A (completed), D (new), E (new, deps=D).
        // Steps B (2) and C (3) no longer exist in the revised plan.
        if (step.stepNumber === 1) {
          const revised = makePlan([
            makeStep(1, [], 'step A - completed'),
            makeStep(4, [1], 'step D - added by replan'),
            makeStep(5, [4], 'step E - added by replan (depends on D)'),
          ]);
          ctx.plan = revised;
          // Also mark the removed steps as no longer pending so the
          // scheduler's blocked-by-failure branch is not triggered.
          for (const r of ctx.results) {
            if (r.stepNumber === 2 || r.stepNumber === 3) {
              r.status = 'completed';
              r.branchName = `swarm/removed-${r.stepNumber}`;
            }
          }
          // Append results entries for the new steps D and E
          ctx.results.push({ stepNumber: 4, agentName: 'TestAgent', status: 'pending' });
          ctx.results.push({ stepNumber: 5, agentName: 'TestAgent', status: 'pending' });
        }
      },
      async mergeWaveBranches(_completed: SchedulerStepResult[], _ctx: SchedulerContext, _opts?: SchedulerOptions) {
        // No-op: merging is not exercised in this test.
      },
    };

    await runWaveLoop(host, plan, agents, context, {});

    // Assertion 1: step B (2) was never scheduled.
    // The replan removed it; the scheduler must not call executeStepInSwarm for it.
    assert.ok(!scheduledSteps.includes(2), `step B (2) should not be scheduled after replan removed it; got scheduled=${scheduledSteps.join(',')}`);

    // Assertion 2: step D (4) was scheduled after the replan fired.
    // The replan added it; the scheduler must pick it up from context.plan on the next iteration.
    assert.ok(scheduledSteps.includes(4), `step D (4) should be scheduled after replan added it; got scheduled=${scheduledSteps.join(',')}`);

    // Assertion 3: step E (5) was scheduled after step D (4) completed.
    // E depends on D in the revised plan; dependency ordering must be respected.
    assert.ok(scheduledSteps.includes(5), `step E (5) should be scheduled after replan added it; got scheduled=${scheduledSteps.join(',')}`);
    const dIdx = scheduledSteps.indexOf(4);
    const eIdx = scheduledSteps.indexOf(5);
    assert.ok(dIdx < eIdx, `step E (5) should be scheduled AFTER step D (4); got D@${dIdx}, E@${eIdx}`);

    // Assertion 4: step C (3) was likewise not scheduled (same failure mode as B).
    assert.ok(!scheduledSteps.includes(3), `step C (3) should not be scheduled after replan removed it; got scheduled=${scheduledSteps.join(',')}`);
  });
});
