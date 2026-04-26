import * as fs from 'fs';
import * as path from 'path';
import { ExecutionPlan, PlanStep } from './plan-generator';

export interface DemoScenario {
  name: string;
  description: string;
  goal: string;
  steps: PlanStep[];
  expectedDuration: string;
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
   * Demo Fast - "hello world" swarm
   * Two agents, one wave, minimal work.
   * Both steps are truly independent - no shared files.
   */
  private getDemoFastScenario(): DemoScenario {
    return {
      name: 'demo-fast',
      description: 'Two-step hello-world swarm proving parallel execution (one wave)',
      goal: 'Quick swarm hello-world: two independent micro-tasks running in parallel',
      expectedDuration: '20-30 seconds',
      steps: [
        {
          stepNumber: 1,
          agentName: 'backend_master',
          task: 'Create a tiny TypeScript utility module at src/string-utils.ts that exports a function greet(name: string): string which returns "Hello, <name>!". Keep it boring. No new deps. Add a short top-of-file comment. Commit your work.',
          dependencies: [],
          expectedOutputs: [
            'src/string-utils.ts with exported greet() function'
          ]
        },
        {
          stepNumber: 2,
          agentName: 'frontend_expert',
          task: 'Create a tiny TypeScript utility module at src/number-utils.ts that exports a function double(n: number): number which returns n * 2. Keep it boring. No new deps. Add a short top-of-file comment. Commit your work.',
          dependencies: [],
          expectedOutputs: [
            'src/number-utils.ts with exported double() function'
          ]
        }
      ]
    };
  }

  /**
   * API Quick: 3-step REST API build showing wave dependencies.
   * Step 1: Worker builds the endpoints.
   * Step 2: Worker adds tests (depends on step 1).
   * Step 3: Worker adds a Dockerfile (depends on step 1).
   */
  private getApiQuickScenario(): DemoScenario {
    return {
      name: 'api-quick',
      description: 'REST API with tests and Dockerfile (3 agents, 2 waves, ~5 min)',
      goal: 'Build a minimal REST API with health and items CRUD, add tests, and containerize with Docker',
      expectedDuration: '4-6 minutes',
      steps: [
        {
          stepNumber: 1,
          agentName: 'backend_master',
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
          agentName: 'tester_elite',
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
          agentName: 'devops_pro',
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
