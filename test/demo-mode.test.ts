import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DemoMode, DemoScenario } from '../src/demo-mode';

describe('DemoMode', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-mode-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getAvailableScenarios', () => {
    it('returns a non-empty array of scenarios', () => {
      const demo = new DemoMode();
      const scenarios = demo.getAvailableScenarios();
      assert.ok(scenarios.length > 0, 'Expected at least one scenario');
    });

    it('each scenario has required fields', () => {
      const demo = new DemoMode();
      const scenarios = demo.getAvailableScenarios();
      for (const s of scenarios) {
        assert.ok(s.name, 'scenario.name missing');
        assert.ok(s.description, 'scenario.description missing');
        assert.ok(s.goal, 'scenario.goal missing');
        assert.ok(Array.isArray(s.steps), 'scenario.steps should be an array');
        assert.ok(s.steps.length > 0, `scenario "${s.name}" has no steps`);
        assert.ok(s.expectedDuration, 'scenario.expectedDuration missing');
      }
    });

    it('includes the demo-fast scenario', () => {
      const demo = new DemoMode();
      const names = demo.getAvailableScenarios().map(s => s.name);
      assert.ok(names.includes('demo-fast'), 'Missing demo-fast scenario');
    });

    it('includes the api-quick scenario', () => {
      const demo = new DemoMode();
      const names = demo.getAvailableScenarios().map(s => s.name);
      assert.ok(names.includes('api-quick'), 'Missing api-quick scenario');
    });

    it('returns exactly two scenarios', () => {
      const demo = new DemoMode();
      const scenarios = demo.getAvailableScenarios();
      assert.strictEqual(scenarios.length, 2);
    });
  });

  describe('getScenario', () => {
    it('returns a known scenario by name', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('demo-fast');
      assert.ok(scenario);
      assert.strictEqual(scenario!.name, 'demo-fast');
    });

    it('returns undefined for unknown scenario', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('nonexistent-scenario-xyz');
      assert.strictEqual(scenario, undefined);
    });

    it('returns each listed scenario when queried by name', () => {
      const demo = new DemoMode();
      const all = demo.getAvailableScenarios();
      for (const s of all) {
        const found = demo.getScenario(s.name);
        assert.ok(found, `getScenario("${s.name}") returned undefined`);
        assert.strictEqual(found!.name, s.name);
      }
    });
  });

  describe('scenarioToPlan', () => {
    it('converts a scenario into a valid ExecutionPlan', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('demo-fast')!;
      const plan = demo.scenarioToPlan(scenario);

      assert.strictEqual(plan.goal, scenario.goal);
      assert.strictEqual(plan.steps.length, scenario.steps.length);
      assert.ok(plan.createdAt, 'plan should have createdAt');
    });

    it('preserves step dependencies from scenario', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('api-quick')!;
      const plan = demo.scenarioToPlan(scenario);

      // api-quick has steps 2 and 3 depending on step 1
      const stepsWithDeps = plan.steps.filter(s => s.dependencies.length > 0);
      assert.ok(stepsWithDeps.length > 0, 'api-quick plan should have steps with dependencies');
    });

    it('each step has required fields', () => {
      const demo = new DemoMode();
      const scenarios = demo.getAvailableScenarios();
      for (const scenario of scenarios) {
        const plan = demo.scenarioToPlan(scenario);
        for (const step of plan.steps) {
          assert.ok(typeof step.stepNumber === 'number', `step.stepNumber missing in ${scenario.name}`);
          assert.ok(step.agentName, `step.agentName missing in ${scenario.name}`);
          assert.ok(step.task, `step.task missing in ${scenario.name}`);
          assert.ok(Array.isArray(step.dependencies), `step.dependencies not array in ${scenario.name}`);
          assert.ok(Array.isArray(step.expectedOutputs), `step.expectedOutputs not array in ${scenario.name}`);
        }
      }
    });

    it('plan metadata contains step count and duration', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('demo-fast')!;
      const plan = demo.scenarioToPlan(scenario);
      assert.ok(plan.metadata, 'plan should have metadata');
      assert.strictEqual(plan.metadata!.totalSteps, scenario.steps.length);
      assert.strictEqual(plan.metadata!.estimatedDuration, scenario.expectedDuration);
    });
  });

  describe('saveScenario and loadScenarioFromFile', () => {
    it('saves and reloads a scenario', () => {
      const demo = new DemoMode(testDir);
      const scenario: DemoScenario = {
        name: 'test-scenario',
        description: 'A test scenario',
        goal: 'Test saving and loading',
        expectedDuration: '1 minute',
        steps: [{
          stepNumber: 1,
          agentName: 'backend_master',
          task: 'Do something',
          dependencies: [],
          expectedOutputs: ['output.ts'],
        }],
      };

      demo.saveScenario(scenario);
      const loaded = demo.loadScenarioFromFile('test-scenario');
      assert.ok(loaded);
      assert.strictEqual(loaded!.name, 'test-scenario');
      assert.strictEqual(loaded!.steps.length, 1);
    });

    it('returns undefined for missing scenario file', () => {
      const demo = new DemoMode(testDir);
      const loaded = demo.loadScenarioFromFile('does-not-exist');
      assert.strictEqual(loaded, undefined);
    });

    it('creates scenarios directory if it does not exist', () => {
      const nestedDir = path.join(testDir, 'sub', 'demos');
      const demo = new DemoMode(nestedDir);
      const scenario: DemoScenario = {
        name: 'nested',
        description: 'Nested test',
        goal: 'Test dir creation',
        expectedDuration: '1s',
        steps: [{ stepNumber: 1, agentName: 'a', task: 't', dependencies: [], expectedOutputs: [] }],
      };
      demo.saveScenario(scenario);
      assert.ok(fs.existsSync(path.join(nestedDir, 'nested.json')));
    });
  });

  describe('demo-fast scenario specifics', () => {
    it('exercises the verification battery with a single worker step', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('demo-fast')!;
      assert.strictEqual(scenario.steps.length, 1);
      assert.strictEqual(scenario.steps[0].dependencies.length, 0);
      assert.strictEqual(scenario.steps[0].agentName, 'worker');
    });

    it('seeds a FAIL_TO_PASS test and supplies a differential test command', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('demo-fast')!;
      assert.ok(scenario.seedFiles, 'demo-fast should seed verification files');
      const seededPaths = scenario.seedFiles!.map(f => f.path);
      assert.ok(seededPaths.includes('package.json'), 'demo-fast should seed package.json');
      assert.ok(
        seededPaths.includes('test/math.test.js'),
        'demo-fast should seed the FAIL_TO_PASS test',
      );
      assert.ok(
        seededPaths.includes('stryker.conf.json'),
        'demo-fast should seed Stryker config so the Layer 2 mutation gate has a real tool',
      );
      assert.ok(
        scenario.differentialTestCommand && scenario.differentialTestCommand.includes('node --test'),
        'demo-fast should pin the Layer 1 differential test command',
      );

      const pkg = scenario.seedFiles!.find(f => f.path === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      assert.ok(
        parsed.devDependencies && parsed.devDependencies['@stryker-mutator/core'],
        'demo-fast package.json should declare @stryker-mutator/core so the orchestrator installs it before the battery',
      );
    });

    it('only references agent roles defined in the default agent config', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('demo-fast')!;
      const validRoles = new Set(['worker', 'reviewer']);
      for (const step of scenario.steps) {
        assert.ok(
          validRoles.has(step.agentName),
          `demo-fast step ${step.stepNumber} uses unknown agent "${step.agentName}"`,
        );
      }
    });
  });

  describe('api-quick scenario specifics', () => {
    it('has three steps with wave dependencies', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('api-quick')!;
      assert.strictEqual(scenario.steps.length, 3);
      assert.strictEqual(scenario.steps[0].dependencies.length, 0);
      assert.ok(scenario.steps[1].dependencies.includes(1), 'step 2 should depend on step 1');
      assert.ok(scenario.steps[2].dependencies.includes(1), 'step 3 should depend on step 1');
    });

    it('only references agent roles defined in the default agent config', () => {
      const demo = new DemoMode();
      const scenario = demo.getScenario('api-quick')!;
      const validRoles = new Set(['worker', 'reviewer']);
      for (const step of scenario.steps) {
        assert.ok(
          validRoles.has(step.agentName),
          `api-quick step ${step.stepNumber} uses unknown agent "${step.agentName}"`,
        );
      }
    });
  });
});
