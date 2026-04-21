import * as assert from 'assert';
import { ConfigLoader } from '../src/config-loader';
import { ExecutionPlan, PlanGenerator, PlanStep } from '../src/plan-generator';

describe('PlanGenerator', () => {
  let generator: PlanGenerator;

  beforeEach(() => {
    const configLoader = new ConfigLoader();
    const agents = configLoader.loadAllAgents();
    generator = new PlanGenerator(agents);
  });

  describe('createPlan', () => {
    it('should create a plan with a goal', () => {
      const plan = generator.createPlan('Build a REST API');

      assert.ok(plan);
      assert.strictEqual(plan.goal, 'Build a REST API');
      assert.ok(plan.createdAt);
      assert.ok(Array.isArray(plan.steps));
      assert.ok(plan.metadata);
    });

    it('should reject empty goal', () => {
      assert.throws(() => {
        generator.createPlan('');
      }, /Goal cannot be empty/);
    });

    it('should trim whitespace from goal', () => {
      const plan = generator.createPlan('  Build API  ');
      assert.strictEqual(plan.goal, 'Build API');
    });

    it('should create plan with custom steps', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          agentName: 'BackendMaster',
          task: 'Create API',
          dependencies: [],
          expectedOutputs: ['API code']
        },
        {
          stepNumber: 2,
          agentName: 'TesterElite',
          task: 'Test API',
          dependencies: [1],
          expectedOutputs: ['Test results']
        }
      ];

      const plan = generator.createPlan('Build API', steps);

      assert.strictEqual(plan.steps.length, 2);
      assert.ok(plan.steps[0]);
      assert.ok(plan.steps[1]);
      assert.strictEqual(plan.steps[0].agentName, 'BackendMaster');
      assert.strictEqual(plan.steps[1].agentName, 'TesterElite');
    });

    it('should set totalSteps in metadata', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          agentName: 'BackendMaster',
          task: 'Task 1',
          dependencies: [],
          expectedOutputs: ['Output']
        }
      ];

      const plan = generator.createPlan('Goal', steps);
      assert.strictEqual(plan.metadata?.totalSteps, 1);
    });
  });

  describe('validation', () => {
    it('should reject unknown agent assignment', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          agentName: 'UnknownAgent',
          task: 'Do something',
          dependencies: [],
          expectedOutputs: ['Output']
        }
      ];

      assert.throws(() => {
        generator.createPlan('Goal', steps);
      }, /unknown agent: UnknownAgent/);
    });

    it('should reject invalid dependency reference', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          agentName: 'BackendMaster',
          task: 'Task 1',
          dependencies: [99],
          expectedOutputs: ['Output']
        }
      ];

      assert.throws(() => {
        generator.createPlan('Goal', steps);
      }, /invalid dependency: step 99 does not exist/);
    });

    it('should reject forward dependency', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          agentName: 'BackendMaster',
          task: 'Task 1',
          dependencies: [2],
          expectedOutputs: ['Output']
        },
        {
          stepNumber: 2,
          agentName: 'TesterElite',
          task: 'Task 2',
          dependencies: [],
          expectedOutputs: ['Output']
        }
      ];

      assert.throws(() => {
        generator.createPlan('Goal', steps);
      }, /step 2 must come before this step/);
    });
  });

  describe('assignAgent', () => {
    it('should assign FrontendExpert for UI tasks', () => {
      assert.strictEqual(generator.assignAgent('Build UI component'), 'FrontendExpert');
      assert.strictEqual(generator.assignAgent('Create frontend'), 'FrontendExpert');
    });

    it('should assign BackendMaster for API tasks', () => {
      assert.strictEqual(generator.assignAgent('Build API endpoint'), 'BackendMaster');
      assert.strictEqual(generator.assignAgent('Create backend service'), 'BackendMaster');
    });

    it('should assign DevOpsPro for deployment tasks', () => {
      assert.strictEqual(generator.assignAgent('Setup CI pipeline'), 'DevOpsPro');
      assert.strictEqual(generator.assignAgent('Configure Docker'), 'DevOpsPro');
    });

    it('should assign SecurityAuditor for security tasks', () => {
      assert.strictEqual(generator.assignAgent('Fix security vulnerability'), 'SecurityAuditor');
      assert.strictEqual(generator.assignAgent('Audit security'), 'SecurityAuditor');
    });

    it('should assign TesterElite for testing tasks', () => {
      assert.strictEqual(generator.assignAgent('Write tests'), 'TesterElite');
      assert.strictEqual(generator.assignAgent('Improve quality'), 'TesterElite');
    });

    it('should assign IntegratorFinalizer as fallback', () => {
      assert.strictEqual(generator.assignAgent('Random task'), 'IntegratorFinalizer');
    });
  });

  describe('getExecutionOrder', () => {
    it('should return correct order for linear dependencies', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          agentName: 'BackendMaster',
          task: 'Step 1',
          dependencies: [],
          expectedOutputs: []
        },
        {
          stepNumber: 2,
          agentName: 'TesterElite',
          task: 'Step 2',
          dependencies: [1],
          expectedOutputs: []
        },
        {
          stepNumber: 3,
          agentName: 'IntegratorFinalizer',
          task: 'Step 3',
          dependencies: [2],
          expectedOutputs: []
        }
      ];

      const plan = generator.createPlan('Goal', steps);
      const order = generator.getExecutionOrder(plan);

      assert.deepStrictEqual(order, [1, 2, 3]);
    });

    it('should handle parallel steps (no dependencies)', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          agentName: 'BackendMaster',
          task: 'Step 1',
          dependencies: [],
          expectedOutputs: []
        },
        {
          stepNumber: 2,
          agentName: 'FrontendExpert',
          task: 'Step 2',
          dependencies: [],
          expectedOutputs: []
        }
      ];

      const plan = generator.createPlan('Goal', steps);
      const order = generator.getExecutionOrder(plan);

      // Both can run, order doesn't matter but both should be present
      assert.strictEqual(order.length, 2);
      assert.ok(order.includes(1));
      assert.ok(order.includes(2));
    });

    it('should handle complex dependency graph', () => {
      const steps: PlanStep[] = [
        {
          stepNumber: 1,
          agentName: 'BackendMaster',
          task: 'Step 1',
          dependencies: [],
          expectedOutputs: []
        },
        {
          stepNumber: 2,
          agentName: 'FrontendExpert',
          task: 'Step 2',
          dependencies: [],
          expectedOutputs: []
        },
        {
          stepNumber: 3,
          agentName: 'TesterElite',
          task: 'Step 3',
          dependencies: [1, 2],
          expectedOutputs: []
        }
      ];

      const plan = generator.createPlan('Goal', steps);
      const order = generator.getExecutionOrder(plan);

      // Step 3 must come after both 1 and 2
      const indexOf3 = order.indexOf(3);
      const indexOf1 = order.indexOf(1);
      const indexOf2 = order.indexOf(2);

      assert.ok(indexOf3 > indexOf1);
      assert.ok(indexOf3 > indexOf2);
    });

    it('should detect circular dependencies', () => {
      // Create plan with circular dependency by bypassing validation
      const plan: ExecutionPlan = {
        goal: 'Test',
        createdAt: new Date().toISOString(),
        steps: [
          {
            stepNumber: 1,
            agentName: 'BackendMaster',
            task: 'Step 1',
            dependencies: [2],
            expectedOutputs: []
          },
          {
            stepNumber: 2,
            agentName: 'FrontendExpert',
            task: 'Step 2',
            dependencies: [1],
            expectedOutputs: []
          }
        ],
        metadata: { totalSteps: 2 }
      };

      assert.throws(() => {
        generator.getExecutionOrder(plan);
      }, /Circular dependency detected/);
    });
  });

  describe('revisePlan', () => {
    it('should mark retry steps with [RETRY] prefix', () => {
      const basePlan: ExecutionPlan = {
        goal: 'Build API',
        createdAt: new Date().toISOString(),
        steps: [
          { stepNumber: 1, agentName: 'BackendMaster', task: 'Create API', dependencies: [], expectedOutputs: ['api.ts'] },
          { stepNumber: 2, agentName: 'TesterElite', task: 'Write tests', dependencies: [1], expectedOutputs: ['tests'] }
        ],
        metadata: { totalSteps: 2 }
      };

      const revised = generator.revisePlan(basePlan, { retrySteps: [2] }, [1]);

      assert.strictEqual(revised.steps.length, 2);
      assert.ok(revised.steps[1].task.startsWith('[RETRY]'));
      // completed step 1 should not be marked
      assert.ok(!revised.steps[0].task.startsWith('[RETRY]'));
    });

    it('should not mark completed steps for retry', () => {
      const basePlan: ExecutionPlan = {
        goal: 'Build API',
        createdAt: new Date().toISOString(),
        steps: [
          { stepNumber: 1, agentName: 'BackendMaster', task: 'Create API', dependencies: [], expectedOutputs: ['api.ts'] },
          { stepNumber: 2, agentName: 'TesterElite', task: 'Write tests', dependencies: [1], expectedOutputs: ['tests'] }
        ],
        metadata: { totalSteps: 2 }
      };

      // both steps marked for retry but step 1 is completed
      const revised = generator.revisePlan(basePlan, { retrySteps: [1, 2] }, [1]);

      // step 1 completed, should not have retry prefix
      assert.ok(!revised.steps[0].task.startsWith('[RETRY]'));
      // step 2 not completed, should have retry prefix
      assert.ok(revised.steps[1].task.startsWith('[RETRY]'));
    });

    it('should append new steps from replan', () => {
      const basePlan: ExecutionPlan = {
        goal: 'Build API',
        createdAt: new Date().toISOString(),
        steps: [
          { stepNumber: 1, agentName: 'BackendMaster', task: 'Create API', dependencies: [], expectedOutputs: ['api.ts'] }
        ],
        metadata: { totalSteps: 1 }
      };

      const revised = generator.revisePlan(basePlan, {
        retrySteps: [],
        addSteps: [{ agent: 'SecurityAuditor', task: 'Audit security', afterStep: 1 }]
      }, []);

      assert.strictEqual(revised.steps.length, 2);
      assert.strictEqual(revised.steps[1].agentName, 'SecurityAuditor');
      assert.strictEqual(revised.steps[1].stepNumber, 2);
      assert.deepStrictEqual(revised.steps[1].dependencies, [1]);
    });

    it('should skip unknown agents in addSteps', () => {
      const basePlan: ExecutionPlan = {
        goal: 'Build API',
        createdAt: new Date().toISOString(),
        steps: [
          { stepNumber: 1, agentName: 'BackendMaster', task: 'Create API', dependencies: [], expectedOutputs: ['api.ts'] }
        ],
        metadata: { totalSteps: 1 }
      };

      const revised = generator.revisePlan(basePlan, {
        retrySteps: [],
        addSteps: [{ agent: 'FakeAgent', task: 'Fake task' }]
      }, []);

      // should not add step for unknown agent
      assert.strictEqual(revised.steps.length, 1);
    });

    it('should update metadata after revision', () => {
      const basePlan: ExecutionPlan = {
        goal: 'Build API',
        createdAt: new Date().toISOString(),
        steps: [
          { stepNumber: 1, agentName: 'BackendMaster', task: 'Create API', dependencies: [], expectedOutputs: ['api.ts'] }
        ],
        metadata: { totalSteps: 1 }
      };

      const revised = generator.revisePlan(basePlan, {
        retrySteps: [],
        addSteps: [{ agent: 'TesterElite', task: 'Add tests' }]
      }, []);

      assert.strictEqual(revised.metadata?.totalSteps, 2);
    });
  });

  describe('classifier preamble hygiene (issue #27 fix 1)', () => {
    // The exact goal text Phase 4a smoke3 used for sympy__sympy-12481.
    // Reproducing it verbatim — any fuzzing risks changing the pattern match
    // that poisoned the classifier.
    const SYMPY_GOAL = [
      '`Permutation` constructor fails with non-disjoint cycles',
      'Calling `Permutation([[0,1],[0,1]])` raises a `ValueError` instead of',
      'constructing the identity permutation. If the cycles passed in are',
      'non-disjoint, they should be applied in left-to-right order and the',
      'resulting permutation should be returned.',
      '',
      "This should be easy to compute. I don't see a reason why non-disjoint",
      'cycles should be forbidden.',
    ].join('\n');

    const SWE_BENCH_PREAMBLE =
      'IMPORTANT: Do NOT modify, delete, or rewrite any test files. ' +
      'Only edit source code to fix the issue. Test files are verified ' +
      'by an external harness and your edits will cause patch conflicts.';

    it('LOCKS IN THE BUG: concatenated preamble+goal makes the classifier pick TesterElite', () => {
      // This is the precondition test. If this test stops returning TesterElite,
      // the classifier changed in a way that may have broken the mechanism this
      // fix targets, and the positive-case test below becomes vacuous.
      // The bug was: run_swebench.py concatenated the "do not edit tests"
      // preamble onto the goal before passing it to --goal. The word "test"
      // in the preamble matched assignAgent's TesterElite keyword regex.
      const poisonedGoal = `${SWE_BENCH_PREAMBLE}\n\n${SYMPY_GOAL}`;
      assert.strictEqual(
        generator.assignAgent(poisonedGoal),
        'TesterElite',
        'precondition: without the layer split, preamble+goal returns TesterElite ' +
          '(the classifier-poisoning mechanism this fix targets). If this stops ' +
          'reproducing, the downstream test loses meaning.',
      );
    });

    it('CAPTURES THE FIX: the raw task intent alone classifies away from TesterElite', () => {
      // The mechanism of the fix: the classifier is called with the raw goal,
      // not the preamble-wrapped goal. On the raw sympy intent, assignAgent
      // must NOT return TesterElite — regardless of what specific agent it
      // does pick (that's fix 2's territory; this test asserts the isolation
      // property, not the correctness of the fallback).
      const primary = generator.assignAgent(SYMPY_GOAL);
      assert.notStrictEqual(
        primary,
        'TesterElite',
        'raw bug-fix goal (no preamble) must not be classified as a testing task. ' +
          `Got primary=${primary}.`,
      );
    });

    it('createPlan with agentGuidance routes preamble to steps, not to classifier', () => {
      // End-to-end: the layer split through createPlan. The classifier sees
      // the raw goal (no preamble), so primary-agent selection is based on
      // task intent. The preamble is still reachable by executing agents
      // because it's prepended to every step's task text.
      const plan = generator.createPlan(SYMPY_GOAL, undefined, {
        agentGuidance: SWE_BENCH_PREAMBLE,
      });
      const primary = plan.steps[0].agentName;
      assert.notStrictEqual(
        primary,
        'TesterElite',
        'primary agent must not be TesterElite when guidance is routed via agentGuidance',
      );
      for (const step of plan.steps) {
        assert.ok(
          step.task.startsWith(SWE_BENCH_PREAMBLE),
          'each step task must begin with the guidance so executing agents see it',
        );
      }
      assert.strictEqual(
        plan.goal,
        SYMPY_GOAL,
        'plan.goal records the raw task intent, unchanged by guidance',
      );
    });

    it('createPlan without agentGuidance emits step tasks unchanged (backward compat)', () => {
      const plan = generator.createPlan('Build a REST API');
      for (const step of plan.steps) {
        assert.ok(
          !step.task.startsWith('IMPORTANT:'),
          'no guidance → no preamble prepended to step tasks',
        );
      }
    });

    it('agentGuidance is layer-split even when userProvidedSteps is supplied', () => {
      const userSteps: PlanStep[] = [
        {
          stepNumber: 1,
          agentName: 'BackendMaster',
          task: 'Implement the fix',
          dependencies: [],
          expectedOutputs: ['Fix'],
        },
      ];
      const plan = generator.createPlan(SYMPY_GOAL, userSteps, {
        agentGuidance: SWE_BENCH_PREAMBLE,
      });
      assert.strictEqual(
        plan.steps[0].agentName,
        'BackendMaster',
        'explicit userProvidedSteps survives guidance injection',
      );
      assert.ok(
        plan.steps[0].task.startsWith(SWE_BENCH_PREAMBLE),
        'guidance still prepends to user-provided step tasks',
      );
    });
  });
});
