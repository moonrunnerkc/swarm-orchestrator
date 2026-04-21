import { AgentProfile, ConfigLoader } from './config-loader';
import { getGateRequirements, requiresTestStep } from './gate-prompt-builder';
import { PlanStorage } from './plan-storage';
import { QualityGatesConfig } from './quality-gates/types';
import { getLogger } from './logger';
const logger = getLogger('plan-generator');

export interface PlanStep {
  stepNumber: number;
  agentName: string;
  task: string;
  dependencies: number[];
  expectedOutputs: string[];
  repo?: string; // git URL or local path; defaults to cwd
  cliAgent?: string; // per-step adapter override (copilot, claude-code, codex)
}

export interface ExecutionPlan {
  goal: string;
  createdAt: string;
  steps: PlanStep[];
  metadata?: {
    totalSteps: number;
    estimatedDuration?: string;
    targetDir?: string;
  };
}

// replan structure returned by meta_reviewer analysis
export interface ReplanPayload {
  retrySteps: number[];
  addSteps?: { agent: string; task: string; afterStep?: number }[];
}

export type GoalType = 'api' | 'web-app' | 'cli-tool' | 'library' | 'infrastructure' | 'data-pipeline' | 'mobile-app' | 'generic';

export class PlanGenerator {
  private gateConfig: QualityGatesConfig | undefined;

  constructor(private availableAgents: AgentProfile[], gateConfig?: QualityGatesConfig) {
    this.gateConfig = gateConfig;
  }

  /**
   * Creates an execution plan from a high-level goal.
   * If userProvidedSteps is given, validates and uses them.
   * Otherwise, generates intelligent default steps based on goal analysis.
   */
  createPlan(goal: string, userProvidedSteps?: PlanStep[], options?: { planCache?: boolean }): ExecutionPlan {
    if (!goal || goal.trim() === '') {
      throw new Error('Goal cannot be empty');
    }

    // plan cache: short-circuit if a similar plan already exists
    if (options?.planCache && !userProvidedSteps) {
      const storage = new PlanStorage();
      const cached = storage.findCachedPlan(goal);
      if (cached) {
        return { ...cached, goal: goal.trim(), createdAt: new Date().toISOString() };
      }
    }

    const steps = userProvidedSteps || this.generateIntelligentSteps(goal);

    // validate that all assigned agents exist
    this.validateAgentAssignments(steps);

    // validate dependencies
    this.validateDependencies(steps);

    return {
      goal: goal.trim(),
      createdAt: new Date().toISOString(),
      steps,
      metadata: {
        totalSteps: steps.length,
      }
    };
  }

  /**
   * Generate Copilot CLI prompt for plan creation
   * User pastes this into Copilot CLI, gets JSON back, then imports via `plan import`
   */
  generateCopilotPlanningPrompt(goal: string): string {
    const agentList = this.availableAgents
      .map(a => `  - ${a.name}: ${a.purpose}`)
      .join('\n');

    return `You are a software project planning expert. Generate a detailed, realistic execution plan for the following goal.

GOAL: ${goal}

Available agents (assign ONE agent per step):
${agentList}

CRITICAL: Output ONLY valid JSON matching this exact schema, no explanation before or after:

{
  "goal": "${goal.replace(/"/g, '\\"')}",
  "createdAt": "${new Date().toISOString()}",
  "steps": [
    {
      "stepNumber": 1,
      "agentName": "AgentName",
      "task": "Specific, actionable task description",
      "dependencies": [],
      "expectedOutputs": ["Output 1", "Output 2"]
    }
  ],
  "metadata": {
    "totalSteps": 4
  }
}

Requirements:
1. Create 4-8 realistic steps (not too few, not too many)
2. Assign appropriate agent to each step based on task domain
3. Use dependencies array to create a valid DAG (no cycles, only reference earlier steps)
4. MAXIMIZE PARALLELISM: steps that can run independently should have the same or no dependencies. Only add a dependency when a step truly needs another step's output.
5. Each task must be specific and actionable (not vague like "do everything")
6. expectedOutputs should list concrete artifacts (files, test results, PRs, etc.)
7. Consider typical software workflow: design/implement in parallel where possible, then test, then integrate
8. If goal involves security, include a SecurityAuditor step
9. If goal involves infrastructure/deployment, include a DevOpsPro step
10. Always include a testing step with TesterElite
11. Final step should be IntegratorFinalizer for verification and integration

OUTPUT ONLY THE JSON, NOTHING ELSE.`;
  }

