import * as fs from 'fs';
import * as path from 'path';
import { ExecutionPlan, PlanStep } from './plan-generator';

export interface DemoSeedFile {
  path: string;
  content: string;
}

export interface DemoScenario {
  name: string;
  description: string;
  goal: string;
  steps: PlanStep[];
  expectedDuration: string;
  /**
   * Files to materialize in the demo working directory before the initial
   * git commit. Used to seed verification artifacts (e.g. a FAIL_TO_PASS
   * test that the worker must turn green).
   */
  seedFiles?: DemoSeedFile[];
  /**
   * Command passed to the end-of-run falsification battery as the Layer 1
   * differential test. When set, the orchestrator skips pre-worker test
   * synthesis and uses this command directly.
   */
  differentialTestCommand?: string;
}

/**
 * Pre-configured demo scenarios for showcasing swarm orchestrator
 */
export class DemoMode {
  private scenariosDir: string;

  constructor(scenariosDir?: string) {
    this.scenariosDir = scenariosDir || path.join(process.cwd(), 'demos');
  }

  /**
   * Get all available demo scenarios
   */
  getAvailableScenarios(): DemoScenario[] {
    return [
      this.getDemoFastScenario(),
      this.getApiQuickScenario()
    ];
  }

  /**
   * Demo Fast: a single worker step that has to pass a pre-seeded
   * FAIL_TO_PASS test, then runs the full falsification battery against the
   * resulting patch. Showcases the verification-first pipeline (differential
   * gate, mutation gate, cheat detector, property gate, attestation) end to
   * end on a tiny, deterministic example.
   */
  private getDemoFastScenario(): DemoScenario {
    const packageJson = JSON.stringify(
      {
        name: 'swarm-demo-fast',
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
          test: 'node --test test/math.test.js'
        },
        devDependencies: {
          // Stryker drives the battery's Layer 2 mutation gate. Pinning a
          // recent major keeps the demo reproducible and lets the
          // orchestrator's installDependenciesIfNeeded hook bring it in
          // automatically before the battery runs.
          '@stryker-mutator/core': '^8.6.0'
        }
      },
      null,
      2
    ) + '\n';

    const failToPassTest = `import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { add } from '../src/math.js';

test('add returns the sum of two integers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
  assert.equal(add(0, 0), 0);
  assert.equal(add(100, -50), 50);
});
`;

    // Stryker's "command" test runner just spawns the configured shell
    // command for each mutant. That sidesteps Stryker's per-runner
    // adapters (mocha, jest, ...) and keeps the demo's dependency tree to
    // a single package.
    const strykerConf = JSON.stringify(
      {
        mutate: ['src/**/*.js'],
        testRunner: 'command',
        commandRunner: { command: 'node --test test/math.test.js' },
        reporters: ['clear-text'],
        timeoutMS: 15000,
        tempDirName: '.stryker-tmp'
      },
      null,
      2
    ) + '\n';

