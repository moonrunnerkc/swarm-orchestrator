import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExecutionPlan } from '../src/plan-generator';
import { PlanStorage } from '../src/plan-storage';

describe('PlanStorage', () => {
  const testPlanDir = path.join(__dirname, '..', '..', 'test-plans');
  let storage: PlanStorage;

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testPlanDir)) {
      fs.rmSync(testPlanDir, { recursive: true });
    }
    storage = new PlanStorage(testPlanDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testPlanDir)) {
      fs.rmSync(testPlanDir, { recursive: true });
    }
  });

  describe('ensurePlanDirectory', () => {
    it('should create plan directory if it does not exist', () => {
      assert.ok(!fs.existsSync(testPlanDir));

      storage.ensurePlanDirectory();

      assert.ok(fs.existsSync(testPlanDir));
    });

    it('should not fail if directory already exists', () => {
      fs.mkdirSync(testPlanDir, { recursive: true });

      assert.doesNotThrow(() => {
        storage.ensurePlanDirectory();
      });
    });
  });

  describe('savePlan', () => {
    it('should save plan to file', () => {
      const plan: ExecutionPlan = {
        goal: 'Test goal',
        createdAt: new Date().toISOString(),
        steps: [
          {
            stepNumber: 1,
            agentName: 'worker',
            task: 'Do something',
            dependencies: [],
            expectedOutputs: ['Output']
          }
        ],
        metadata: { totalSteps: 1 }
      };

      const planPath = storage.savePlan(plan);

      assert.ok(fs.existsSync(planPath));
      assert.ok(planPath.includes(testPlanDir));
    });

    it('should save plan with custom filename', () => {
      const plan: ExecutionPlan = {
        goal: 'Test',
        createdAt: new Date().toISOString(),
        steps: [],
        metadata: { totalSteps: 0 }
      };

      const planPath = storage.savePlan(plan, 'custom-plan.json');

      assert.ok(planPath.endsWith('custom-plan.json'));
      assert.ok(fs.existsSync(planPath));
    });

    it('should generate filename from goal', () => {
      const plan: ExecutionPlan = {
        goal: 'Build REST API',
        createdAt: new Date().toISOString(),
        steps: [],
        metadata: { totalSteps: 0 }
      };

      const planPath = storage.savePlan(plan);
      const filename = path.basename(planPath);

      assert.ok(filename.includes('build-rest-api'));
      assert.ok(filename.endsWith('.json'));
    });

    it('should save valid JSON', () => {
      const plan: ExecutionPlan = {
        goal: 'Test',
        createdAt: new Date().toISOString(),
        steps: [],
        metadata: { totalSteps: 0 }
      };

      const planPath = storage.savePlan(plan);
      const content = fs.readFileSync(planPath, 'utf8');

      assert.doesNotThrow(() => {
        JSON.parse(content);
      });
    });
  });

  describe('loadPlan', () => {
    it('should load saved plan', () => {
      const originalPlan: ExecutionPlan = {
        goal: 'Test goal',
        createdAt: '2026-01-23T00:00:00.000Z',
        steps: [
          {
            stepNumber: 1,
            agentName: 'worker',
            task: 'Task',
            dependencies: [],
            expectedOutputs: ['Output']
          }
        ],
        metadata: { totalSteps: 1 }
      };

      const planPath = storage.savePlan(originalPlan, 'test.json');
      const loadedPlan = storage.loadPlan('test.json');

      assert.strictEqual(loadedPlan.goal, originalPlan.goal);
      assert.strictEqual(loadedPlan.steps.length, 1);
      assert.strictEqual(loadedPlan.steps[0]?.agentName, 'worker');
    });

    it('should throw error if plan file does not exist', () => {
      assert.throws(() => {
        storage.loadPlan('nonexistent.json');
      }, /Plan file not found/);
    });

    it('should load plan when given a relative path', () => {
      const originalCwd = process.cwd();
      const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-path-'));

      try {
        process.chdir(tmpWorkspace);

        const localPlansDir = path.join(tmpWorkspace, 'plans');
        const localStorage = new PlanStorage(localPlansDir);

        const originalPlan: ExecutionPlan = {
          goal: 'Path plan',
          createdAt: new Date().toISOString(),
          steps: [],
          metadata: { totalSteps: 0 }
        };

        const planPath = localStorage.savePlan(originalPlan, 'p.json');
        assert.ok(fs.existsSync(planPath));

        const loaded = localStorage.loadPlan('plans/p.json');
        assert.strictEqual(loaded.goal, 'Path plan');
      } finally {
        process.chdir(originalCwd);
        try {
          fs.rmSync(tmpWorkspace, { recursive: true, force: true });
        } catch {
          // best effort
        }
      }
    });
  });

  describe('listPlans', () => {
    it('should return empty array if no plans exist', () => {
      const plans = storage.listPlans();
      assert.deepStrictEqual(plans, []);
    });

    it('should list all plan files', () => {
      const plan: ExecutionPlan = {
        goal: 'Test',
        createdAt: new Date().toISOString(),
        steps: [],
        metadata: { totalSteps: 0 }
      };

      storage.savePlan(plan, 'plan1.json');
      storage.savePlan(plan, 'plan2.json');

      const plans = storage.listPlans();

      assert.strictEqual(plans.length, 2);
      assert.ok(plans.includes('plan1.json'));
      assert.ok(plans.includes('plan2.json'));
    });

    it('should only list JSON files', () => {
      const plan: ExecutionPlan = {
        goal: 'Test',
        createdAt: new Date().toISOString(),
        steps: [],
        metadata: { totalSteps: 0 }
      };

      storage.savePlan(plan, 'plan.json');

      // Create non-JSON file
      storage.ensurePlanDirectory();
      fs.writeFileSync(path.join(testPlanDir, 'readme.txt'), 'test');

      const plans = storage.listPlans();

      assert.strictEqual(plans.length, 1);
      assert.strictEqual(plans[0], 'plan.json');
    });
  });

  describe('deletePlan', () => {
    it('should delete plan file', () => {
      const plan: ExecutionPlan = {
        goal: 'Test',
        createdAt: new Date().toISOString(),
        steps: [],
        metadata: { totalSteps: 0 }
      };

      storage.savePlan(plan, 'test.json');
      const planPath = path.join(testPlanDir, 'test.json');

      assert.ok(fs.existsSync(planPath));

      storage.deletePlan('test.json');

      assert.ok(!fs.existsSync(planPath));
    });

    it('should throw error if plan does not exist', () => {
      assert.throws(() => {
        storage.deletePlan('nonexistent.json');
      }, /Plan file not found/);
    });
  });

  describe('getLatestPlan', () => {
    it('should return null if no plans exist', () => {
      const latest = storage.getLatestPlan();
      assert.strictEqual(latest, null);
    });

    it('should return most recent plan', () => {
      const plan1: ExecutionPlan = {
        goal: 'Plan 1',
        createdAt: new Date().toISOString(),
        steps: [],
        metadata: { totalSteps: 0 }
      };

      const plan2: ExecutionPlan = {
        goal: 'Plan 2',
        createdAt: new Date().toISOString(),
        steps: [],
        metadata: { totalSteps: 0 }
      };

      storage.savePlan(plan1, 'plan-2026-01-22.json');
      storage.savePlan(plan2, 'plan-2026-01-23.json');

      const latest = storage.getLatestPlan();

      // Should return plan2 as it sorts later alphabetically
      assert.ok(latest);
      assert.strictEqual(latest?.goal, 'Plan 2');
    });
  });
});