  /**
   * Create plan from bootstrap analysis
   * Uses annotated steps with source evidence
   */
  createBootstrapPlan(
    goal: string,
    annotatedSteps: import('./bootstrap-types').AnnotatedPlanStep[]
  ): ExecutionPlan {
    // Validate agent assignments
    const regularSteps = annotatedSteps.map(s => ({
      stepNumber: s.stepNumber,
      agentName: s.agentName,
      task: s.task,
      dependencies: s.dependencies,
      expectedOutputs: s.expectedOutputs
    }));

    this.validateAgentAssignments(regularSteps);
    this.validateDependencies(regularSteps);

    return {
      goal: goal.trim(),
      createdAt: new Date().toISOString(),
      steps: annotatedSteps,
      metadata: {
        totalSteps: annotatedSteps.length
      }
    };
  }

  /**
   * Parse Copilot-generated plan from /share transcript
   * Extracts JSON from transcript and validates against schema
   */
  parseCopilotPlanFromTranscript(transcriptContent: string): ExecutionPlan {
    // extract JSON from transcript (might be in code block or plain text)
    const jsonMatch = transcriptContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
                     transcriptContent.match(/(\{[\s\S]*"goal"[\s\S]*"steps"[\s\S]*\})/);

    if (!jsonMatch || !jsonMatch[1]) {
      throw new Error('No valid JSON plan found in transcript. Ensure Copilot output contains a complete JSON object.');
    }

    let plan: ExecutionPlan;
    try {
      plan = JSON.parse(jsonMatch[1]);
    } catch (error) {
      throw new Error(`Invalid JSON in transcript: ${error instanceof Error ? error.message : 'parse error'}`);
    }

    // validate schema
    this.validatePlanSchema(plan);

    return plan;
  }

  /**
   * Validate plan structure matches expected schema
   */
  private validatePlanSchema(plan: unknown): asserts plan is ExecutionPlan {
    if (!plan || typeof plan !== 'object') {
      throw new Error('Plan must be an object');
    }

    const p = plan as Record<string, unknown>;

    if (!p.goal || typeof p.goal !== 'string') {
      throw new Error('Plan must have a goal string');
    }

    if (!p.createdAt || typeof p.createdAt !== 'string') {
      throw new Error('Plan must have a createdAt timestamp');
    }

    if (!Array.isArray(p.steps)) {
      throw new Error('Plan must have a steps array');
    }

    if (p.steps.length === 0) {
      throw new Error('Plan must have at least one step');
    }

    if (p.steps.length > 20) {
      throw new Error('Plan has too many steps (max 20)');
    }

    p.steps.forEach((step: Record<string, unknown>, index: number) => {
      if (typeof step.stepNumber !== 'number') {
        throw new Error(`Step ${index}: stepNumber must be a number`);
      }

      if (!step.agentName || typeof step.agentName !== 'string') {
        throw new Error(`Step ${index}: agentName must be a non-empty string`);
      }

      if (!step.task || typeof step.task !== 'string') {
        throw new Error(`Step ${index}: task must be a non-empty string`);
      }

      if (!Array.isArray(step.dependencies)) {
        throw new Error(`Step ${index}: dependencies must be an array`);
      }

      if (!Array.isArray(step.expectedOutputs)) {
        throw new Error(`Step ${index}: expectedOutputs must be an array`);
      }

      if (step.expectedOutputs.length === 0) {
        throw new Error(`Step ${index}: expectedOutputs cannot be empty`);
      }
    });

    if (!p.metadata || typeof p.metadata !== 'object') {
      p.metadata = { totalSteps: (p.steps as unknown[]).length };
    }
  }

