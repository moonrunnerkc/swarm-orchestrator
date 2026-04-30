import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { StepRunner, ExecutionContext } from '../src/step-runner';
import { ExecutionPlan } from '../src/plan-generator';
import { ConfigLoader } from '../src/config-loader';

describe('StepRunner', () => {
  const testProofDir = path.join(__dirname, '..', '..', 'test-proof');
  let runner: StepRunner;
  let configLoader: ConfigLoader;

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testProofDir)) {
      fs.rmSync(testProofDir, { recursive: true });
    }
    runner = new StepRunner(testProofDir);
    configLoader = new ConfigLoader();
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testProofDir)) {
      fs.rmSync(testProofDir, { recursive: true });
    }
  });

  const createTestPlan = (): ExecutionPlan => ({
    goal: 'Test Goal',
    createdAt: new Date().toISOString(),
    steps: [
      {
        stepNumber: 1,
        agentName: 'worker',
        task: 'Create API',
        dependencies: [],
        expectedOutputs: ['API code', 'Tests']
      },
      {
        stepNumber: 2,
        agentName: 'worker',
        task: 'Test API',
        dependencies: [1],
        expectedOutputs: ['Test results']
      }
    ],
    metadata: { totalSteps: 2 }
  });

  describe('initializeExecution', () => {
    it('should create execution context', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      assert.ok(context);
      assert.strictEqual(context.plan.goal, 'Test Goal');
      assert.strictEqual(context.planFilename, 'test-plan.json');
      assert.ok(context.executionId);
      assert.ok(context.startTime);
      assert.strictEqual(context.currentStep, 0);
      assert.strictEqual(context.stepResults.length, 2);
      assert.strictEqual(context.priorContext.length, 0);
    });

    it('should initialize all steps as pending', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      context.stepResults.forEach(result => {
        assert.strictEqual(result.status, 'pending');
      });
    });

    it('should create execution ID with timestamp', () => {
      const plan = createTestPlan();
      const context1 = runner.initializeExecution(plan, 'test1.json');

      assert.ok(context1.executionId.startsWith('exec-'));
      assert.ok(context1.executionId.includes('2026'));
    });
  });

  describe('generateSessionPrompt', () => {
    it('should generate complete session prompt', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');
      const agents = configLoader.loadAllAgents();
      
      const step = plan.steps[0];
      assert.ok(step);
      
      const agent = agents.find(a => a.name === 'worker');
      assert.ok(agent);

      const prompt = runner.generateSessionPrompt(step, agent, context);

      assert.ok(prompt.includes('Step 1'));
      assert.ok(prompt.includes('worker'));
      assert.ok(prompt.includes(plan.goal));
      assert.ok(prompt.includes(step.task));
      assert.ok(prompt.includes('Scope'));
      assert.ok(prompt.includes('Boundaries'));
      assert.ok(prompt.includes('Done definition'));
      assert.ok(prompt.includes('Refusal rules'));
      assert.ok(prompt.includes('/share'));
    });

    it('should include dependencies for dependent steps', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');
      
      // Add some prior context
      context.priorContext.push('Step 1: API created');
      
      const agents = configLoader.loadAllAgents();
      const step = plan.steps[1];
      assert.ok(step);
      
      const agent = agents.find(a => a.name === 'worker');
      assert.ok(agent);

      const prompt = runner.generateSessionPrompt(step, agent, context);

      assert.ok(prompt.includes('Dependencies'));
      assert.ok(prompt.includes('Steps 1'));
      assert.ok(prompt.includes('Step 1: API created'));
    });

    it('should include expected outputs', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');
      const agents = configLoader.loadAllAgents();
      
      const step = plan.steps[0];
      assert.ok(step);
      
      const agent = agents.find(a => a.name === 'worker');
      assert.ok(agent);

      const prompt = runner.generateSessionPrompt(step, agent, context);

      assert.ok(prompt.includes('API code'));
      assert.ok(prompt.includes('Tests'));
    });
  });

  describe('completeStep', () => {
    it('should mark step as completed', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      runner.completeStep(context, 1, 'proof/step-1.md', ['API created', 'Tests passed']);

      const result = context.stepResults.find(r => r.stepNumber === 1);
      assert.ok(result);
      assert.strictEqual(result.status, 'completed');
      assert.ok(result.endTime);
      assert.strictEqual(result.transcriptPath, 'proof/step-1.md');
      assert.deepStrictEqual(result.outputs, ['API created', 'Tests passed']);
    });

    it('should update prior context', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      runner.completeStep(context, 1, 'proof/step-1.md', ['API created']);

      assert.strictEqual(context.priorContext.length, 1);
      assert.ok(context.priorContext[0]?.includes('Step 1'));
      assert.ok(context.priorContext[0]?.includes('API created'));
    });

    it('should update current step', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      assert.strictEqual(context.currentStep, 0);

      runner.completeStep(context, 1, 'proof/step-1.md', []);

      assert.strictEqual(context.currentStep, 1);
    });

    it('should throw error for invalid step number', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      assert.throws(() => {
        runner.completeStep(context, 99, 'proof/step-99.md', []);
      }, /Step 99 not found/);
    });
  });

  describe('failStep', () => {
    it('should mark step as failed', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      runner.failStep(context, 1, ['Tests failed', 'API errors']);

      const result = context.stepResults.find(r => r.stepNumber === 1);
      assert.ok(result);
      assert.strictEqual(result.status, 'failed');
      assert.ok(result.endTime);
      assert.deepStrictEqual(result.errors, ['Tests failed', 'API errors']);
    });

    it('should update current step', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      runner.failStep(context, 1, ['Error']);

      assert.strictEqual(context.currentStep, 1);
    });
  });

  describe('saveExecutionContext', () => {
    it('should save context to file', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      const filepath = runner.saveExecutionContext(context);

      assert.ok(fs.existsSync(filepath));
      assert.ok(filepath.includes(testProofDir));
    });

    it('should save valid JSON', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      const filepath = runner.saveExecutionContext(context);
      const content = fs.readFileSync(filepath, 'utf8');

      assert.doesNotThrow(() => {
        JSON.parse(content);
      });
    });

    it('should create proof directory if it does not exist', () => {
      assert.ok(!fs.existsSync(testProofDir));

      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');

      runner.saveExecutionContext(context);

      assert.ok(fs.existsSync(testProofDir));
    });
  });

  describe('loadExecutionContext', () => {
    it('should load saved context', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');
      
      runner.saveExecutionContext(context);
      
      const loaded = runner.loadExecutionContext(context.executionId);

      assert.strictEqual(loaded.plan.goal, context.plan.goal);
      assert.strictEqual(loaded.executionId, context.executionId);
      assert.strictEqual(loaded.stepResults.length, context.stepResults.length);
    });

    it('should throw error if context not found', () => {
      assert.throws(() => {
        runner.loadExecutionContext('nonexistent-id');
      }, /Execution context not found/);
    });
  });

  describe('generateSummary', () => {
    it('should generate execution summary', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');
      
      runner.completeStep(context, 1, 'proof/step-1.md', ['API created']);

      const summary = runner.generateSummary(context);

      assert.ok(summary.includes('EXECUTION SUMMARY'));
      assert.ok(summary.includes(plan.goal));
      assert.ok(summary.includes(context.executionId));
      assert.ok(summary.includes('Step 1'));
      assert.ok(summary.includes('completed'));
      assert.ok(summary.includes('API created'));
    });

    it('should show all step statuses', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');
      
      runner.completeStep(context, 1, 'proof/step-1.md', ['Done']);
      runner.failStep(context, 2, ['Error']);

      const summary = runner.generateSummary(context);

      assert.ok(summary.includes('completed'));
      assert.ok(summary.includes('failed'));
    });

    it('should show step icons', () => {
      const plan = createTestPlan();
      const context = runner.initializeExecution(plan, 'test-plan.json');
      
      runner.completeStep(context, 1, 'proof/step-1.md', []);

      const summary = runner.generateSummary(context);

      assert.ok(summary.includes('✓'));  // Completed icon
      assert.ok(summary.includes('○'));  // Pending icon
    });
  });
});
