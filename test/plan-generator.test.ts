import * as assert from 'assert';
import { ConfigLoader } from '../src/config-loader';
import { ExecutionPlan, PlanGenerator, PlanStep } from '../src/plan-generator';

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    stepNumber: overrides.stepNumber ?? 1,
    agentName: overrides.agentName ?? 'worker',
    task: overrides.task ?? 'Implement the change',
    dependencies: overrides.dependencies ?? [],
    expectedOutputs: overrides.expectedOutputs ?? ['Implementation'],
  };
}

describe('PlanGenerator', () => {
  let generator: PlanGenerator;

  beforeEach(() => {
    const configLoader = new ConfigLoader();
    const agents = configLoader.loadAllAgents();
    generator = new PlanGenerator(agents);
  });

  describe('createPlan', () => {
    it('creates a plan with a goal', () => {
      const plan = generator.createPlan('Build a REST API');

      assert.strictEqual(plan.goal, 'Build a REST API');
      assert.ok(plan.createdAt);
      assert.ok(Array.isArray(plan.steps));
      assert.strictEqual(plan.metadata?.totalSteps, plan.steps.length);
    });

    it('rejects empty goals', () => {
      assert.throws(() => generator.createPlan(''), /Goal cannot be empty/);
    });

    it('trims whitespace from the goal', () => {
      const plan = generator.createPlan('  Build API  ');
      assert.strictEqual(plan.goal, 'Build API');
    });

    it('accepts custom worker and reviewer steps', () => {
      const steps: PlanStep[] = [
        makeStep({ stepNumber: 1, agentName: 'worker', task: 'Create API' }),
        makeStep({
          stepNumber: 2,
          agentName: 'reviewer',
          task: 'Review API',
          dependencies: [1],
          expectedOutputs: ['Review notes'],
        }),
      ];

      const plan = generator.createPlan('Build API', steps);

      assert.strictEqual(plan.steps.length, 2);
      assert.strictEqual(plan.steps[0].agentName, 'worker');
      assert.strictEqual(plan.steps[1].agentName, 'reviewer');
      assert.strictEqual(plan.metadata?.totalSteps, 2);
    });
  });

  describe('validation', () => {
    it('rejects unknown agent assignments', () => {
      const steps = [makeStep({ agentName: 'UnknownAgent' })];

      assert.throws(() => generator.createPlan('Goal', steps), /unknown agent: UnknownAgent/);
    });

    it('rejects invalid dependency references', () => {
      const steps = [makeStep({ dependencies: [99] })];

      assert.throws(
        () => generator.createPlan('Goal', steps),
        /invalid dependency: step 99 does not exist/,
      );
    });

    it('rejects forward dependencies', () => {
      const steps = [
        makeStep({ stepNumber: 1, dependencies: [2] }),
        makeStep({ stepNumber: 2 }),
      ];

      assert.throws(
        () => generator.createPlan('Goal', steps),
        /step 2 must come before this step/,
      );
    });
  });

  describe('assignAgent', () => {
    it('routes every implementation domain to worker', () => {
      for (const task of [
        'Build UI component',
        'Create backend service',
        'Setup CI pipeline',
        'Fix security vulnerability',
        'Write tests',
        'Random task',
      ]) {
        assert.strictEqual(generator.assignAgent(task), 'worker');
      }
    });
  });

  describe('getExecutionOrder', () => {
    it('returns correct order for linear dependencies', () => {
      const plan = generator.createPlan('Goal', [
        makeStep({ stepNumber: 1 }),
        makeStep({ stepNumber: 2, dependencies: [1] }),
        makeStep({ stepNumber: 3, agentName: 'reviewer', dependencies: [2] }),
      ]);

      assert.deepStrictEqual(generator.getExecutionOrder(plan), [1, 2, 3]);
    });

    it('handles parallel steps with no dependencies', () => {
      const plan = generator.createPlan('Goal', [makeStep({ stepNumber: 1 }), makeStep({ stepNumber: 2 })]);
      const order = generator.getExecutionOrder(plan);

      assert.strictEqual(order.length, 2);
      assert.ok(order.includes(1));
      assert.ok(order.includes(2));
    });

    it('detects circular dependencies', () => {
      const plan: ExecutionPlan = {
        goal: 'Goal',
        createdAt: new Date().toISOString(),
        steps: [
          makeStep({ stepNumber: 1, dependencies: [2] }),
          makeStep({ stepNumber: 2, dependencies: [1] }),
        ],
        metadata: { totalSteps: 2 },
      };

      assert.throws(() => generator.getExecutionOrder(plan), /Circular dependency/);
    });
  });

  describe('revisePlan', () => {
    it('marks incomplete retry steps with retry prefix', () => {
      const plan = generator.createPlan('Goal', [
        makeStep({ stepNumber: 1, task: 'Create API' }),
        makeStep({ stepNumber: 2, agentName: 'reviewer', task: 'Review API', dependencies: [1] }),
      ]);

      const revised = generator.revisePlan(plan, { retrySteps: [2] }, [1]);

      assert.strictEqual(revised.steps[1].task.startsWith('[RETRY]'), true);
    });

    it('does not mark completed steps for retry', () => {
      const plan = generator.createPlan('Goal', [makeStep({ stepNumber: 1 })]);

      const revised = generator.revisePlan(plan, { retrySteps: [1] }, [1]);

      assert.strictEqual(revised.steps[0].task.startsWith('[RETRY]'), false);
    });

    it('appends valid replan steps', () => {
      const plan = generator.createPlan('Goal', [makeStep({ stepNumber: 1 })]);

      const revised = generator.revisePlan(
        plan,
        { retrySteps: [], addSteps: [{ agent: 'reviewer', task: 'Review security', afterStep: 1 }] },
        [],
      );

      assert.strictEqual(revised.steps.length, 2);
      assert.strictEqual(revised.steps[1].agentName, 'reviewer');
      assert.deepStrictEqual(revised.steps[1].dependencies, [1]);
      assert.strictEqual(revised.metadata?.totalSteps, 2);
    });

    it('skips unknown replan agents', () => {
      const plan = generator.createPlan('Goal', [makeStep({ stepNumber: 1 })]);

      const revised = generator.revisePlan(
        plan,
        { retrySteps: [], addSteps: [{ agent: 'unknown', task: 'Skip me' }] },
        [],
      );

      assert.strictEqual(revised.steps.length, 1);
    });

    // Regression for the codex-quota smoke run: when every step in the
    // original plan has failed, the previous fallback set the new step's
    // dependency to plan.steps[last].stepNumber — the failed step itself.
    // The replan step then waited DEFAULT_DEPENDENCY_WAIT_MS (10 minutes)
    // for a step that could never satisfy. Anchoring to the highest
    // *completed* step (or no dependency when none completed) lets the
    // replan step run immediately.
    it('appends replan steps with no dependency when nothing completed', () => {
      const plan = generator.createPlan('Goal', [
        makeStep({ stepNumber: 1, task: 'failed step A' }),
        makeStep({ stepNumber: 2, task: 'failed step B' }),
      ]);

      const revised = generator.revisePlan(
        plan,
        { retrySteps: [], addSteps: [{ agent: 'worker', task: 'recover from quota wall' }] },
        [], // no completed steps
      );

      assert.strictEqual(revised.steps.length, 3);
      assert.deepStrictEqual(
        revised.steps[2].dependencies,
        [],
        'replan step should NOT depend on a failed step when nothing completed',
      );
    });

    it('appends replan steps anchored to the highest completed step', () => {
      const plan = generator.createPlan('Goal', [
        makeStep({ stepNumber: 1, task: 'completed step' }),
        makeStep({ stepNumber: 2, task: 'failed step', dependencies: [1] }),
      ]);

      const revised = generator.revisePlan(
        plan,
        { retrySteps: [], addSteps: [{ agent: 'worker', task: 'fix from completed state' }] },
        [1], // step 1 completed; step 2 failed
      );

      assert.strictEqual(revised.steps.length, 3);
      assert.deepStrictEqual(
        revised.steps[2].dependencies,
        [1],
        'replan step should anchor to the highest completed step, not the failed last step',
      );
    });
  });

  describe('guidance routing', () => {
    const goal = 'Fix `parseExpr` because `parseExpr("x")` returns null instead of an AST';
    const guidance = 'Do not edit test files. Tests are controlled by the harness.';

    it('routes guidance to step tasks without changing goal classification', () => {
      const plan = generator.createPlan(goal, undefined, { agentGuidance: guidance });

      assert.strictEqual(generator.classifyGoal(goal), 'bug-fix');
      assert.ok(plan.steps.every((step) => step.task.startsWith(guidance)));
      assert.strictEqual(plan.steps[0].agentName, 'worker');
    });

    it('leaves step tasks unchanged when guidance is absent', () => {
      const plan = generator.createPlan(goal);

      assert.ok(!plan.steps[0].task.startsWith(guidance));
    });

    it('applies guidance to user-provided steps', () => {
      const plan = generator.createPlan('Goal', [makeStep({ task: 'Create API' })], {
        agentGuidance: guidance,
      });

      assert.ok(plan.steps[0].task.startsWith(guidance));
      assert.ok(plan.steps[0].task.includes('Create API'));
    });
  });

  describe('classifyGoal', () => {
    it('classifies bug report shapes as bug-fix', () => {
      assert.strictEqual(
        generator.classifyGoal('Fix `parseExpr` because `parseExpr("x")` returns null instead of an AST'),
        'bug-fix',
      );
    });

    it('does not classify greenfield goals as bug-fix just because they use fix wording', () => {
      assert.notStrictEqual(
        generator.classifyGoal('Build a REST API that fixes common auth patterns'),
        'bug-fix',
      );
    });

    it('classifies multi-target existing-code changes as contract-change', () => {
      const goal = 'Update `getUser()` return shape and update `renderUser()` callers';

      assert.strictEqual(generator.classifyGoal(goal), 'contract-change');
    });

    it('does not classify backtick-free multi-update goals as contract-change', () => {
      assert.notStrictEqual(
        generator.classifyGoal('Update docs and update examples for the package'),
        'contract-change',
      );
    });
  });

  describe('contract-change plans', () => {
    const goal = 'Update `getUser()` return shape and update `renderUser()` callers';

    it('bundles implementation, callers, and tests into one worker step', () => {
      const plan = generator.createPlan(goal);

      assert.strictEqual(plan.steps[0].agentName, 'worker');
      assert.ok(plan.steps[0].task.includes('implementation'));
      assert.ok(plan.steps[0].task.includes('call site'));
      assert.ok(plan.steps[0].task.includes('test'));
      assert.strictEqual(plan.steps.filter((step) => step.agentName === 'worker').length, 1);
    });

    it('finishes with a reviewer step', () => {
      const plan = generator.createPlan(goal);
      const lastStep = plan.steps[plan.steps.length - 1];

      assert.strictEqual(lastStep.agentName, 'reviewer');
      assert.deepStrictEqual(lastStep.dependencies, [1]);
    });
  });

  describe('bug-fix plans', () => {
    const goal = 'Fix `parseExpr` because `parseExpr("x")` returns null instead of an AST';

    it('contains worker fix, worker regression test, and reviewer steps', () => {
      const plan = generator.createPlan(goal);
      const agentNames = plan.steps.map((step) => step.agentName);

      assert.deepStrictEqual(agentNames, ['worker', 'worker', 'reviewer']);
      assert.ok(plan.steps[1].task.includes('regression test'));
    });

    it('preserves the raw goal text in every worker step task', () => {
      const plan = generator.createPlan(goal);

      for (const step of plan.steps) {
        if (step.agentName === 'reviewer') continue;
        assert.ok(step.task.includes(goal));
      }
    });
  });
});