  /**
   * Acceptance criteria that get appended to the primary build step for each goal type.
   * These force the agent to address quality dimensions that AI code gen typically skips.
   */
  private getAcceptanceCriteria(goalType: GoalType): string {
    const shared = [
      'Code must read as human-written: no over-commented obvious logic, no generic variable names, no boilerplate filler.',
      'README must only contain sections relevant to this project. Do not add troubleshooting, FAQ, or contributing sections unless the project warrants them.',
    ];

    const byType: Record<GoalType, string[]> = {
      'web-app': [
        'Semantic HTML: use appropriate elements (nav, main, article, button) not generic divs.',
        'Accessible: ARIA labels on interactive elements, keyboard navigable, :focus-visible styles on all clickable elements.',
        'Responsive: layout works from 320px to 1920px without horizontal overflow. Use relative units, clamp(), or media queries.',
        'No default/placeholder content: real page title, real meta description, favicon link if appropriate.',
        'Include <meta name="description"> and <meta name="theme-color"> in the HTML head.',
        'Add @media (prefers-reduced-motion: reduce) to disable all animations and set transition durations to 0s.',
        'Define CSS custom properties on :root for all colors, spacing, font sizes. Never use raw hex/rgb in rules; always reference a custom property.',
        'Add @media (prefers-color-scheme: dark) that overrides the :root custom properties for full dark mode support.',
        'Separate state management from presentation. Business logic (game rules, validation, computation) must live in a standalone module testable without the DOM.',
        'Wrap all JS in an IIFE or module scope. No bare globals in script scope. Separate pure logic from DOM reads.',
        'Functions that do pure computation must accept values as parameters, not reach into the DOM internally.',
        'Persist counters, preferences, or user state to localStorage when losing them on page reload would be annoying.',
        'Provide an audio signal (Web Audio API beep, no audio file needed) for events that use only visual notification, so background tabs get feedback.',
        'Never reference files, images, fonts, or icons that do not exist in the repo.',
      ],
      'api': [
        'All error responses return specific, actionable messages with relevant values (not "something went wrong").',
        'Input validation on all endpoints with proper 4xx status codes.',
        'No hardcoded config: base URLs, ports, timeouts, secrets in env vars or config module.',
        'Request/response types fully defined (TypeScript interfaces or JSON schema).',
      ],
      'cli-tool': [
        'Helpful --help output with examples for each command.',
        'Specific error messages with context when commands fail (what failed, why, what to try).',
        'Exit codes: 0 for success, non-zero for failure.',
      ],
      'library': [
        'Public API is minimal and well-typed. No internal implementation details exposed.',
        'JSDoc on all exported functions with parameter descriptions and return type.',
        'At least one usage example per major feature in README.',
      ],
      'infrastructure': [
        'All secrets and credentials use environment variables or secrets manager references.',
        'Resources tagged with project name and environment.',
        'Rollback procedure documented.',
      ],
      'data-pipeline': [
        'Input validation and schema checks at pipeline entry point.',
        'Error handling with specific context for each transform stage.',
        'Idempotent: safe to re-run without duplicating data.',
      ],
      'mobile-app': [
        'Touch targets minimum 44x44 points.',
        'Accessible: labels on all interactive elements, VoiceOver/TalkBack compatible.',
        'Handle offline state gracefully with clear user feedback.',
      ],
      'generic': [
        'Separate pure logic from I/O. Business rules must be testable without side effects.',
        'Error messages must be specific and actionable with relevant values.',
        'If the project produces HTML, use semantic elements (nav, main, header, footer, button) not generic divs.',
        'If the project produces CSS, define colors and spacing as CSS custom properties on :root.',
        'If the project produces HTML, include <meta name="description"> and a meaningful <title>.',
        'Never reference files, images, fonts, or icons that do not exist in the repo.',
      ],
    };

    const criteria = [...shared, ...(byType[goalType] || [])];
    return criteria.map(c => '- ' + c).join('\n');
  }

  /**
   * Integrator review criteria appended to the final integration/review step.
   * Turns the integrator from a rubber-stamp documenter into an active reviewer.
   */
  private getIntegratorReviewCriteria(): string {
    return [
      'Review all code from prior steps for quality issues before documenting:',
      '- Remove AI-typical patterns: over-commenting, generic variable names, templated README sections that do not apply, placeholder content.',
      '- Fix package.json metadata: fill author with a relevant value or remove the field entirely. Remove empty keywords array. Remove main field if the project is browser-only with no Node entry point. Description must be accurate.',
      '- Verify no phantom file references: scan for src=, href=, icon: attributes that point to files not in the repo (e.g. favicon.ico that was never created).',
      '- Verify README claims match what is actually implemented. Remove any claims about features that do not exist.',
      '- If test scripts exist in package.json, README must include test instructions (npm install && npm test).',
      '- Check for missing error handling, hardcoded values, or copy-pasted logic that should be extracted.',
      '- If CSS has animations or custom properties: verify @media (prefers-reduced-motion) and @media (prefers-color-scheme: dark) exist.',
      '- Verify JS state is encapsulated (IIFE or module), no bare globals in script scope.',
      '- Verify architecture: business logic (game rules, validation, data transforms) lives in its own module, separate from DOM/UI code, and is testable without a browser.',
      '- Verify tests import and exercise the real module exports, not reimplemented copies of the logic.',
      '- Verify semantic HTML: headings, nav, main, button, etc. not div-with-role or span-as-button.',
      '- Strip any boilerplate that does not serve this specific project.',
      'Then write concise, accurate documentation. Only include sections the project actually needs.',
    ].join('\n');
  }

  /**
   * Generate intelligent default steps based on goal analysis
   * This is the enhanced fallback for instant usability without Copilot CLI
   */
  private generateIntelligentSteps(goal: string): PlanStep[] {
    const goalType = this.detectGoalType(goal);
    const steps: PlanStep[] = [];
    const stepNumber = 1;

    // determine project phases based on goal type
    switch (goalType) {
      case 'api':
        steps.push(...this.generateApiSteps(goal, stepNumber));
        break;

      case 'web-app':
        steps.push(...this.generateWebAppSteps(goal, stepNumber));
        break;

      case 'cli-tool':
        steps.push(...this.generateCliToolSteps(goal, stepNumber));
        break;

      case 'library':
        steps.push(...this.generateLibrarySteps(goal, stepNumber));
        break;

      case 'infrastructure':
        steps.push(...this.generateInfrastructureSteps(goal, stepNumber));
        break;

      case 'data-pipeline':
        steps.push(...this.generateDataPipelineSteps(goal, stepNumber));
        break;

      case 'mobile-app':
        steps.push(...this.generateMobileAppSteps(goal, stepNumber));
        break;

      default:
        steps.push(...this.generateGenericSteps(goal, stepNumber));
    }

    this.applyGateRequirements(steps, goal);

    return steps;
  }

