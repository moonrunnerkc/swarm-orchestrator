import { strict as assert } from 'assert';
import { ExecutionPlan, PlanStep } from '../../src/plan-generator';
import { analyzePlanDependencies, analyzeStepTouchpoints, canRunTogether } from '../../src/scheduling/dependency-analyzer';

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
    goal: 'dependency analysis',
    createdAt: new Date().toISOString(),
    steps,
  };
}

describe('dependency analyzer', () => {
  it('extracts explicit file touchpoints from task text and expected outputs', () => {
    const analysis = analyzeStepTouchpoints({
      ...step(1, 'Update src/api/items.ts and docs/api.md'),
      expectedOutputs: ['test/api.test.ts'],
    });

    assert.deepStrictEqual(
      analysis.touchpoints,
      ['docs/api.md', 'src/api/items.ts', 'test/api.test.ts'],
    );
    assert.strictEqual(analysis.conservative, false);
  });

  it('allows parallel execution for disjoint file touchpoints', () => {
    const analysis = analyzePlanDependencies(plan([
      step(1, 'Create src/string-utils.ts'),
      step(2, 'Create src/number-utils.ts'),
    ]));

    assert.strictEqual(canRunTogether(analysis, 1, 2), true);
    assert.strictEqual(analysis.parallelizable, true);
  });

  it('conflicts when a directory touchpoint covers another file', () => {
    const analysis = analyzePlanDependencies(plan([
      step(1, 'Refactor src/api/'),
      step(2, 'Update src/api/items.ts'),
    ]));

    assert.strictEqual(canRunTogether(analysis, 1, 2), false);
  });

  it('conflicts when shared acceptance-test state is detected', () => {
    const analysis = analyzePlanDependencies(plan([
      step(1, 'Add database migration in src/db/schema.ts'),
      step(2, 'Update tests that seed database fixtures in test/items.test.ts'),
    ]));

    assert.strictEqual(canRunTogether(analysis, 1, 2), false);
  });

  it('defaults to sequential when a task has no static touchpoints', () => {
    const analysis = analyzePlanDependencies(plan([
      step(1, 'Improve the implementation'),
      step(2, 'Create src/number-utils.ts'),
    ]));

    assert.strictEqual(canRunTogether(analysis, 1, 2), false);
    assert.strictEqual(analysis.parallelizable, false);
  });

  it('does not treat ignored paths as write touchpoints', () => {
    const analysis = analyzePlanDependencies(plan([
      step(2, 'Add tests in test/api.test.js and update package.json with a test script', [1]),
      step(3, 'Add a Dockerfile and a .dockerignore excluding node_modules, .git, and test/', [1]),
    ]));

    assert.strictEqual(canRunTogether(analysis, 2, 3), true);
  });
});
