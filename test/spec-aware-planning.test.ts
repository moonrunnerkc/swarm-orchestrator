import * as assert from 'assert';
import { ConfigLoader } from '../src/config-loader';
import { PlanGenerator } from '../src/plan-generator';
import { CostEstimator } from '../src/cost-estimator';
import { DEFAULT_QUALITY_GATES_CONFIG } from '../src/quality-gates/default-config';
import { QualityGatesConfig } from '../src/quality-gates/types';
import {
  buildGateClauses,
  classifyStep,
  getGateRequirements,
  requiresTestStep,
} from '../src/gate-prompt-builder';

function makeConfig(overrides?: Partial<QualityGatesConfig>): QualityGatesConfig {
  const base = JSON.parse(JSON.stringify(DEFAULT_QUALITY_GATES_CONFIG)) as QualityGatesConfig;
  if (!overrides) return base;
  return { ...base, ...overrides, gates: { ...base.gates, ...(overrides.gates || {}) } };
}

function disableGate(
  config: QualityGatesConfig,
  gate: keyof QualityGatesConfig['gates'],
): QualityGatesConfig {
  return {
    ...config,
    gates: {
      ...config.gates,
      [gate]: { ...config.gates[gate], enabled: false },
    },
  };
}

describe('gate-prompt-builder', () => {
  describe('classifyStep', () => {
    it('classifies worker as code-generation', () => {
      assert.strictEqual(classifyStep('worker'), 'code-generation');
    });

    it('classifies reviewer as documentation', () => {
      assert.strictEqual(classifyStep('reviewer'), 'documentation');
    });

    it('classifies unknown agent as code-generation', () => {
      assert.strictEqual(classifyStep('custom-agent'), 'code-generation');
    });
  });

  describe('buildGateClauses', () => {
    it('returns empty array when gates are disabled globally', () => {
      const config = makeConfig({ enabled: false });
      assert.strictEqual(buildGateClauses(config).length, 0);
    });

    it('produces clauses for all enabled gates at defaults', () => {
      const config = makeConfig();
      const clauses = buildGateClauses(config);
      assert.ok(clauses.length >= 6, `Expected at least 6 clauses, got ${clauses.length}`);
    });

    it('omits clause for a disabled gate', () => {
      const config = disableGate(makeConfig(), 'accessibility');
      const clauses = buildGateClauses(config);
      const hasAccessibility = clauses.some((clause) => clause.text.includes('ARIA'));
      assert.strictEqual(hasAccessibility, false);
    });
  });

  describe('getGateRequirements', () => {
    it('includes code-generation requirements for worker', () => {
      const config = makeConfig();
      const reqs = getGateRequirements(config, 'worker');
      assert.ok(reqs.includes('hardcoded URLs'), 'Worker should include config safety requirement');
      assert.ok(reqs.includes('TODO comments'), 'Worker should include scaffold cleanup requirement');
    });

    it('includes documentation requirements for reviewer', () => {
      const config = makeConfig();
      const reqs = getGateRequirements(config, 'reviewer');
      assert.ok(reqs.includes('README claims'), 'Reviewer should include README claim checks');
    });

    it('returns empty string when gates are disabled', () => {
      const config = makeConfig({ enabled: false });
      assert.strictEqual(getGateRequirements(config, 'worker'), '');
    });

    it('keeps prompt additions concise', () => {
      const config = makeConfig();
      const clauses = buildGateClauses(config);
      for (const clause of clauses) {
        const wordCount = clause.text.split(/\s+/).length;
        assert.ok(wordCount < 100, `Clause "${clause.text.slice(0, 40)}..." has ${wordCount} words`);
      }
    });
  });

  describe('requiresTestStep', () => {
    it('returns true when testCoverage is enabled', () => {
      assert.strictEqual(requiresTestStep(makeConfig()), true);
    });

    it('returns false when gates are globally disabled', () => {
      assert.strictEqual(requiresTestStep(makeConfig({ enabled: false })), false);
    });

    it('returns false when testCoverage is disabled', () => {
      assert.strictEqual(requiresTestStep(disableGate(makeConfig(), 'testCoverage')), false);
    });
  });
});

describe('spec-aware-planning', () => {
  const configLoader = new ConfigLoader();
  const agents = configLoader.loadAllAgents();

  describe('plan with gate config', () => {
    it('includes coverage requirements in worker test step prompts when testCoverage is enabled', () => {
      const generator = new PlanGenerator(agents, makeConfig());
      const plan = generator.createPlan('Build a REST API for user management');

      const testStep = plan.steps.find((step) => step.task.startsWith('Create comprehensive API test suite'));
      assert.ok(testStep, 'Plan should have a worker test step');
      assert.ok(testStep.task.includes('test coverage') || testStep.task.includes('tests'));
    });

    it('keeps an existing worker test step when testCoverage is enabled', () => {
      const generator = new PlanGenerator(agents, makeConfig());
      const plan = generator.createPlan('Deploy infrastructure with Terraform');

      const testSteps = plan.steps.filter((step) => step.task.startsWith('Create infrastructure tests'));
      assert.strictEqual(testSteps.length, 1, 'Should keep the infrastructure test step');
    });

    it('does not duplicate worker test step when one already exists', () => {
      const generator = new PlanGenerator(agents, makeConfig());
      const plan = generator.createPlan('Build a REST API for user management');

      const testSteps = plan.steps.filter((step) => step.task.startsWith('Create comprehensive API test suite'));
      assert.strictEqual(testSteps.length, 1, 'Should not duplicate existing test step');
    });

    it('appends gate requirements to at least one prompt at defaults', () => {
      const generator = new PlanGenerator(agents, makeConfig());
      const plan = generator.createPlan('Create a Node.js REST API');

      assert.ok(
        plan.steps.some((step) => step.task.includes('Quality gate requirements:')),
        'Plan should have gate requirements in at least one step',
      );
    });

    it('does not append gate requirements when no gate config is provided', () => {
      const generator = new PlanGenerator(agents);
      const plan = generator.createPlan('Create a Node.js REST API');

      assert.ok(!plan.steps.some((step) => step.task.includes('Quality gate requirements:')));
    });
  });
});

describe('cost-estimator gate-aware adjustment', () => {
  it('reduces retry probability by 30% when gateAwarePrompts is true', () => {
    const estimator = new CostEstimator();
    const plan = {
      goal: 'Build API',
      createdAt: new Date().toISOString(),
      steps: [
        { stepNumber: 1, agentName: 'worker', task: 'Build API', dependencies: [], expectedOutputs: ['API'] },
      ],
    };

    const baseline = estimator.estimate(plan, { modelName: 'claude-sonnet-4' });
    const gateAware = estimator.estimate(plan, { modelName: 'claude-sonnet-4', gateAwarePrompts: true });

    assert.ok(gateAware.retryBuffer <= baseline.retryBuffer);
    assert.ok(gateAware.perStep[0].retryProbability < baseline.perStep[0].retryProbability);
  });

  it('does not reduce when gateAwarePrompts is false or absent', () => {
    const estimator = new CostEstimator();
    const plan = {
      goal: 'Build API',
      createdAt: new Date().toISOString(),
      steps: [
        { stepNumber: 1, agentName: 'worker', task: 'Build API', dependencies: [], expectedOutputs: ['API'] },
      ],
    };

    const without = estimator.estimate(plan, { modelName: 'claude-sonnet-4' });
    const explicit = estimator.estimate(plan, { modelName: 'claude-sonnet-4', gateAwarePrompts: false });

    assert.strictEqual(without.perStep[0].retryProbability, explicit.perStep[0].retryProbability);
  });
});