  /**
   * Append gate-derived requirements to step prompts when gate config is available.
   * Also injects a test step if testCoverage is enabled and no TesterElite step exists.
   */
  private applyGateRequirements(steps: PlanStep[], goal: string): void {
    if (!this.gateConfig) return;

    for (const step of steps) {
      const suffix = getGateRequirements(this.gateConfig, step.agentName);
      if (suffix) {
        step.task += suffix;
      }
    }

    // Inject a test step when testCoverage is enabled and no test step exists
    if (requiresTestStep(this.gateConfig)) {
      const hasTestStep = steps.some(s => s.agentName === 'TesterElite');
      if (!hasTestStep) {
        const maxStep = steps.reduce((max, s) => Math.max(max, s.stepNumber), 0);
        const codeStepNumbers = steps
          .filter(s => s.agentName !== 'IntegratorFinalizer')
          .map(s => s.stepNumber);

        const testStep: PlanStep = {
          stepNumber: maxStep + 1,
          agentName: 'TesterElite',
          task: `Write comprehensive tests for: ${goal}` +
            getGateRequirements(this.gateConfig, 'TesterElite'),
          dependencies: codeStepNumbers,
          expectedOutputs: ['Unit tests', 'Integration tests', 'Test coverage report'],
        };
        steps.push(testStep);

        // Update integrator dependencies to include the new test step
        for (const step of steps) {
          if (step.agentName === 'IntegratorFinalizer' && !step.dependencies.includes(testStep.stepNumber)) {
            step.dependencies.push(testStep.stepNumber);
          }
        }
      }
    }
  }

  private detectGoalType(goal: string): GoalType {
    const goalLower = goal.toLowerCase();

    if (goalLower.match(/\b(rest|api|endpoint|graphql|microservice|backend|server)\b/)) {
      return 'api';
    }

    if (goalLower.match(/\b(web app|website|frontend|react|vue|angular|next\.js|dashboard|browser.based|game|interactive|single.page|landing.page)\b/)) {
      return 'web-app';
    }

    // Secondary signal: goal mentions HTML+CSS+JS file combo
    if (goalLower.match(/\b(index\.html|html.+css|css.+js|\.html.+\.js)\b/)) {
      return 'web-app';
    }

    if (goalLower.match(/\b(cli|command.line|terminal|console tool|script)\b/)) {
      return 'cli-tool';
    }

    if (goalLower.match(/\b(library|package|module|sdk|npm package|component library)\b/)) {
      return 'library';
    }

    if (goalLower.match(/\b(deploy|infrastructure|ci\/cd|docker|kubernetes|terraform|cloud)\b/)) {
      return 'infrastructure';
    }

    if (goalLower.match(/\b(etl|pipeline|data processing|analytics|streaming)\b/)) {
      return 'data-pipeline';
    }

    if (goalLower.match(/\b(mobile|ios|android|react native|flutter)\b/)) {
      return 'mobile-app';
    }

    return 'generic';
  }

