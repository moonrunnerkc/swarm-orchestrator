// Author: Bradley R. Kinnard
import { strict as assert } from 'assert';
import { PlanStep } from '../src/plan-generator';

describe('Upgrade 1: Multi-Repo Orchestration', () => {

  describe('PlanStep repo field', () => {
    it('should accept optional repo field', () => {
      const step: PlanStep = {
        stepNumber: 1,
        agentName: 'worker',
        task: 'Build API',
        dependencies: [],
        expectedOutputs: ['api/'],
        repo: 'https://github.com/org/backend.git'
      };
      assert.strictEqual(step.repo, 'https://github.com/org/backend.git');
    });

    it('should work without repo field (defaults to undefined)', () => {
      const step: PlanStep = {
        stepNumber: 1,
        agentName: 'worker',
        task: 'Build UI',
        dependencies: [],
        expectedOutputs: ['src/']
      };
      assert.strictEqual(step.repo, undefined);
    });
  });

  describe('repo grouping', () => {
    it('should group steps by repo into separate groups', () => {
      const steps: PlanStep[] = [
        { stepNumber: 1, agentName: 'A', task: 't1', dependencies: [], expectedOutputs: [], repo: '/repo/a' },
        { stepNumber: 2, agentName: 'B', task: 't2', dependencies: [], expectedOutputs: [], repo: '/repo/b' },
        { stepNumber: 3, agentName: 'C', task: 't3', dependencies: [], expectedOutputs: [], repo: '/repo/a' },
        { stepNumber: 4, agentName: 'D', task: 't4', dependencies: [], expectedOutputs: [], repo: '/repo/c' },
        { stepNumber: 5, agentName: 'E', task: 't5', dependencies: [], expectedOutputs: [], repo: '/repo/b' },
      ];

      // replicate the groupBy logic from swarm-orchestrator
      const repoGroups = new Map<string, PlanStep[]>();
      for (const step of steps) {
        const repo = step.repo ?? process.cwd();
        if (!repoGroups.has(repo)) repoGroups.set(repo, []);
        repoGroups.get(repo)!.push(step);
      }

      assert.strictEqual(repoGroups.size, 3, 'should produce 3 repo groups');
      assert.strictEqual(repoGroups.get('/repo/a')!.length, 2);
      assert.strictEqual(repoGroups.get('/repo/b')!.length, 2);
      assert.strictEqual(repoGroups.get('/repo/c')!.length, 1);
    });

    it('should group steps without repo field into cwd group', () => {
      const steps: PlanStep[] = [
        { stepNumber: 1, agentName: 'A', task: 't1', dependencies: [], expectedOutputs: [] },
        { stepNumber: 2, agentName: 'B', task: 't2', dependencies: [], expectedOutputs: [] },
        { stepNumber: 3, agentName: 'C', task: 't3', dependencies: [], expectedOutputs: [], repo: '/other' },
      ];

      const repoGroups = new Map<string, PlanStep[]>();
      for (const step of steps) {
        const repo = step.repo ?? process.cwd();
        if (!repoGroups.has(repo)) repoGroups.set(repo, []);
        repoGroups.get(repo)!.push(step);
      }

      // Steps without repo all land in cwd group
      const cwdGroup = repoGroups.get(process.cwd());
      assert.ok(cwdGroup, 'cwd group should exist');
      assert.strictEqual(cwdGroup.length, 2, 'cwd group should have 2 steps');

      const otherGroup = repoGroups.get('/other');
      assert.ok(otherGroup, 'other group should exist');
      assert.strictEqual(otherGroup.length, 1);
    });
  });

  describe('dashboard repo rows', () => {
    it('should produce repo group data for rendering', () => {
      const steps: PlanStep[] = [
        { stepNumber: 1, agentName: 'A', task: 't1', dependencies: [], expectedOutputs: [], repo: '/frontend' },
        { stepNumber: 2, agentName: 'B', task: 't2', dependencies: [], expectedOutputs: [], repo: '/backend' },
        { stepNumber: 3, agentName: 'C', task: 't3', dependencies: [], expectedOutputs: [], repo: '/frontend' },
      ];

      const completedStepNumbers = new Set([1, 2]);

      // build repo groups for dashboard display
      const repoMap = new Map<string, { total: number; completed: number }>();
      for (const step of steps) {
        const repo = step.repo ?? process.cwd();
        if (!repoMap.has(repo)) repoMap.set(repo, { total: 0, completed: 0 });
        const entry = repoMap.get(repo)!;
        entry.total++;
        if (completedStepNumbers.has(step.stepNumber)) entry.completed++;
      }

      const repoGroups = Array.from(repoMap.entries()).map(([repo, data]) => ({
        repo,
        stepCount: data.total,
        completed: data.completed
      }));

      assert.strictEqual(repoGroups.length, 2);

      const frontend = repoGroups.find(r => r.repo === '/frontend');
      assert.ok(frontend);
      assert.strictEqual(frontend.stepCount, 2);
      assert.strictEqual(frontend.completed, 1);

      const backend = repoGroups.find(r => r.repo === '/backend');
      assert.ok(backend);
      assert.strictEqual(backend.stepCount, 1);
      assert.strictEqual(backend.completed, 1);
    });
  });
});
