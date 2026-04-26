import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FleetExecutor, FleetSubtask } from '../src/fleet-executor';
import { AgentProfile } from '../src/config-loader';
import { PlanStep } from '../src/plan-generator';

function makeAgent(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    name: 'worker',
    purpose: 'Implement code changes',
    scope: ['Backend code', 'API endpoints'],
    boundaries: ['Do not modify frontend'],
    done_definition: ['All endpoints work'],
    refusal_rules: ['Do not invent features'],
    output_contract: { transcript: 'proof/step-{N}.md', artifacts: [] },
    ...overrides
  };
}

function makeStep(overrides?: Partial<PlanStep>): PlanStep {
  return {
    stepNumber: 1,
    task: 'Build REST API',
    agentName: 'worker',
    dependencies: [],
    expectedOutputs: ['src/api.ts'],
    ...overrides
  };
}

describe('FleetExecutor', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-exec-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('buildSubtasks', () => {
    it('should map plan steps and agents to subtask descriptors', () => {
      const executor = new FleetExecutor(tempDir);
      const agents = new Map<string, AgentProfile>();
      agents.set('worker', makeAgent());
      agents.set('reviewer', makeAgent({ name: 'reviewer', scope: ['Reviews'] }));

      const steps = [
        makeStep({ stepNumber: 1, agentName: 'worker' }),
        makeStep({ stepNumber: 2, agentName: 'reviewer', task: 'Review tests' })
      ];

      const subtasks = executor.buildSubtasks(steps, agents);
      assert.strictEqual(subtasks.length, 2);
      assert.strictEqual(subtasks[0].stepNumber, 1);
      assert.strictEqual(subtasks[0].agentName, 'worker');
      assert.strictEqual(subtasks[1].stepNumber, 2);
      assert.strictEqual(subtasks[1].agentName, 'reviewer');
      assert.deepStrictEqual(subtasks[1].scope, ['Reviews']);
    });

    it('should handle missing agent gracefully with empty scope', () => {
      const executor = new FleetExecutor(tempDir);
      const agents = new Map<string, AgentProfile>();
      const steps = [makeStep({ agentName: 'MissingAgent' })];

      const subtasks = executor.buildSubtasks(steps, agents);
      assert.strictEqual(subtasks.length, 1);
      assert.deepStrictEqual(subtasks[0].scope, []);
      assert.deepStrictEqual(subtasks[0].boundaries, []);
    });
  });

  describe('buildFleetPrompt', () => {
    it('should contain all subtask details', () => {
      const executor = new FleetExecutor(tempDir);
      const subtasks: FleetSubtask[] = [
        {
          stepNumber: 1,
          agentName: 'worker',
          task: 'Build REST API for users',
          scope: ['Backend code'],
          boundaries: ['Do not modify frontend'],
          expectedOutputs: ['src/api/users.ts']
        },
        {
          stepNumber: 2,
          agentName: 'reviewer',
          task: 'Write unit tests',
          scope: ['Tests'],
          boundaries: [],
          expectedOutputs: ['test/users.test.ts']
        }
      ];

      const prompt = executor.buildFleetPrompt(subtasks, 'exec-123');

      assert.ok(prompt.includes('FLEET DISPATCH'));
      assert.ok(prompt.includes('exec-123'));
      assert.ok(prompt.includes('Total subtasks: 2'));
      assert.ok(prompt.includes('Subtask 1 (worker)'));
      assert.ok(prompt.includes('Build REST API for users'));
      assert.ok(prompt.includes('Subtask 2 (reviewer)'));
      assert.ok(prompt.includes('Write unit tests'));
      assert.ok(prompt.includes('Do not modify frontend'));
      assert.ok(prompt.includes('src/api/users.ts'));
    });

    it('should handle subtasks with empty scope and boundaries', () => {
      const executor = new FleetExecutor(tempDir);
      const prompt = executor.buildFleetPrompt([{
        stepNumber: 1,
        agentName: 'Agent',
        task: 'Do something',
        scope: [],
        boundaries: [],
        expectedOutputs: []
      }], 'exec-456');

      assert.ok(prompt.includes('Subtask 1 (Agent)'));
      assert.ok(!prompt.includes('Scope:'));
      assert.ok(!prompt.includes('Boundaries:'));
    });
  });

  describe('parseSubtaskResults', () => {
    it('should detect completed subtasks from output', () => {
      const executor = new FleetExecutor(tempDir);
      const output = 'Working on subtask 1... Subtask 1 complete. Starting subtask 2... Subtask 2 done.';
      const subtasks: FleetSubtask[] = [
        { stepNumber: 1, agentName: 'A', task: 't1', scope: [], boundaries: [], expectedOutputs: [] },
        { stepNumber: 2, agentName: 'B', task: 't2', scope: [], boundaries: [], expectedOutputs: [] }
      ];

      const results = executor.parseSubtaskResults(output, subtasks);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].completed, true);
      assert.strictEqual(results[1].completed, true);
    });

    it('should mark incomplete subtasks when no completion signal found', () => {
      const executor = new FleetExecutor(tempDir);
      const output = 'Working on subtask 1... ran into an error.';
      const subtasks: FleetSubtask[] = [
        { stepNumber: 1, agentName: 'A', task: 't1', scope: [], boundaries: [], expectedOutputs: [] },
        { stepNumber: 2, agentName: 'B', task: 't2', scope: [], boundaries: [], expectedOutputs: [] }
      ];

      const results = executor.parseSubtaskResults(output, subtasks);
      assert.strictEqual(results[0].completed, false);
      assert.strictEqual(results[1].completed, false);
    });

    it('should detect alternative completion phrases', () => {
      const executor = new FleetExecutor(tempDir);
      const output = 'Finished step 3 successfully. Completed subtask 4.';
      const subtasks: FleetSubtask[] = [
        { stepNumber: 3, agentName: 'A', task: 't3', scope: [], boundaries: [], expectedOutputs: [] },
        { stepNumber: 4, agentName: 'B', task: 't4', scope: [], boundaries: [], expectedOutputs: [] }
      ];

      const results = executor.parseSubtaskResults(output, subtasks);
      assert.strictEqual(results[0].completed, true);
      assert.strictEqual(results[1].completed, true);
    });

    it('should extract output fragments around step references', () => {
      const executor = new FleetExecutor(tempDir);
      const output = 'prefix text... Subtask 1 created file src/api.ts and ran tests... suffix text';
      const subtasks: FleetSubtask[] = [
        { stepNumber: 1, agentName: 'A', task: 't1', scope: [], boundaries: [], expectedOutputs: [] }
      ];

      const results = executor.parseSubtaskResults(output, subtasks);
      assert.ok(results[0].outputFragment.length > 0);
      assert.ok(results[0].outputFragment.includes('Subtask 1'));
    });

    it('should return empty fragment when no references found', () => {
      const executor = new FleetExecutor(tempDir);
      const output = 'No references to any specific subtask here.';
      const subtasks: FleetSubtask[] = [
        { stepNumber: 99, agentName: 'A', task: 't99', scope: [], boundaries: [], expectedOutputs: [] }
      ];

      const results = executor.parseSubtaskResults(output, subtasks);
      assert.strictEqual(results[0].outputFragment, '');
    });
  });

  describe('estimateCostMultiplier', () => {
    it('should return 0.6 for 3+ steps', () => {
      assert.strictEqual(FleetExecutor.estimateCostMultiplier(3), 0.6);
      assert.strictEqual(FleetExecutor.estimateCostMultiplier(8), 0.6);
    });

    it('should return 0.8 for 2 steps', () => {
      assert.strictEqual(FleetExecutor.estimateCostMultiplier(2), 0.8);
    });

    it('should return 1.0 for single step', () => {
      assert.strictEqual(FleetExecutor.estimateCostMultiplier(1), 1.0);
    });
  });
});