  private generateApiSteps(goal: string, startNumber: number): PlanStep[] {
    const criteria = this.getAcceptanceCriteria('api');
    const reviewCriteria = this.getIntegratorReviewCriteria();
    return [
      {
        stepNumber: startNumber,
        agentName: 'BackendMaster',
        task: `Design and implement API routes, controllers, and data models for: ${goal}\n\nAcceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: ['API endpoint definitions', 'Request/response schemas', 'Database models']
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'DevOpsPro',
        task: 'Setup project configuration, environment handling, and containerization',
        dependencies: [],
        expectedOutputs: ['Docker configuration', 'Environment config', 'Package scripts']
      },
      {
        stepNumber: startNumber + 2,
        agentName: 'SecurityAuditor',
        task: 'Implement input validation, error handling middleware, and security hardening',
        dependencies: [startNumber],
        expectedOutputs: ['Input validation middleware', 'Error handling', 'Security headers']
      },
      {
        stepNumber: startNumber + 3,
        agentName: 'TesterElite',
        task: 'Create comprehensive API test suite with unit and integration tests',
        dependencies: [startNumber],
        expectedOutputs: ['Unit tests', 'Integration tests', 'Test coverage report']
      },
      {
        stepNumber: startNumber + 4,
        agentName: 'IntegratorFinalizer',
        task: `Review API implementation, verify integration, and write accurate documentation.\n\n${reviewCriteria}`,
        dependencies: [startNumber + 1, startNumber + 2, startNumber + 3],
        expectedOutputs: ['Cleaned-up code', 'Accurate API documentation', 'Quality review notes']
      }
    ];
  }

  private generateWebAppSteps(goal: string, startNumber: number): PlanStep[] {
    const criteria = this.getAcceptanceCriteria('web-app');
    const reviewCriteria = this.getIntegratorReviewCriteria();

    // Simple web apps (vanilla HTML/CSS/JS, no framework, no backend) get a
    // lean 2-step plan: the frontend expert builds everything with tests,
    // and the integrator reviews. Burning 5 premium requests on backend/devops
    // steps that produce nothing useful wastes time and money.
    if (this.isSimpleProject(goal)) {
      return [
        {
          stepNumber: startNumber,
          agentName: 'FrontendExpert',
          task: `Build the complete application with tests for: ${goal}\n\nAcceptance criteria:\n${criteria}\n\nYou must also write tests. Include a test file and a package.json with a working npm test script.`,
          dependencies: [],
          expectedOutputs: ['UI components', 'Styling', 'Accessible markup', 'Tests', 'Working functionality']
        },
        {
          stepNumber: startNumber + 1,
          agentName: 'IntegratorFinalizer',
          task: `Review all code for quality, then write accurate documentation.\n\n${reviewCriteria}`,
          dependencies: [startNumber],
          expectedOutputs: ['Cleaned-up code', 'Accurate documentation', 'Quality review notes']
        }
      ];
    }

    return [
      {
        stepNumber: startNumber,
        agentName: 'FrontendExpert',
        task: `Build UI components and pages for: ${goal}\n\nAcceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: ['UI components', 'Page layouts', 'Styling', 'Accessible markup']
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'BackendMaster',
        task: 'Implement backend API and data layer',
        dependencies: [],
        expectedOutputs: ['API endpoints', 'Database schema', 'Business logic']
      },
      {
        stepNumber: startNumber + 2,
        agentName: 'TesterElite',
        task: 'Create frontend and integration tests',
        dependencies: [startNumber, startNumber + 1],
        expectedOutputs: ['Component tests', 'E2E tests', 'Test coverage']
      },
      {
        stepNumber: startNumber + 3,
        agentName: 'DevOpsPro',
        task: 'Setup CI/CD pipeline and deployment',
        dependencies: [startNumber + 2],
        expectedOutputs: ['CI workflow', 'Build pipeline', 'Deployment config']
      },
      {
        stepNumber: startNumber + 4,
        agentName: 'IntegratorFinalizer',
        task: `Final integration review, cleanup, and documentation.\n\n${reviewCriteria}`,
        dependencies: [startNumber + 3],
        expectedOutputs: ['Cleaned-up code', 'Accurate documentation', 'Quality review notes']
      }
    ];
  }

  private generateCliToolSteps(goal: string, startNumber: number): PlanStep[] {
    const criteria = this.getAcceptanceCriteria('cli-tool');
    const reviewCriteria = this.getIntegratorReviewCriteria();
    return [
      {
        stepNumber: startNumber,
        agentName: 'BackendMaster',
        task: `Implement CLI core functionality for: ${goal}\n\nAcceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: ['CLI commands', 'Argument parsing', 'Core logic']
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'TesterElite',
        task: 'Create CLI tests and validation',
        dependencies: [startNumber],
        expectedOutputs: ['Unit tests', 'CLI integration tests', 'Test coverage']
      },
      {
        stepNumber: startNumber + 2,
        agentName: 'IntegratorFinalizer',
        task: `Review implementation, add accurate documentation and examples.\n\n${reviewCriteria}`,
        dependencies: [startNumber],
        expectedOutputs: ['Cleaned-up code', 'README with examples', 'Quality review notes']
      }
    ];
  }

  private generateLibrarySteps(goal: string, startNumber: number): PlanStep[] {
    const criteria = this.getAcceptanceCriteria('library');
    const reviewCriteria = this.getIntegratorReviewCriteria();
    return [
      {
        stepNumber: startNumber,
        agentName: 'BackendMaster',
        task: `Implement library core API for: ${goal}\n\nAcceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: ['Public API', 'Type definitions', 'Core implementation']
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'TesterElite',
        task: 'Create comprehensive test suite',
        dependencies: [startNumber],
        expectedOutputs: ['Unit tests', 'Integration tests', 'Coverage report']
      },
      {
        stepNumber: startNumber + 2,
        agentName: 'IntegratorFinalizer',
        task: `Review implementation, write accurate documentation with usage examples.\n\n${reviewCriteria}`,
        dependencies: [startNumber],
        expectedOutputs: ['Cleaned-up code', 'API documentation with examples', 'Quality review notes']
      }
    ];
  }

