import { strict as assert } from 'assert';
import { ExecutionPlan, PlanStep } from '../../src/plan-generator';
import { WorkStealingQueue } from '../../src/scheduling/work-stealing-queue';

function step(stepNumber: number, task: string, dependencies: number[] = []): PlanStep {
  return {
    stepNumber,
    agentName: 'worker',
    task,
    dependencies,
    expectedOutputs: [],
  };
}

function plan(steps: PlanStep[]): ExecutionPlan {
  return {
    goal: 'work stealing',
    createdAt: new Date().toISOString(),
    steps,
  };
}

describe('WorkStealingQueue', () => {
  it('dispatches independent ready steps up to worker capacity', () => {
    const queue = new WorkStealingQueue(plan([
      step(1, 'Create src/string-utils.ts'),
      step(2, 'Create src/number-utils.ts'),
      step(3, 'Create docs/usage.md'),
    ]), { maxWorkers: 2 });

    assert.deepStrictEqual(queue.nextDispatches(), [1, 2]);
    queue.markRunning(1);
    queue.markRunning(2);
    assert.deepStrictEqual(queue.nextDispatches(), []);
    queue.markCompleted(1);
    assert.deepStrictEqual(queue.nextDispatches(), [3]);
  });

  it('runs conservatively linear when static analysis cannot prove independence', () => {
    const queue = new WorkStealingQueue(plan([
      step(1, 'Improve the implementation'),
      step(2, 'Create src/number-utils.ts'),
    ]), { maxWorkers: 3 });

    assert.deepStrictEqual(queue.nextDispatches(), [1]);
    queue.markRunning(1);
    assert.deepStrictEqual(queue.nextDispatches(), []);
  });

  it('respects explicit dependencies before offering work', () => {
    const queue = new WorkStealingQueue(plan([
      step(1, 'Create src/api.ts'),
      step(2, 'Create test/api.test.ts', [1]),
      step(3, 'Create Dockerfile', [1]),
    ]), { maxWorkers: 3 });

    assert.deepStrictEqual(queue.nextDispatches(), [1]);
    queue.markRunning(1);
    queue.markCompleted(1);
    assert.deepStrictEqual(queue.nextDispatches(), [2, 3]);
  });

  it('syncs a replanned graph and picks up added steps', () => {
    const queue = new WorkStealingQueue(plan([
      step(1, 'Create src/api.ts'),
      step(2, 'Create src/old.ts', [1]),
    ]), { maxWorkers: 2 });

    queue.markRunning(1);
    queue.markCompleted(1);
    queue.syncPlan(plan([
      step(1, 'Create src/api.ts'),
      step(4, 'Create src/new.ts', [1]),
    ]));

    assert.deepStrictEqual(queue.nextDispatches(), [4]);
  });
});
