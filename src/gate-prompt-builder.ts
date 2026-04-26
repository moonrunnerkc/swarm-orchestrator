import { QualityGatesConfig } from './quality-gates/types';

/**
 * Step classification for determining which gate requirements apply.
 * Derived from the agent name assigned to each step.
 */
export type StepCategory = 'code-generation' | 'test' | 'frontend' | 'documentation' | 'all';

/**
 * A single prompt clause generated from an enabled gate.
 * Contains the requirement text and which step categories it applies to.
 */
interface GateClause {
  appliesTo: StepCategory[];
  text: string;
}

/** Agent names that indicate frontend-facing work. */
const FRONTEND_AGENTS = new Set<string>();

/** Agent names that indicate test-writing work. */
const TEST_AGENTS = new Set<string>();

/** Agent names that indicate documentation/review work. */
const DOC_AGENTS = new Set(['reviewer']);

/**
 * Classify a step by its agent name to determine which gate requirements apply.
 * @param agentName - The agent assigned to the step
 * @returns The step category
 */
export function classifyStep(agentName: string): StepCategory {
  if (TEST_AGENTS.has(agentName)) return 'test';
  if (FRONTEND_AGENTS.has(agentName)) return 'frontend';
  if (DOC_AGENTS.has(agentName)) return 'documentation';
  return 'code-generation';
}

/**
 * Build gate-aware prompt clauses from resolved quality gate configuration.
 * Returns an array of clauses, each with its applicable step categories.
 * Only produces clauses for gates that are enabled.
 * @param config - Resolved quality gates configuration
 * @returns Array of gate-derived prompt clauses
 */
export function buildGateClauses(config: QualityGatesConfig): GateClause[] {
  if (!config.enabled) return [];

  const clauses: GateClause[] = [];
  const gates = config.gates;

  if (gates.scaffoldDefaults.enabled) {
    clauses.push({
      appliesTo: ['code-generation', 'test', 'frontend', 'documentation', 'all'],
      text: 'Remove all TODO comments, placeholder text, and default scaffold values before completing.',
    });
  }

  if (gates.duplicateBlocks.enabled) {
    clauses.push({
      appliesTo: ['code-generation', 'frontend'],
      text: 'Avoid duplicating code blocks. Extract shared logic into utility functions.',
    });
  }

  if (gates.hardcodedConfig.enabled) {
    clauses.push({
      appliesTo: ['code-generation', 'frontend'],
      text: 'Use environment variables for configuration values. No hardcoded URLs, ports, credentials, or API keys.',
    });
  }

  if (gates.testCoverage.enabled) {
    clauses.push({
      appliesTo: ['test'],
      text: `Achieve thorough test coverage. Test every exported function and major code path.`,
    });
  }

  if (gates.testIsolation.enabled) {
    clauses.push({
      appliesTo: ['test'],
      text: 'Each test must be independently runnable. No shared mutable state between tests.',
    });
  }

  if (gates.accessibility.enabled) {
    clauses.push({
      appliesTo: ['frontend'],
      text: 'Include ARIA attributes, keyboard navigation, and semantic HTML.',
    });
  }

  if (gates.readmeClaims.enabled) {
    clauses.push({
      appliesTo: ['documentation'],
      text: 'README claims must match actual implemented functionality.',
    });
  }

  if (gates.runtimeChecks.enabled) {
    clauses.push({
      appliesTo: ['code-generation', 'test', 'frontend', 'documentation', 'all'],
      text: 'Code must build and pass all tests before completion.',
    });
  }

  return clauses;
}

/**
 * Get requirement lines to append to a step's prompt based on gate config.
 * Filters clauses to those applicable to the step's category, then formats
 * them as a bulleted list. Returns empty string if no clauses apply.
 * @param config - Resolved quality gates configuration
 * @param agentName - Agent assigned to the step (used for classification)
 * @returns Formatted requirement text to append to the step prompt, or empty string
 */
export function getGateRequirements(config: QualityGatesConfig, agentName: string): string {
  const clauses = buildGateClauses(config);
  if (clauses.length === 0) return '';

  const category = classifyStep(agentName);
  const applicable = clauses.filter(
    c => c.appliesTo.includes(category) || c.appliesTo.includes('all')
  );

  if (applicable.length === 0) return '';

  const lines = applicable.map(c => `- ${c.text}`).join('\n');
  return `\n\nQuality gate requirements:\n${lines}`;
}

/**
 * Check whether the gate config indicates a need for an explicit test step.
 * Returns true when testCoverage is enabled, which signals the planner
 * should verify a worker test step exists in the plan.
 * @param config - Resolved quality gates configuration
 * @returns Whether a test step should be ensured
 */
export function requiresTestStep(config: QualityGatesConfig): boolean {
  return config.enabled && config.gates.testCoverage.enabled;
}