  private generateInfrastructureSteps(goal: string, startNumber: number): PlanStep[] {
    const criteria = this.getAcceptanceCriteria('infrastructure');
    const reviewCriteria = this.getIntegratorReviewCriteria();
    return [
      {
        stepNumber: startNumber,
        agentName: 'DevOpsPro',
        task: `Design and implement infrastructure for: ${goal}\n\nAcceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: ['Infrastructure as code', 'Configuration files', 'Deployment scripts']
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'SecurityAuditor',
        task: 'Review security configuration and access controls',
        dependencies: [startNumber],
        expectedOutputs: ['Security audit', 'Access policies', 'Secrets management']
      },
      {
        stepNumber: startNumber + 2,
        agentName: 'TesterElite',
        task: 'Create infrastructure tests and validation',
        dependencies: [startNumber],
        expectedOutputs: ['Infrastructure tests', 'Validation scripts', 'Test results']
      },
      {
        stepNumber: startNumber + 3,
        agentName: 'IntegratorFinalizer',
        task: `Verify deployment, review configs, and write accurate runbooks.\n\n${reviewCriteria}`,
        dependencies: [startNumber + 1, startNumber + 2],
        expectedOutputs: ['Deployment verification', 'Accurate runbooks', 'Quality review notes']
      }
    ];
  }

  private generateDataPipelineSteps(goal: string, startNumber: number): PlanStep[] {
    const criteria = this.getAcceptanceCriteria('data-pipeline');
    const reviewCriteria = this.getIntegratorReviewCriteria();
    return [
      {
        stepNumber: startNumber,
        agentName: 'BackendMaster',
        task: `Implement data pipeline for: ${goal}\n\nAcceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: ['Pipeline code', 'Data transformations', 'Storage layer']
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'TesterElite',
        task: 'Create data validation and pipeline tests',
        dependencies: [startNumber],
        expectedOutputs: ['Data quality tests', 'Pipeline tests', 'Test coverage']
      },
      {
        stepNumber: startNumber + 2,
        agentName: 'DevOpsPro',
        task: 'Setup pipeline orchestration and monitoring',
        dependencies: [startNumber],
        expectedOutputs: ['Orchestration config', 'Monitoring setup', 'Alerting']
      },
      {
        stepNumber: startNumber + 3,
        agentName: 'IntegratorFinalizer',
        task: `Verify end-to-end pipeline and write accurate documentation.\n\n${reviewCriteria}`,
        dependencies: [startNumber + 1, startNumber + 2],
        expectedOutputs: ['Pipeline verification', 'Accurate documentation', 'Quality review notes']
      }
    ];
  }

  private generateMobileAppSteps(goal: string, startNumber: number): PlanStep[] {
    const criteria = this.getAcceptanceCriteria('mobile-app');
    const reviewCriteria = this.getIntegratorReviewCriteria();
    return [
      {
        stepNumber: startNumber,
        agentName: 'FrontendExpert',
        task: `Build mobile UI and screens for: ${goal}\n\nAcceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: ['Mobile screens', 'Navigation', 'Accessible UI components']
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'BackendMaster',
        task: 'Implement mobile backend and API integration',
        dependencies: [],
        expectedOutputs: ['API client', 'State management', 'Backend integration']
      },
      {
        stepNumber: startNumber + 2,
        agentName: 'TesterElite',
        task: 'Create mobile app tests',
        dependencies: [startNumber, startNumber + 1],
        expectedOutputs: ['Component tests', 'Integration tests', 'Test coverage']
      },
      {
        stepNumber: startNumber + 3,
        agentName: 'IntegratorFinalizer',
        task: `Review app quality, prepare store metadata, and write accurate documentation.\n\n${reviewCriteria}`,
        dependencies: [startNumber + 2],
        expectedOutputs: ['Cleaned-up code', 'App metadata', 'Quality review notes']
      }
    ];
  }

  /**
   * Detect whether the goal describes a small, self-contained project that
   * doesn't need a separate testing step. Indicators: explicit file list,
   * "no framework", "no build step", or very short goal with few deliverables.
   */
  private isSimpleProject(goal: string): boolean {
    const lower = goal.toLowerCase();
    // Explicit signals that the project is small/self-contained
    const simpleSignals = [
      /no (build step|framework|dependencies)/,
      /just (index\.html|html|css|js)/,
      /single.page/,
      /vanilla (js|javascript|html|css)/,
      /no.frameworks/,
    ];
    const fileListMention = (lower.match(/\b(index\.html|style\.css|app\.js|main\.js|script\.js)\b/g) || []).length;
    const hasSimpleSignal = simpleSignals.some(re => re.test(lower));
    // Small file count + simple signal = skip separate test step
    return hasSimpleSignal || fileListMention >= 2;
  }

  private generateGenericSteps(goal: string, startNumber: number): PlanStep[] {
    const primaryAgent = this.assignAgent(goal);
    const criteria = this.getAcceptanceCriteria('generic');
    const reviewCriteria = this.getIntegratorReviewCriteria();

    // For simple projects (few files, no framework, no build step), skip
    // the dedicated TesterElite step. The primary agent's acceptance criteria
    // already require tests, and the IntegratorFinalizer verifies test coverage.
    if (this.isSimpleProject(goal)) {
      return [
        {
          stepNumber: startNumber,
          agentName: primaryAgent,
          task: `Implement core functionality with tests for: ${goal}\n\nAcceptance criteria:\n${criteria}\n\nYou must also write tests. Include a test file and a package.json with a working npm test script.`,
          dependencies: [],
          expectedOutputs: ['Implementation', 'Core files', 'Tests', 'Working functionality']
        },
        {
          stepNumber: startNumber + 1,
          agentName: 'IntegratorFinalizer',
          task: `Review all code for quality, then write accurate documentation.\n\n${reviewCriteria}`,
          dependencies: [startNumber],
          expectedOutputs: ['Cleaned-up code', 'Accurate documentation', 'Quality review notes']
        }
      ];
    }

    return [
      {
        stepNumber: startNumber,
        agentName: primaryAgent,
        task: `Implement core functionality for: ${goal}\n\nAcceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: ['Implementation', 'Core files', 'Working functionality']
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'TesterElite',
        task: 'Create tests and verify functionality',
        dependencies: [startNumber],
        expectedOutputs: ['Tests', 'Test results', 'Coverage report']
      },
      {
        stepNumber: startNumber + 2,
        agentName: 'IntegratorFinalizer',
        task: `Review all code for quality, then write accurate documentation.\n\n${reviewCriteria}`,
        dependencies: [startNumber + 1],
        expectedOutputs: ['Cleaned-up code', 'Accurate documentation', 'Quality review notes']
      }
    ];
  }

