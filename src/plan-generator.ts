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

export type GoalType = 'api' | 'web-app' | 'cli-tool' | 'library' | 'infrastructure' | 'data-pipeline' | 'mobile-app' | 'bug-fix' | 'contract-change' | 'generic';

export class PlanGenerator {
  private gateConfig: QualityGatesConfig | undefined;

  constructor(private availableAgents: AgentProfile[], gateConfig?: QualityGatesConfig) {
    this.gateConfig = gateConfig;
  }

  /**
   * Creates an execution plan from a high-level goal.
   * If userProvidedSteps is given, validates and uses them.
   * Otherwise, generates intelligent default steps based on goal analysis.
   *
   * **Layer boundary on `goal` vs `agentGuidance`.** The classifier
   * (detectGoalType + assignAgent) uses ONLY the raw task intent. Callers
   * that need to inject guidance the executing agent should see (e.g.
   * "do not edit test files" constraints from a benchmark harness) pass
   * that text through `options.agentGuidance` — it prepends to each
   * step's task string so agents see it, but never reaches the
   * classifier. This isolates goal-interpretation from agent-execution
   * guidance; without the split, preamble text about "tests" or
   * "security" misdirects the classifier into picking the wrong primary
   * agent. See issue #27 (Fix 1) for the sympy-12481 failure mode this
   * prevents.
   */
  createPlan(
    goal: string,
    userProvidedSteps?: PlanStep[],
    options?: { planCache?: boolean; agentGuidance?: string },
  ): ExecutionPlan {
    if (!goal || goal.trim() === '') {
      throw new Error('Goal cannot be empty');
    }

    // plan cache: short-circuit if a similar plan already exists. Cache key
    // is the raw goal; agentGuidance doesn't affect step shape, only task
    // text, and can be reapplied to a cached plan.
    if (options?.planCache && !userProvidedSteps) {
      const storage = new PlanStorage();
      const cached = storage.findCachedPlan(goal);
      if (cached) {
        const steps = options.agentGuidance
          ? this.applyAgentGuidance(cached.steps, options.agentGuidance)
          : cached.steps;
        return {
          ...cached,
          goal: goal.trim(),
          steps,
          createdAt: new Date().toISOString(),
        };
      }
    }

    const rawSteps = userProvidedSteps || this.generateIntelligentSteps(goal);
    const steps = options?.agentGuidance
      ? this.applyAgentGuidance(rawSteps, options.agentGuidance)
      : rawSteps;

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
   * Prepend guidance text to every step's task so the executing agent sees
   * it. Runs AFTER classification so the guidance never influences agent
   * selection or step-shape decisions.
   */
  private applyAgentGuidance(steps: PlanStep[], guidance: string): PlanStep[] {
    const trimmed = guidance.trim();
    if (!trimmed) return steps;
    return steps.map(step => ({
      ...step,
      task: `${trimmed}\n\n${step.task}`,
    }));
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
      throw new Error(
        `Invalid JSON in transcript: ${error instanceof Error ? error.message : 'parse error'}`,
        { cause: error },
      );
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
      'bug-fix': [
        'Diagnose the root cause before editing. State your hypothesis, then verify it against the reported failure — do not patch symptoms.',
        'Apply the smallest change that resolves the reported failure. Refactors and unrelated improvements do not belong in a bug fix.',
        'Preserve observable behavior for every code path the fix does not target. A bug fix that changes behavior elsewhere is a regression.',
        'Error messages and exception types must match what downstream callers already depend on, unless the issue explicitly asks to change them.',
      ],
      'contract-change': [
        'Apply the contract change and every caller/test update in this single step. The post-step verifier runs tests against the combined state — an impl change without its matching test updates will fail verification and force a rollback.',
        'Enumerate every call site before editing. A caller the agent missed is a broken build; use the repo\'s own tools (grep, TypeScript references) to find them all.',
        'Update tests alongside the impl so existing tests that exercised the pre-change contract become tests of the post-change contract. Adding entirely new tests is fine; leaving stale tests in place is not.',
        'Do not introduce unrelated refactors while touching each file. The only changes that belong in this step are the ones the contract change requires.',
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

      case 'bug-fix':
        steps.push(...this.generateBugFixSteps(goal, stepNumber));
        break;

      case 'contract-change':
        steps.push(...this.generateContractChangeSteps(goal, stepNumber));
        break;

      default:
        steps.push(...this.generateGenericSteps(goal, stepNumber));
    }

    this.applyGateRequirements(steps, goal, goalType);

    return steps;
  }

  /**
   * Append gate-derived requirements to step prompts when gate config is available.
   * Also injects a test step if testCoverage is enabled and no TesterElite step exists —
   * EXCEPT for contract-change plans, where tests are updated in the same step as the
   * impl change by template design (see generateContractChangeSteps). Injecting a
   * separate TesterElite step on a contract-change plan would re-introduce the exact
   * impl-vs-test split that #27 Fix 3 exists to prevent.
   */
  private applyGateRequirements(steps: PlanStep[], goal: string, goalType?: GoalType): void {
    if (!this.gateConfig) return;

    for (const step of steps) {
      const suffix = getGateRequirements(this.gateConfig, step.agentName);
      if (suffix) {
        step.task += suffix;
      }
    }

    // Inject a test step when testCoverage is enabled and no test step exists.
    // Contract-change plans bundle tests into their impl step; a separate
    // TesterElite step here would re-create the broken mid-plan `npm test`
    // against a half-updated state.
    if (goalType === 'contract-change') return;

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

  /**
   * Classify a raw goal string. Public for test — consumers in production
   * code should call `createPlan` and read `plan.metadata` or inspect step
   * shape instead of depending on this classification directly, so the
   * classifier's keyword/structural heuristics remain an implementation
   * detail of the planner. The test suite uses this directly to assert
   * classification decisions in isolation from template behavior, per the
   * #30 review on separating classifier correctness from template
   * correctness.
   *
   * @internal
   */
  classifyGoal(goal: string): GoalType {
    return this.detectGoalType(goal);
  }

  private detectGoalType(goal: string): GoalType {
    // CLASSIFIER DISPATCH ORDER — do not reorder without re-reading this.
    //
    // Structural discriminators (contract-change, bug-fix) run BEFORE the
    // keyword-based domain classifiers (api, library, frontend, etc.).
    // Domain keywords are commonly present in goals that are actually
    // coordinated-change or bug-report tasks — "update the `foo` library
    // to ..." mentions "library" but should never route to the rigid
    // library template because its step shape is wrong for a contract
    // change. Centralizing the structural discrimination at the top of
    // the chain means the decision lives in one place, audit-able and
    // non-duplicated across templates. See #27 Fixes 2 and 3 for the
    // two failure modes the ordering prevents.
    //
    // Precedence when a goal has BOTH structural shapes (≥2 backticks +
    // failure verb AND ≥2 change verbs — e.g., "fix this: update foo,
    // rename bar, modify baz"): contract-change wins because it runs
    // first. That's the intended precedence — a goal with multi-target
    // imperative change verbs is better served by the bundled impl+tests
    // shape than by the bug-fix 3-step shape, even when it opens with a
    // failure description. If a counter-example surfaces where this
    // precedence produces the wrong plan shape, that's the evidence to
    // revisit here.
    const goalLower = goal.toLowerCase();

    // contract-change: coordinated modification of existing code (impl +
    // callers + tests). Must run BEFORE the domain classifiers (api, library,
    // etc.) — see ordering note above.
    if (this.hasContractChangeShape(goal)) {
      return 'contract-change';
    }

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

    // bug-fix: the task operates on pre-existing state with an observed
    // failure. Structural discriminator (not keyword matching on "fix" /
    // "bug" / "broken" — those produce false positives on greenfield goals
    // like "fix common patterns" and false negatives on issue bodies that
    // describe failure without using trigger words). Two structural signals:
    //   1. backtick-wrapped code references — symbols, methods, expressions
    //      — indicating the task already knows about specific identifiers
    //      in the existing codebase
    //   2. present-tense failure verbs describing current broken behavior
    //      (fails/raises/throws/errors/crashes/returns X instead of Y)
    // Both must be present for a goal to count as a bug report shape. See
    // issue #27 Fix 2.
    if (this.hasBugReportShape(goal)) {
      return 'bug-fix';
    }

    return 'generic';
  }

  /**
   * Structural discriminator for contract-change goals: coordinated
   * modifications to existing code across impl + callers + tests, with
   * explicit "update X, update Y" language. Two signals required:
   *   1. At least two backtick-wrapped code references (existing symbols,
   *      files, or APIs the task names). Same floor as hasBugReportShape
   *      to keep the greenfield false-positive rate low.
   *   2. At least two imperative change verbs — "update X" / "rename X" /
   *      "modify X" / "change X" — which signals the author expects work
   *      distributed across multiple artifacts rather than a single new
   *      build.
   *
   * The second signal is what distinguishes contract-change from bug-fix:
   * bug-fix describes OBSERVED failure; contract-change prescribes
   * INTENDED multi-artifact change. Both can match the same existing code
   * backtick-density signal, but only one uses multi-target update verbs.
   *
   * Kept deliberately narrow. A single "update X" clause isn't enough —
   * "fix this: update index.js" is closer to bug-fix shape. Two separate
   * update clauses ("update X ... update Y") is what marks the
   * coordinated-change intent that the contract-change template exists
   * to handle.
   *
   * See issue #27 Fix 3.
   */
  private hasContractChangeShape(goal: string): boolean {
    const backtickMatches = goal.match(/`[^`\n]+`/g) ?? [];
    if (backtickMatches.length < 2) return false;

    // Count distinct imperative change clauses. `\b(update|rename|...)\s+\S+`
    // matches "update X" / "rename X" etc.; we require ≥2 so a lone
    // "update index.js" in a bug-fix description doesn't misroute.
    const changeVerbRe = /\b(update|rename|modify|change|convert)\s+[^\s.,;]+/gi;
    const verbCount = (goal.match(changeVerbRe) ?? []).length;
    return verbCount >= 2;
  }

  /**
   * Structural discriminator for bug-report-shaped goals. Implementation
   * detail of detectGoalType — exposed as its own method so the classifier
   * contract stays testable in isolation.
   */
  private hasBugReportShape(goal: string): boolean {
    // 1. Backtick density — at least two distinct backtick-wrapped references.
    //    Single backticks around one term (`API` in "Build an API") are common
    //    in imperative goals too, so we require at least two.
    const backtickMatches = goal.match(/`[^`\n]+`/g) ?? [];
    if (backtickMatches.length < 2) return false;

    // 2. Present-tense failure verb describing current broken behavior.
    //    Explicitly not matching "fix" / "bug" / "broken" as keywords — those
    //    describe the PROPOSED WORK, not the OBSERVED FAILURE, and produce
    //    false positives on greenfield goals like "fix common patterns".
    const failurePattern = new RegExp(
      [
        '\\b(fails?|failing|raises?|raising)\\b',
        '\\b(throws?|throwing|errors?|erroring)\\b',
        '\\b(crashes?|crashing|hangs?|hanging)\\b',
        '\\b(leaks?|leaking)\\b',
        '\\b(returns?\\s+\\S+\\s+instead\\b)',
        '(does\\s?n[’\']?t\\s+(work|match|behave|handle))',
        '(is\\s+incorrect|is\\s+wrong|incorrectly\\s+\\w+)',
      ].join('|'),
      'i',
    );
    return failurePattern.test(goal);
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
   * Template for goals that describe a failing behavior in pre-existing code
   * and ask for it to be corrected. Structural shape:
   *   1. BackendMaster — locate root cause and apply a minimal fix
   *   2. TesterElite — verify the fix with a regression test
   *   3. IntegratorFinalizer — review scope and quality
   *
   * The primary step is an impl-editing agent by construction. That's the
   * invariant the bug-fix template exists to guarantee: a bug report will
   * never produce a plan without an impl-editing step, which was exactly
   * the sympy-12481 failure mode in Phase 4a smoke3.
   *
   * **BackendMaster as fixed primary — deferred decision.** The current
   * benchmark corpus (SWE-bench Verified) is backend-dominant: the 500
   * Verified instances are drawn from sympy, sphinx, django, scikit-learn,
   * matplotlib, astropy, xarray, pytest, pylint, requests — all Python
   * libraries and frameworks whose issues are predominantly source-code
   * bugs in logic/data/API layers. Routing every bug report to
   * BackendMaster matches that distribution. It will misroute a true UI
   * bug (one that names React components or describes rendering-specific
   * failure) to BackendMaster.
   *
   * The trigger for adding UI routing: observe a bug-report goal in a
   * future corpus (or a SWE-bench instance) where the BackendMaster-
   * primary plan produces a broken result specifically because the wrong
   * agent was allocated — i.e., the fix requires FrontendExpert's
   * rendering-model knowledge and BackendMaster can't make progress.
   * Until that evidence surfaces, hardcoding BackendMaster keeps the
   * template simple and correct for the dominant case. See #27.
   */
  private generateBugFixSteps(goal: string, startNumber: number): PlanStep[] {
    const criteria = this.getAcceptanceCriteria('bug-fix');
    const reviewCriteria = this.getIntegratorReviewCriteria();
    return [
      {
        stepNumber: startNumber,
        agentName: 'BackendMaster',
        task:
          `Diagnose and fix the reported bug.\n\nReported issue:\n${goal}\n\n` +
          `Acceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: [
          'Root cause identification',
          'Minimal source-code fix targeting the reported failure',
          'Brief justification of why the fix addresses the root cause, not a symptom',
        ],
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'TesterElite',
        task:
          `Write a regression test that reproduces the reported failure and ` +
          `now passes with the fix applied. Do not modify pre-existing test ` +
          `assertions — add new coverage targeted at the bug.\n\n` +
          `Reported issue (for context):\n${goal}`,
        dependencies: [startNumber],
        expectedOutputs: [
          'Regression test that would have failed pre-fix',
          'Confirmation existing tests still pass',
        ],
      },
      {
        stepNumber: startNumber + 2,
        agentName: 'IntegratorFinalizer',
        task:
          `Review the fix's scope, quality, and documentation. Confirm the ` +
          `change does not drift beyond the reported failure and that any ` +
          `public API or error message changes are documented.\n\n${reviewCriteria}`,
        dependencies: [startNumber, startNumber + 1],
        expectedOutputs: [
          'Scope review notes',
          'Documentation updates if public surface changed',
          'Quality review notes',
        ],
      },
    ];
  }

  /**
   * Template for coordinated modifications to an existing codebase — the
   * "contract change" shape. Structural invariant of this template:
   *
   *   The impl change, the caller updates, and the test updates all land
   *   in ONE step. There is NO separate TesterElite-owned test-update step
   *   between impl-change and IntegratorFinalizer.
   *
   * Rationale (#27 Fix 3 root-cause analysis). The library template and
   * bug-fix template both place BackendMaster → TesterElite as two
   * separate steps. Between them, the per-step verifier runs `npm test`.
   * For a contract-change task, step 1 lands the impl change that
   * intentionally breaks the pre-existing tests (they assert the OLD
   * contract); `npm test` fails; verifier rolls step 1 back; step 2
   * never runs. This template removes that failure mode by bundling
   * impl + callers + tests into one step whose post-step verification
   * sees a coherent post-contract-change state.
   *
   * Verifier contract is unchanged. The orchestrator's per-step
   * verification discipline is what catches agent lies; weakening it to
   * "defer `npm test` to end-of-plan" would defeat that discipline. The
   * plan generator's job is to shape plans the per-step verifier can
   * successfully evaluate.
   *
   * Why only 2 steps. For a bundled change, there's no coherent handoff
   * to a second impl-editing step. IntegratorFinalizer stays as the
   * scope/quality reviewer.
   */
  private generateContractChangeSteps(goal: string, startNumber: number): PlanStep[] {
    const criteria = this.getAcceptanceCriteria('contract-change');
    const reviewCriteria = this.getIntegratorReviewCriteria();
    return [
      {
        stepNumber: startNumber,
        agentName: 'BackendMaster',
        task:
          `Apply the following contract change as a single atomic step. ` +
          `This step must update the implementation, every call site, AND ` +
          `every affected test so the test suite passes against the new ` +
          `contract when the step completes. Updating impl + callers while ` +
          `leaving pre-existing tests unchanged is a failure mode of this ` +
          `step: pre-existing tests assert the OLD contract and will fail ` +
          `verification against the NEW impl. Updating tests is not ` +
          `optional; it is part of the atomic bundle.\n\n` +
          `Contract change:\n${goal}\n\n` +
          `Acceptance criteria:\n${criteria}`,
        dependencies: [],
        expectedOutputs: [
          'Updated implementation',
          'All call sites updated',
          'Tests updated to exercise the post-change contract',
          'Docs/examples updated where the contract surfaces publicly',
        ],
      },
      {
        stepNumber: startNumber + 1,
        agentName: 'IntegratorFinalizer',
        task:
          `Review the contract change's scope, quality, and documentation. ` +
          `Confirm every call site was updated (no stale pre-change callers) ` +
          `and the test suite now exercises the post-change contract rather ` +
          `than asserting on the old one.\n\n${reviewCriteria}`,
        dependencies: [startNumber],
        expectedOutputs: [
          'Scope review notes',
          'Caller-update completeness check',
          'Quality review notes',
        ],
      },
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