    return {
      name: 'demo-fast',
      description: 'Single worker step + full falsification battery on a FAIL_TO_PASS test',
      goal:
        'Implement the missing add(a, b) function at src/math.js so the pre-seeded test/math.test.js transitions from FAIL on the base commit to PASS on the patch commit.',
      expectedDuration: '2-4 minutes',
      seedFiles: [
        { path: 'package.json', content: packageJson },
        { path: 'stryker.conf.json', content: strykerConf },
        { path: 'test/math.test.js', content: failToPassTest }
      ],
      differentialTestCommand: 'node --test test/math.test.js',
      steps: [
        {
          stepNumber: 1,
          agentName: 'worker',
          task:
            'Create src/math.js exporting a function add(a, b) that returns a + b. ' +
            'The pre-seeded test at test/math.test.js imports add from "../src/math.js" — keep that import path. ' +
            'Do not modify the test file. Do not add new dependencies. ' +
            'Run `node --test test/math.test.js` from the repo root and confirm the test passes before you finish. ' +
            'Commit the new src/math.js with a short message.',
          dependencies: [],
          expectedOutputs: [
            'src/math.js exporting add(a, b) = a + b',
            'node --test test/math.test.js exits 0 with all assertions passing',
            'Single commit adding src/math.js'
          ]
        }
      ]
    };
  }

  /**
   * API Quick: 3-step REST API build showing wave dependencies.
   * Step 1: Worker builds the endpoints.
   * Step 2: Reviewer adds tests against the worker's output (depends on step 1).
   * Step 3: Worker adds a Dockerfile (depends on step 1).
   */
  private getApiQuickScenario(): DemoScenario {
    return {
      name: 'api-quick',
      description: 'REST API with tests and Dockerfile, dependency-chained across two waves',
      goal: 'Build a minimal REST API with health and items CRUD, add tests, and containerize with Docker',
      expectedDuration: '4-6 minutes',
      steps: [
        {
          stepNumber: 1,
          agentName: 'worker',
          task: 'Create a Node.js REST API with Express. Endpoints: GET /health returning { status: "ok" }, GET /api/items returning an in-memory array, POST /api/items accepting { name } and returning the created item with a generated id. Add input validation (reject empty name). Export the app for testing. Add a start script to package.json. Commit your work.',
          dependencies: [],
          expectedOutputs: [
            'server.js with /health, GET /api/items, POST /api/items',
            'package.json with start script',
            'Input validation for name field'
          ]
        },
        {
          stepNumber: 2,
          agentName: 'reviewer',
          task: 'Add tests for the REST API created in step 1. Use the Node.js built-in test runner (node:test and node:assert/strict). Test: GET /health returns 200 and { status: "ok" }, GET /api/items returns empty array initially, POST /api/items with valid name returns 201, POST /api/items with empty name returns 400, GET /api/items after POST includes the new item. Import the app from server.js and start/stop it in before/after hooks. Add a test script to package.json. Commit your work.',
          dependencies: [1],
          expectedOutputs: [
            'test/api.test.js with 5+ test cases',
            'Tests use node:test and node:assert/strict',
            'package.json test script'
          ]
        },
        {
          stepNumber: 3,
          agentName: 'worker',
          task: 'Add a Dockerfile for the Node.js REST API. Use node:20-alpine base image, copy package.json first for layer caching, run npm ci --omit=dev, copy source files, expose port 3000, set NODE_ENV=production, and use CMD ["node", "server.js"]. Add a .dockerignore excluding node_modules, .git, and test/. Commit your work.',
          dependencies: [1],
          expectedOutputs: [
            'Dockerfile with multi-layer caching',
            '.dockerignore'
          ]
        }
      ]
    };
  }

  /**
   * Get scenario by name
   */
  getScenario(name: string): DemoScenario | undefined {
    const scenarios = this.getAvailableScenarios();
    return scenarios.find(s => s.name === name);
  }

  /**
   * Save scenario to file
   */
  saveScenario(scenario: DemoScenario): void {
    if (!fs.existsSync(this.scenariosDir)) {
      fs.mkdirSync(this.scenariosDir, { recursive: true });
    }

    const filePath = path.join(this.scenariosDir, `${scenario.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(scenario, null, 2), 'utf8');
  }

  /**
   * Load scenario from file
   */
  loadScenarioFromFile(name: string): DemoScenario | undefined {
    const filePath = path.join(this.scenariosDir, `${name}.json`);

    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as DemoScenario;
  }

  /**
   * Convert scenario to ExecutionPlan
   */
  scenarioToPlan(scenario: DemoScenario): ExecutionPlan {
    return {
      goal: scenario.goal,
      createdAt: new Date().toISOString(),
      steps: scenario.steps,
      metadata: {
        totalSteps: scenario.steps.length,
        estimatedDuration: scenario.expectedDuration
      }
    };
  }
}