  private validateAgentAssignments(steps: PlanStep[]): void {
    const agentNames = new Set(this.availableAgents.map(a => a.name));
    const normalizedAgentNames = new Set(this.availableAgents.map(a => ConfigLoader.normalizeAgentName(a.name)));

    for (const step of steps) {
      if (!agentNames.has(step.agentName) && !normalizedAgentNames.has(ConfigLoader.normalizeAgentName(step.agentName))) {
        throw new Error(
          `Step ${step.stepNumber} assigns unknown agent: ${step.agentName}. ` +
          `Available agents: ${Array.from(agentNames).join(', ')}`
        );
      }
    }
  }

  private validateDependencies(steps: PlanStep[]): void {
    const stepNumbers = new Set(steps.map(s => s.stepNumber));

    for (const step of steps) {
      for (const dep of step.dependencies) {
        if (!stepNumbers.has(dep)) {
          throw new Error(
            `Step ${step.stepNumber} has invalid dependency: step ${dep} does not exist`
          );
        }
        if (dep >= step.stepNumber) {
          throw new Error(
            `Step ${step.stepNumber} has invalid dependency: step ${dep} must come before this step`
          );
        }
      }
    }
  }

  /**
   * Enhanced agent assignment with comprehensive keyword matching
   */
  assignAgent(task: string): string {
    const taskLower = task.toLowerCase();

    // SecurityAuditor keywords (30+ patterns) - check FIRST for security-specific terms
    if (taskLower.match(/\b(security|vulnerability|audit|penetration|owasp|xss|csrf|sql.injection|oauth|saml|encryption|hashing|ssl|tls|certificate|secrets|key.management|rbac|permission|access.control|compliance|gdpr|hipaa|pci|sanitize|validate.input|escape|csp|cors|rate.limit|ddos|firewall)\b/)) {
      return 'SecurityAuditor';
    }

    // FrontendExpert keywords (30+ patterns)
    if (taskLower.match(/\b(ui|ux|frontend|react|vue|angular|svelte|next\.js|nuxt|component|page|layout|css|scss|tailwind|styled|material.ui|chakra|responsive|mobile.first|accessibility|a11y|seo|animation|transitions|dom|browser|webpack|vite|parcel)\b/)) {
      return 'FrontendExpert';
    }

    // BackendMaster keywords (30+ patterns)
    if (taskLower.match(/\b(backend|server|api|rest|graphql|endpoint|route|controller|service|database|schema|sql|nosql|postgres|postgresql|mongodb|mysql|redis|orm|prisma|sequelize|typeorm|authentication|authorization|jwt|session|middleware|express|fastify|koa|nest\.js|microservice|websocket|grpc|message.queue|kafka|rabbitmq|lambda|serverless)\b/)) {
      return 'BackendMaster';
    }

    // DevOpsPro keywords (30+ patterns)
    if (taskLower.match(/\b(devops|deploy|deployment|ci\/cd|pipeline|github.actions|jenkins|circleci|travis|docker|container|kubernetes|k8s|helm|terraform|ansible|cloud|aws|azure|gcp|nginx|apache|load.balancer|cdn|monitoring|prometheus|grafana|logging|elk|observability|infrastructure|iac|provision|scaling|orchestration)\b/)) {
      return 'DevOpsPro';
    }

    // TesterElite keywords (30+ patterns)
    if (taskLower.match(/\b(tests?|testing|qa|quality|jest|mocha|chai|vitest|cypress|playwright|selenium|unit.test|integration.test|e2e|end.to.end|coverage|tdd|bdd|assertion|mock|stub|spy|fixture|snapshot|regression|performance.test|load.test|stress.test|benchmark|validation|verification)\b/)) {
      return 'TesterElite';
    }

    // Generic app/system/implementation tasks should go to BackendMaster
    if (taskLower.match(/\b(implement|create|build|develop|system|app|application|service|functionality|core|main)\b/)) {
      return 'BackendMaster';
    }

    // IntegratorFinalizer as last resort fallback
    return 'IntegratorFinalizer';
  }

