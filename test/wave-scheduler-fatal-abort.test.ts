import * as assert from 'assert';
import { EventEmitter } from 'events';
import { AgentProfile } from '../src/config-loader';
import { ExecutionQueue } from '../src/execution-queue';
import { ExecutionPlan, PlanStep } from '../src/plan-generator';
import { PauseController } from '../src/orchestrator/pause-controller';
import { FatalRunError, isFatalRunError } from '../src/orchestrator/fatal-run-error';
import {
  runWaveLoop,
  SchedulerContext,
  SchedulerContextBroker,
  SchedulerHost,
  SchedulerOptions,
  SchedulerStepResult,
} from '../src/orchestrator/wave-scheduler-loop';

/**
 * Locks the contract that a FatalRunError thrown by an in-flight step
 * causes the wave loop to:
 *   1. Stop dispatching new steps after the in-flight drain.
 *   2. Re-throw the error to the orchestrator's top-level handler.
 *
 * This is the path that turns a codex-quota hit at step 1 from a
 * "burn 10 minutes per failed task replanning into the same wall" into
 * an immediate abort.
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
    goal: 'fatal-abort test',
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

class StubBroker implements SchedulerContextBroker {
  private readonly emitter = new EventEmitter();
  forceReleaseStaleLocks(): void { /* no-op */ }
  once(event: string, handler: () => void): void {
    this.emitter.once(event, handler);
  }
  removeListener(event: string, handler: () => void): void {
    this.emitter.removeListener(event, handler);
  }
  addStepContext(entry: { stepNumber: number }): void {
    this.emitter.emit('step-completed', entry.stepNumber);
  }
}

describe('wave-scheduler-loop: FatalRunError abort', () => {
  it('rethrows a FatalRunError after draining in-flight steps and stops dispatching new ones', async () => {
    const initialSteps = [
      makeStep(1, []),
      makeStep(2, []),
      makeStep(3, [1, 2]),
    ];
    const plan = makePlan(initialSteps);
    const agents = new Map<string, AgentProfile>([['TestAgent', makeAgent('TestAgent')]]);

    const context: SchedulerContext = {
      plan,
      results: initialSteps.map((s) => ({
        stepNumber: s.stepNumber,
        agentName: s.agentName,
        status: 'pending' as const,
      })),
      contextBroker: new StubBroker(),
      mainBranch: 'main',
      executionId: 'fatal-abort-test',
      runDir: '/tmp/fatal-abort-test',
      startTime: new Date().toISOString(),
      executionQueue: new ExecutionQueue(2),
    };

    const scheduledSteps: number[] = [];

    const host: SchedulerHost = {
      workingDir: '/tmp/fatal-abort-test',
      pauseController: new PauseController(),
      resolveAgent(map, _name) {
        return map.get('TestAgent');
      },
      async executeStepInSwarm(step: PlanStep, _agent, ctx, _opts?: SchedulerOptions) {
        scheduledSteps.push(step.stepNumber);
        const result = ctx.results.find((r) => r.stepNumber === step.stepNumber)!;
        if (step.stepNumber === 1) {
          // Simulate codex usage-limit: classifier produces a fatal error
          // that the step executor wraps in FatalRunError.
          result.status = 'failed';
          result.error = 'simulated usage-limit';
          throw new FatalRunError(
            { kind: 'usage-limit', message: "You've hit your usage limit", evidence: "ERROR: You've hit your usage limit" },
            { stepNumber: 1, agentName: 'TestAgent' },
          );
        }
        result.status = 'completed';
        result.branchName = `swarm/step-${step.stepNumber}`;
      },
      async mergeWaveBranches(_completed: SchedulerStepResult[], _ctx, _opts?: SchedulerOptions) {
        // No-op
      },
    };

    let captured: unknown;
    try {
      await runWaveLoop(host, plan, agents, context, {});
      assert.fail('runWaveLoop should rethrow FatalRunError');
    } catch (err) {
      captured = err;
    }

    assert.ok(isFatalRunError(captured), `expected FatalRunError, got ${(captured as Error).constructor.name}`);
    assert.equal((captured as FatalRunError).fatalKind, 'usage-limit');

    // Step 3 depends on 1 and 2 — it must NOT have been dispatched.
    assert.ok(
      !scheduledSteps.includes(3),
      `step 3 must not run after fatal abort; scheduled=[${scheduledSteps.join(',')}]`,
    );
  });
});
