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

    // PRECONDITION CONTRACT: the test below reproduces the original classifier-
    // poisoning bug to prove the fixture captures the real failure mode. If
    // this assertion stops holding, the classifier's keyword logic has
    // changed and the downstream "CAPTURES THE FIX" test's negation no longer
    // proves the Fix-1 isolation mechanism — it could be passing for an
    // unrelated reason (e.g. Fix 2 made assignAgent route bug-fix shapes
    // differently). Update BOTH tests together or neither.
    //
    // The original bug: run_swebench.py concatenated the "do not edit tests"
    // preamble onto the goal before passing it to --goal. The word "test" in
    // the preamble matched assignAgent's TesterElite keyword regex, and the
    // planner allocated TesterElite as primary for a bug-fix task.
    it('LOCKS IN THE BUG: concatenated preamble+goal makes the classifier pick TesterElite', () => {
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

    it('Fix 1 + Fix 2 together: raw bug-fix goal routes to an impl-editing agent', () => {
      // Cross-check that Fix 1's isolation + Fix 2's bug-fix goal type
      // compose correctly on the sympy-12481 shape. The goal alone has bug-
      // report structural shape (backtick references + present-tense failure
      // verb), so detectGoalType should return 'bug-fix' and the template
      // puts BackendMaster first. With guidance routed through agentGuidance,
      // that remains true because classification runs on the raw goal.
      const plan = generator.createPlan(SYMPY_GOAL, undefined, {
        agentGuidance: SWE_BENCH_PREAMBLE,
      });
      const implAgents = new Set(['BackendMaster', 'FrontendExpert']);
      assert.ok(
        implAgents.has(plan.steps[0].agentName),
        `primary agent must be impl-editing; got ${plan.steps[0].agentName}`,
      );
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

  describe('classifyGoal — direct classifier contract (issue #27 fix 2)', () => {
    // Direct unit tests on the classifier. These isolate classifier
    // correctness from template correctness: if detectGoalType regresses
    // (e.g., a future edit to the keyword regexes or structural
    // discriminator), these tests fail at the classifier layer and name
    // the bug precisely, instead of firing as cascading "plan shape looks
    // wrong" failures in the indirect tests below.

    const BUG_FIX_POSITIVES = [
      {
        name: 'sympy-12481 (Permutation constructor)',
        goal: [
          '`Permutation` constructor fails with non-disjoint cycles',
          'Calling `Permutation([[0,1],[0,1]])` raises a `ValueError` instead of',
          'constructing the identity permutation.',
        ].join('\n'),
      },
      {
        name: 'django-style HttpResponse header',
        goal:
          '`HttpResponseRedirect` with empty `Location` header raises ' +
          '`InternalError` instead of the documented `ValueError` when the ' +
          'redirect target is missing.',
      },
      {
        name: 'matplotlib-style axis scale',
        goal:
          '`ax.set_xscale("log")` crashes with zero-valued data. ' +
          '`set_xscale` throws a `ValueError` during redraw.',
      },
    ];

    for (const { name, goal } of BUG_FIX_POSITIVES) {
      it(`classifyGoal("${name}") === 'bug-fix'`, () => {
        assert.strictEqual(generator.classifyGoal(goal), 'bug-fix');
      });
    }

    const BUG_FIX_NEGATIVES = [
      {
        name: 'greenfield REST API mentioning "fix"',
        goal: 'Build a REST API that fixes common patterns and handles errors gracefully',
      },
      {
        name: 'greenfield library build, no backticks no failure verbs',
        goal: 'Build a small utility library for parsing dates',
      },
      {
        name: 'single backtick + failure verb',
        goal:
          'The `parse` function fails on empty input — build a new parser ' +
          'that handles this correctly',
      },
      {
        name: 'failure verbs without backtick references',
        goal:
          'Build a parser that never fails on malformed JSON — it should ' +
          'raise a clear error',
      },
    ];

    for (const { name, goal } of BUG_FIX_NEGATIVES) {
      it(`classifyGoal("${name}") !== 'bug-fix'`, () => {
        assert.notStrictEqual(generator.classifyGoal(goal), 'bug-fix');
      });
    }
  });

  describe('contract-change goal type (issue #27 fix 3)', () => {
    // The exact PR #22 pilot goal that produced the broken shape: simple-get's
    // userAgent-required contract change. Pre-Fix-3, this classified as
    // 'library' and the rigid library template put impl in step 1 with tests
    // in step 2 — step 1's verifier ran npm test against pre-existing tests
    // that expected the old contract, failed, rolled back, step 2 never ran.
    const SIMPLE_GET_GOAL =
      '`simple-get` is an HTTP client library with an options object. ' +
      'Make the `userAgent` string a required option: the module must throw ' +
      "`Error('simple-get: userAgent option is required')` when it is missing " +
      'from a call. Update `index.js` (the main entry point), update the ' +
      "TypeScript types if present, update README.md's examples to supply " +
      '`userAgent`, and update the existing test file so every call passes ' +
      "`userAgent: 'simple-get-test'` or similar. Do not weaken the check to " +
      "'warn' — it must throw.";

    const RENAME_CALLERS_GOAL =
      'Rename the default-exported function currently named `isPlainObject` ' +
      'to `isPureObject`. Update every call site in the repo, update the test ' +
      'file, update the TypeScript type definitions, and update every ' +
      'reference in README.md.';

    const SCHEMA_UPDATE_GOAL =
      'Add a `publishedAt DateTime?` field to the `Post` model in ' +
      '`prisma/schema.prisma`. Update the migration file and update ' +
      '`src/index.ts` so one of the demo queries filters posts on ' +
      '`publishedAt`.';

    // Direct classifier tests — tied to classifyGoal, not plan shape,
    // so they keep signaling if future tuning breaks the contract.
    it('classifyGoal(simple-get contract change) === "contract-change"', () => {
      assert.strictEqual(generator.classifyGoal(SIMPLE_GET_GOAL), 'contract-change');
    });

    it('classifyGoal(rename-then-update-callers) === "contract-change"', () => {
      assert.strictEqual(generator.classifyGoal(RENAME_CALLERS_GOAL), 'contract-change');
    });

    it('classifyGoal(schema-then-query update) === "contract-change"', () => {
      assert.strictEqual(generator.classifyGoal(SCHEMA_UPDATE_GOAL), 'contract-change');
    });

    // False-positive guardrails
    it('greenfield "update docs" without multi-target updates does NOT trip contract-change', () => {
      // Single "update" clause, greenfield otherwise — not a contract change.
      assert.notStrictEqual(
        generator.classifyGoal(
          'Build a new documentation site and update the README to describe it',
        ),
        'contract-change',
      );
    });

    it('bug-fix description with one "update" clause does NOT trip contract-change', () => {
      // Bug report with a single "update" in the proposed work doesn't become
      // contract-change — only multi-target update clauses do.
      const bugWithUpdate =
        '`parse()` raises `TypeError` when given None. Update `parse()` to ' +
        'return an empty result for None inputs.';
      assert.notStrictEqual(generator.classifyGoal(bugWithUpdate), 'contract-change');
    });

    it('backtick-free multi-update goal does NOT trip contract-change', () => {
      // Without backtick refs to existing symbols, a greenfield multi-part
      // build ("update the backend ... update the frontend") shouldn't route
      // to contract-change. It'd be a multi-module new-build, not a
      // coordinated-change-to-existing.
      assert.notStrictEqual(
        generator.classifyGoal(
          'Build and deploy. Update the backend configs, update the frontend ' +
            'build, update the documentation.',
        ),
        'contract-change',
      );
    });

    // Template shape invariants — the heart of Fix 3
    const IMPL_EDITING_AGENTS = new Set(['BackendMaster', 'FrontendExpert']);

    it('plan has no impl→test-update split: there is never a TesterElite step between an impl step and IntegratorFinalizer', () => {
      // The exact observed broken shape from smoke3 / PR #22 pilot was
      // BackendMaster (impl) → TesterElite (test update) — with the verifier
      // running `npm test` between them against a half-updated codebase.
      // The contract-change template must NOT produce that sequence.
      const plan = generator.createPlan(SIMPLE_GET_GOAL);
      for (let i = 0; i < plan.steps.length - 1; i++) {
        const here = plan.steps[i];
        const next = plan.steps[i + 1];
        if (IMPL_EDITING_AGENTS.has(here.agentName) && next.agentName === 'TesterElite') {
          assert.fail(
            `step ${here.stepNumber} (${here.agentName}) is followed by a ` +
              `separate TesterElite step. That's the broken shape: ` +
              `per-step verification will run tests against a half-applied ` +
              `contract change and roll back. See #27 Fix 3.`,
          );
        }
      }
    });

    it('the single impl step bundles impl + callers + tests (task prompt mentions all three)', () => {
      const plan = generator.createPlan(SIMPLE_GET_GOAL);
      const implStep = plan.steps.find(s => IMPL_EDITING_AGENTS.has(s.agentName));
      assert.ok(implStep, 'plan must contain an impl-editing step');
      const task = implStep!.task.toLowerCase();
      // The task prompt must make the bundle explicit — otherwise the agent
      // might ship impl alone and call it done.
      assert.ok(
        task.includes('caller') || task.includes('call site'),
        'task prompt must direct the agent to update call sites',
      );
      assert.ok(
        task.includes('test'),
        'task prompt must direct the agent to update tests in the same step',
      );
      assert.ok(
        task.includes('atomic') || task.includes('single') || task.includes('combined'),
        'task prompt must signal single-step atomicity of the bundle',
      );
    });

    it('exactly one impl-editing step, so there is nothing after it for npm test to trip on', () => {
      const plan = generator.createPlan(SIMPLE_GET_GOAL);
      const implSteps = plan.steps.filter(s => IMPL_EDITING_AGENTS.has(s.agentName));
      assert.strictEqual(
        implSteps.length,
        1,
        `contract-change plans bundle all editing into one step. Got ` +
          `${implSteps.length} impl-editing steps: ` +
          `${implSteps.map(s => `${s.stepNumber}:${s.agentName}`).join(', ')}`,
      );
    });

    it('plan does NOT contain a TesterElite step at all for contract-change', () => {
      // TesterElite writes tests as a separate step. For contract-change,
      // the impl step updates the tests in-place; a TesterElite step after
      // would be redundant OR reintroduce the impl/test split.
      const plan = generator.createPlan(SIMPLE_GET_GOAL);
      const testerSteps = plan.steps.filter(s => s.agentName === 'TesterElite');
      assert.strictEqual(
        testerSteps.length,
        0,
        'contract-change template must not allocate TesterElite as its own step',
      );
    });

    it('greenfield library goal still routes to the library template (no regression)', () => {
      // Classifying "contract-change" before "library" is correct only if the
      // contract-change discriminator is strict enough that greenfield library
      // builds still reach the library template.
      const plan = generator.createPlan(
        'Build a small utility library for date formatting with date, time, and timezone helpers',
      );
      // library template is 3 steps; contract-change is 2
      assert.notStrictEqual(
        plan.steps.length,
        2,
        'greenfield library should not route to the 2-step contract-change template',
      );
    });

    it('applyGateRequirements with testCoverage enabled does NOT re-inject TesterElite on contract-change plans', () => {
      // Production configs load gate configs with testCoverage: enabled. Before
      // the applyGateRequirements guard, the auto-inject path would add a
      // TesterElite step to any plan missing one — re-creating the exact
      // impl→test-update split Fix 3 prevents.
      const { DEFAULT_QUALITY_GATES_CONFIG } = require('../src/quality-gates/default-config');
      const configLoader = new ConfigLoader();
      const agents = configLoader.loadAllAgents();
      const gatedGenerator = new PlanGenerator(agents, DEFAULT_QUALITY_GATES_CONFIG);

      const plan = gatedGenerator.createPlan(SIMPLE_GET_GOAL);
      const testerSteps = plan.steps.filter(s => s.agentName === 'TesterElite');
      assert.strictEqual(
        testerSteps.length,
        0,
        'contract-change plan must stay free of TesterElite even with ' +
          'testCoverage gate enabled; found: ' +
          testerSteps.map(s => `step ${s.stepNumber}`).join(', '),
      );
    });
  });

  describe('bug-fix goal type (issue #27 fix 2)', () => {
    // Representative bug-report-shaped goals sourced from real SWE-bench
    // Verified instance bodies. Kept small: the discriminator's behavior
    // across the full 500-instance set is an integration concern, not a
    // unit test's job. These are samples chosen for structural diversity
    // (different domain, different failure vocabulary, different backtick
    // density).
    const BUG_FIX_GOALS: { name: string; goal: string }[] = [
      {
        name: 'sympy-12481 (Permutation constructor)',
        goal: [
          '`Permutation` constructor fails with non-disjoint cycles',
          'Calling `Permutation([[0,1],[0,1]])` raises a `ValueError` instead of',
          'constructing the identity permutation.',
        ].join('\n'),
      },
      {
        name: 'django-10914 style (HttpResponse)',
        goal: [
          '`HttpResponse` headers returning wrong content-type',
          '`response.headers["Content-Type"]` returns `application/octet-stream`',
          'when no content type is set, instead of the expected text/html.',
        ].join('\n'),
      },
      {
        name: 'matplotlib style (axis scale)',
        goal: [
          '`ax.set_xscale("log")` crashes with zero-valued data',
          'Calling `ax.set_xscale("log")` on an axis whose data contains zeros',
          'throws a `ValueError` during redraw instead of clamping to a positive',
          'epsilon or raising a clearer message.',
        ].join('\n'),
      },
    ];

    // Invariant-focused assertions. We do NOT pin the plan to a specific
    // agent sequence — that would make the test brittle to future tuning
    // of which impl agent leads (BackendMaster vs FrontendExpert vs future
    // additions). The contract of Fix 2 is: every bug-fix goal produces a
    // plan with at least one impl-editing step. That's the testable
    // invariant.
    const IMPL_EDITING_AGENTS = new Set(['BackendMaster', 'FrontendExpert']);

    for (const { name, goal } of BUG_FIX_GOALS) {
      it(`classifies "${name}" as bug-fix`, () => {
        // Direct test of the classifier contract. detectGoalType is private
        // but we can infer its output by observing the plan shape: a
        // non-bug-fix classification would route through one of the other
        // templates.
        const plan = generator.createPlan(goal);
        const agents = plan.steps.map(s => s.agentName);
        assert.ok(
          agents.some(a => IMPL_EDITING_AGENTS.has(a)),
          `bug-fix goal must produce a plan with at least one impl-editing ` +
            `step (BackendMaster or FrontendExpert). Got agents: ${agents.join(', ')}`,
        );
      });

      it(`"${name}" primary agent is impl-editing, not a tester or integrator`, () => {
        const plan = generator.createPlan(goal);
        const primary = plan.steps[0].agentName;
        assert.ok(
          IMPL_EDITING_AGENTS.has(primary),
          `primary must be impl-editing for a bug-fix goal. Got ${primary}.`,
        );
      });
    }

    // Discriminator robustness — false-positive guardrails
    it('greenfield "build a REST API that fixes common patterns" does NOT trip bug-fix classification', () => {
      // Contains "fix" as a verb but is a greenfield goal — no backticked
      // existing-symbol references, no present-tense failure observation.
      // The structural discriminator should reject this.
      const plan = generator.createPlan(
        'Build a REST API that fixes common patterns and handles errors gracefully',
      );
      // Expected template: the API one. Primary agent: BackendMaster (by the
      // API template). So the primary alone doesn't distinguish. Discriminator
      // check: the template's step shape should not be the 3-step bug-fix
      // shape. bug-fix template always produces exactly BackendMaster +
      // TesterElite + IntegratorFinalizer in that order. The API template
      // produces 5 steps.
      assert.notStrictEqual(
        plan.steps.length,
        3,
        'greenfield goal should not route to the bug-fix 3-step template',
      );
    });

    it('greenfield "build a library" with no backticks and no failure verb does NOT trip bug-fix', () => {
      const plan = generator.createPlan('Build a small utility library for parsing dates');
      // library template is 3 steps too, coincidentally. Distinguish by
      // checking the step-1 task template — bug-fix says "Diagnose and fix",
      // library says "Implement library core API".
      assert.ok(
        !plan.steps[0].task.includes('Diagnose and fix'),
        'greenfield library goal should not use the bug-fix step-1 task template',
      );
    });

    it('single backtick reference is not enough to classify as bug-fix', () => {
      // One backtick + failure verb is ambiguous (could be a greenfield
      // description citing one symbol). Require at least two.
      const plan = generator.createPlan(
        'The `parse` function fails on empty input — build a new parser that handles this correctly',
      );
      assert.ok(
        !plan.steps[0].task.includes('Diagnose and fix'),
        'single backtick reference must not route to bug-fix template',
      );
    });

    it('failure verbs without backtick references do not trip bug-fix', () => {
      // "fails" / "raises" / "errors" can appear in forward-looking goal
      // descriptions ("must not fail on empty input"). Without structural
      // backtick signals that reference existing code, this is greenfield.
      const plan = generator.createPlan(
        'Build a parser that never fails on malformed JSON — it should raise a clear error',
      );
      assert.ok(
        !plan.steps[0].task.includes('Diagnose and fix'),
        'failure verbs alone must not route to bug-fix template',
      );
    });

    // Template shape invariants — what bug-fix plans look like structurally
    it('bug-fix plan includes at least one impl-editing step AND a test step', () => {
      const plan = generator.createPlan(BUG_FIX_GOALS[0].goal);
      const agents = new Set(plan.steps.map(s => s.agentName));
      assert.ok(
        [...agents].some(a => IMPL_EDITING_AGENTS.has(a)),
        'must have at least one impl-editing agent',
      );
      assert.ok(agents.has('TesterElite'), 'must have a TesterElite step');
    });

    it('bug-fix plan preserves the raw goal text in every step task for agent context', () => {
      const plan = generator.createPlan(BUG_FIX_GOALS[0].goal);
      const uniqueFragment = 'non-disjoint cycles';
      for (const step of plan.steps) {
        // The integrator step doesn't need to re-paste the goal (it sees
        // upstream step outputs). BackendMaster and TesterElite do.
        if (step.agentName === 'IntegratorFinalizer') continue;
        assert.ok(
          step.task.includes(uniqueFragment),
          `step ${step.stepNumber} (${step.agentName}) must preserve the reported failure context in its task; missing "${uniqueFragment}"`,
        );
      }
    });
  });
});