  getExecutionOrder(plan: ExecutionPlan): number[] {
    // Simple topological sort for step execution order
    const steps = plan.steps;
    const executed = new Set<number>();
    const order: number[] = [];

    while (order.length < steps.length) {
      let foundStep = false;

      for (const step of steps) {
        if (executed.has(step.stepNumber)) {
          continue;
        }

        const depsReady = step.dependencies.every(dep => executed.has(dep));
        if (depsReady) {
          order.push(step.stepNumber);
          executed.add(step.stepNumber);
          foundStep = true;
        }
      }

      if (!foundStep && order.length < steps.length) {
        throw new Error('Circular dependency detected in plan');
      }
    }

    return order;
  }

  /**
   * revise plan based on replan payload from meta_reviewer
   * preserves completed steps, marks retries with suffix, appends new steps
   */
  revisePlan(
    plan: ExecutionPlan,
    replanPayload: ReplanPayload,
    completedSteps: number[]
  ): ExecutionPlan {
    const revisedSteps: PlanStep[] = [];

    // copy all existing steps (completed ones stay as-is)
    for (const step of plan.steps) {
      revisedSteps.push({ ...step });
    }

    // track highest step number
    let maxStepNumber = Math.max(...plan.steps.map(s => s.stepNumber));

    // mark retry steps with updated task description
    // actual retry branches use suffix like step-3-retry1
    for (const retryStepNum of replanPayload.retrySteps) {
      const existing = revisedSteps.find(s => s.stepNumber === retryStepNum);
      if (existing && !completedSteps.includes(retryStepNum)) {
        // prepend retry indicator to task
        if (!existing.task.startsWith('[RETRY]')) {
          existing.task = `[RETRY] ${existing.task}`;
        }
      }
    }

    // append new steps if any
    if (replanPayload.addSteps && replanPayload.addSteps.length > 0) {
      for (const addReq of replanPayload.addSteps) {
        // validate agent exists — use normalized name comparison so snake_case
        // (integrator_finalizer) matches PascalCase YAML names (IntegratorFinalizer)
        const agentNames = new Set(this.availableAgents.map(a => a.name));
        const normalizedAgentNames = new Set(this.availableAgents.map(a => ConfigLoader.normalizeAgentName(a.name)));
        const matchedAgent = agentNames.has(addReq.agent)
          ? addReq.agent
          : this.availableAgents.find(a => ConfigLoader.normalizeAgentName(a.name) === ConfigLoader.normalizeAgentName(addReq.agent))?.name;
        if (!matchedAgent) {
          logger.warn(`replan: unknown agent "${addReq.agent}", skipping`);
          continue;
        }

        maxStepNumber++;
        const newStep: PlanStep = {
          stepNumber: maxStepNumber,
          agentName: matchedAgent,
          task: addReq.task,
          // depend on afterStep if provided, else last existing step
          dependencies: addReq.afterStep
            ? [addReq.afterStep]
            : plan.steps.length > 0 ? [plan.steps[plan.steps.length - 1].stepNumber] : [],
          expectedOutputs: ['Replan-generated output']
        };
        revisedSteps.push(newStep);
      }
    }

    const metadata: { totalSteps: number; estimatedDuration?: string } = {
      totalSteps: revisedSteps.length
    };
    if (plan.metadata?.estimatedDuration) {
      metadata.estimatedDuration = plan.metadata.estimatedDuration;
    }

    return {
      ...plan,
      createdAt: new Date().toISOString(),
      steps: revisedSteps,
      metadata
    };
  }
}

export default PlanGenerator;
