import * as assert from 'assert';
import { ConfigLoader } from '../src/config-loader';
import { PlanGenerator } from '../src/plan-generator';

describe('Copilot-Driven Planning', () => {
  let generator: PlanGenerator;

  beforeEach(() => {
    const configLoader = new ConfigLoader();
    const agents = configLoader.loadAllAgents();
    generator = new PlanGenerator(agents);
  });

  describe('generateCopilotPlanningPrompt', () => {
    it('should generate valid prompt with schema and agents', () => {
      const prompt = generator.generateCopilotPlanningPrompt('Build a REST API');

      assert.ok(prompt.includes('Build a REST API'));
      assert.ok(prompt.includes('OUTPUT ONLY THE JSON'));
      assert.ok(prompt.includes('stepNumber'));
      assert.ok(prompt.includes('worker'));
      assert.ok(prompt.includes('reviewer'));
    });
  });

  describe('parseCopilotPlanFromTranscript', () => {
    it('should parse valid JSON from transcript', () => {
      const now = new Date().toISOString();
      const jsonPlan = JSON.stringify({
        goal: 'Build a REST API',
        createdAt: now,
        steps: [
          {
            stepNumber: 1,
            agentName: 'worker',
            task: 'Create API endpoints',
            dependencies: [],
            expectedOutputs: ['src/api/routes.ts']
          }
        ],
        metadata: { estimatedDuration: '10 min' }
      }, null, 2);

      const transcript = 'Here is the plan:\n\n```json\n' + jsonPlan + '\n```\n';

      const plan = generator.parseCopilotPlanFromTranscript(transcript);

      assert.ok(plan !== null);
      assert.strictEqual(plan!.goal, 'Build a REST API');
      assert.strictEqual(plan!.steps.length, 1);
      assert.strictEqual(plan!.steps[0].agentName, 'worker');
    });

    it('should reject transcript without valid JSON', () => {
      const transcript = 'No JSON here, just text about building an API.';
      assert.throws(() => {
        generator.parseCopilotPlanFromTranscript(transcript);
      }, /No valid JSON/);
    });

    it('should validate required schema fields', () => {
      const transcript = '```json\n{"steps": [{"stepNumber": 1}]}\n```';
      assert.throws(() => {
        generator.parseCopilotPlanFromTranscript(transcript);
      }, /goal/);
    });
  });

  describe('intelligent plan generation', () => {
    it('should generate valid plan for API goal', () => {
      const plan = generator.createPlan('Build a REST API with auth');

      assert.ok(plan.goal.includes('REST API'));
      assert.ok(plan.steps.length >= 2);
      assert.ok(plan.steps.every((s: any) => s.agentName && s.task && s.expectedOutputs.length > 0));

      // DAG validation - dependencies reference valid steps
      const stepNumbers = new Set(plan.steps.map((s: any) => s.stepNumber));
      plan.steps.forEach((step: any) => {
        step.dependencies.forEach((dep: number) => {
          assert.ok(stepNumbers.has(dep), 'Invalid dependency ' + dep + ' in step ' + step.stepNumber);
          assert.ok(dep < step.stepNumber, 'Dependency must be before step');
        });
      });
    });

    it('should use worker and reviewer roles for different domains', () => {
      const apiPlan = generator.createPlan('Build REST API');
      const uiPlan = generator.createPlan('Create React dashboard');

      assert.ok(apiPlan.steps.some((s: any) => s.agentName === 'worker'));
      assert.ok(uiPlan.steps.some((s: any) => s.agentName === 'worker'));
      assert.ok(apiPlan.steps.some((s: any) => s.agentName === 'reviewer'));
      assert.ok(uiPlan.steps.some((s: any) => s.agentName === 'reviewer'));
    });
  });
});
