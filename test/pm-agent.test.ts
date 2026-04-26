import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PMAgent, PMReviewResult } from '../src/pm-agent';
import { AgentProfile } from '../src/config-loader';
import { ExecutionPlan, PlanStep } from '../src/plan-generator';

describe('PMAgent', () => {
  const testAgents: AgentProfile[] = [
    { name: 'worker', purpose: 'Implementation work', scope: [], boundaries: [], done_definition: [], output_contract: { transcript: '', artifacts: [] }, refusal_rules: [] },
    { name: 'reviewer', purpose: 'Review work', scope: [], boundaries: [], done_definition: [], output_contract: { transcript: '', artifacts: [] }, refusal_rules: [] }
  ];

  function makePlan(steps: Partial<PlanStep>[]): ExecutionPlan {
    return {
      goal: 'Test goal',
      createdAt: new Date().toISOString(),
      steps: steps.map((s, i) => ({
        stepNumber: s.stepNumber ?? (i + 1),
        agentName: s.agentName ?? 'worker',
        task: s.task ?? `Task ${i + 1}`,
        dependencies: s.dependencies ?? [],
        expectedOutputs: s.expectedOutputs ?? []
      })),
      metadata: { totalSteps: steps.length }
    };
  }

  describe('reviewPlan', () => {
    it('should approve a valid plan with no issues', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', task: 'Build API', dependencies: [] },
        { stepNumber: 2, agentName: 'worker', task: 'Build UI', dependencies: [1] },
        { stepNumber: 3, agentName: 'reviewer', task: 'Integrate', dependencies: [1, 2] }
      ]);

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.strictEqual(result.reviewNotes.length, 0, 'Should have no review notes');
      assert.strictEqual(result.skipped, false);
      assert.strictEqual(result.revisedPlan.steps.length, 3);
    });

    it('should detect duplicate step numbers', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', dependencies: [] },
        { stepNumber: 1, agentName: 'reviewer', dependencies: [] }
      ]);

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.ok(result.reviewNotes.some(n => n.includes('Duplicate step number')));
    });

    it('should detect references to unknown agents', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'UnknownAgent', dependencies: [] }
      ]);

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.ok(result.reviewNotes.some(n => n.includes('unknown agent')));
    });

    it('should detect circular dependencies', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', dependencies: [2] },
        { stepNumber: 2, agentName: 'reviewer', dependencies: [1] }
      ]);

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.ok(result.reviewNotes.some(n => n.includes('Circular dependencies')));
    });

    it('should detect dependencies on non-existent steps', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', dependencies: [99] }
      ]);

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.ok(result.reviewNotes.some(n => n.includes('non-existent step 99')));
    });

    it('should note missing integration step when reviewer is available', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', dependencies: [] },
        { stepNumber: 2, agentName: 'worker', dependencies: [1] }
      ]);

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.ok(result.reviewNotes.some(n => n.includes('missing a final integration')));
    });

    it('should not flag missing integration step if last step is reviewer', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', dependencies: [] },
        { stepNumber: 2, agentName: 'reviewer', dependencies: [1] }
      ]);

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.ok(!result.reviewNotes.some(n => n.includes('missing a final integration')));
    });

    it('should update metadata.totalSteps if incorrect', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', dependencies: [] }
      ]);
      plan.metadata = { totalSteps: 999 };

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.ok(result.changesApplied.some(c => c.includes('metadata.totalSteps')));
      assert.strictEqual(result.revisedPlan.metadata?.totalSteps, 1);
    });

    it('should not mutate the original plan', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', dependencies: [] }
      ]);
      plan.metadata = { totalSteps: 999 };

      const pm = new PMAgent(testAgents);
      pm.reviewPlan(plan);

      assert.strictEqual(plan.metadata.totalSteps, 999, 'Original plan should be unchanged');
    });

    it('should report duration in result', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', dependencies: [] }
      ]);

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.ok(typeof result.durationMs === 'number');
      assert.ok(result.durationMs >= 0);
    });

    it('should report estimated token cost', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', dependencies: [] }
      ]);

      const pm = new PMAgent(testAgents);
      const result = pm.reviewPlan(plan);

      assert.ok(typeof result.estimatedTokenCost === 'number');
      assert.ok(result.estimatedTokenCost > 0);
    });
  });

  describe('detectCircularDeps', () => {
    it('should return empty array for acyclic graph', () => {
      const pm = new PMAgent(testAgents);
      const steps: PlanStep[] = [
        { stepNumber: 1, agentName: 'A', task: '', dependencies: [], expectedOutputs: [] },
        { stepNumber: 2, agentName: 'B', task: '', dependencies: [1], expectedOutputs: [] },
        { stepNumber: 3, agentName: 'C', task: '', dependencies: [1, 2], expectedOutputs: [] }
      ];

      const result = pm.detectCircularDeps(steps);
      assert.strictEqual(result.length, 0);
    });

    it('should detect a simple 2-node cycle', () => {
      const pm = new PMAgent(testAgents);
      const steps: PlanStep[] = [
        { stepNumber: 1, agentName: 'A', task: '', dependencies: [2], expectedOutputs: [] },
        { stepNumber: 2, agentName: 'B', task: '', dependencies: [1], expectedOutputs: [] }
      ];

      const result = pm.detectCircularDeps(steps);
      assert.ok(result.length > 0);
    });

    it('should detect a 3-node cycle', () => {
      const pm = new PMAgent(testAgents);
      const steps: PlanStep[] = [
        { stepNumber: 1, agentName: 'A', task: '', dependencies: [3], expectedOutputs: [] },
        { stepNumber: 2, agentName: 'B', task: '', dependencies: [1], expectedOutputs: [] },
        { stepNumber: 3, agentName: 'C', task: '', dependencies: [2], expectedOutputs: [] }
      ];

      const result = pm.detectCircularDeps(steps);
      assert.ok(result.length > 0);
    });
  });

  describe('buildReviewPrompt', () => {
    it('should include plan JSON in the prompt', () => {
      const plan = makePlan([
        { stepNumber: 1, agentName: 'worker', task: 'Build API', dependencies: [] }
      ]);

      const pm = new PMAgent(testAgents);
      const prompt = pm.buildReviewPrompt(plan);

      assert.ok(prompt.includes('Build API'));
      assert.ok(prompt.includes('"stepNumber"'));
    });

    it('should list available agents', () => {
      const plan = makePlan([]);
      const pm = new PMAgent(testAgents);
      const prompt = pm.buildReviewPrompt(plan);

      assert.ok(prompt.includes('worker'));
      assert.ok(prompt.includes('reviewer'));
    });

    it('should include PM AGENT header', () => {
      const plan = makePlan([]);
      const pm = new PMAgent(testAgents);
      const prompt = pm.buildReviewPrompt(plan);

      assert.ok(prompt.includes('PM AGENT'));
    });
  });

  describe('pm-agent.yaml config', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const root = fs.existsSync(path.join(projectRoot, 'config')) ? projectRoot : path.resolve(projectRoot, '..');

    it('should exist and be valid YAML', () => {
      const configPath = path.join(root, 'config', 'pm-agent.yaml');
      assert.ok(fs.existsSync(configPath), 'config/pm-agent.yaml must exist');

      const yaml = require('js-yaml');
      const content = fs.readFileSync(configPath, 'utf8');
      const parsed = yaml.load(content);

      assert.ok(parsed.agent, 'YAML must have an agent section');
      assert.strictEqual(parsed.agent.name, 'PMAgent');
      assert.ok(parsed.agent.purpose.length > 0);
      assert.ok(Array.isArray(parsed.agent.scope));
      assert.ok(Array.isArray(parsed.agent.boundaries));
      assert.ok(Array.isArray(parsed.agent.done_definition));
      assert.ok(Array.isArray(parsed.agent.refusal_rules));
    });
  });
});
