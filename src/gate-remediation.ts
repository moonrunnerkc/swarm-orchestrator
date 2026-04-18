import { getLogger } from './logger';
import { AgentProfile } from './config-loader';
import { run_quality_gates } from './quality-gates';
import type { GateResult } from './quality-gates';

const logger = getLogger('gate-remediation');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal execution-context shape required by the remediation logic.
 * The index signature allows transparent pass-through of additional
 * properties that the orchestrator attaches to its context objects.
 */
export interface RemediationContext {
  results: Array<{ stepNumber: number; status: string }>;
  plan: { steps: Array<{ stepNumber: number; agentName: string }> };
  qualityGatesTriggered?: Record<string, boolean>;
  finalGateResults?: GateResult[];
  [key: string]: any; // allow context pass-through
}

// ---------------------------------------------------------------------------
// buildRemediationStep
// ---------------------------------------------------------------------------

/**
 * Inspect a single gate result and, if it failed and auto-fix is enabled
 * (and hasn't already been attempted), return a remediation step descriptor.
 * Returns `null` when no action is needed.
 */
export function buildRemediationStep(
  gateResult: { status: string; issues?: Array<{ message: string; filePath?: string; hint?: string }> } | undefined,
  configEnabled: boolean,
  triggeredFlag: string,
  triggeredFlags: Record<string, boolean>,
  agents: Map<string, AgentProfile>,
  resolveAgent: (agents: Map<string, AgentProfile>, name: string) => AgentProfile | undefined,
  taskDescription: string,
  warningMessage: string,
  afterStep: number,
  fallbackAgent: string,
): { agent: string; task: string; afterStep: number } | null {
  if (!gateResult || gateResult.status !== 'fail') return null;
  if (!configEnabled) return null;
  if (triggeredFlags[triggeredFlag]) return null;

  const preferredAgent = resolveAgent(agents, 'integrator_finalizer')
    ? 'integrator_finalizer'
    : fallbackAgent;

  logger.warn(warningMessage);
  triggeredFlags[triggeredFlag] = true;

  // Append specific findings so the remediation agent knows exactly what to fix
  let taskWithFindings = taskDescription;
  if (gateResult.issues && gateResult.issues.length > 0) {
    const findings = gateResult.issues.map(issue => {
      let finding = `- ${issue.message}`;
      if (issue.filePath) finding += ` (${issue.filePath})`;
      if (issue.hint) finding += ` -- hint: ${issue.hint}`;
      return finding;
    }).join('\n');
    taskWithFindings += `\n\nSpecific findings from the gate:\n${findings}`;
  }

  return { agent: preferredAgent, task: taskWithFindings, afterStep };
}

// ---------------------------------------------------------------------------
// runQualityGateRemediation
// ---------------------------------------------------------------------------

/**
 * Run quality gates, check if auto-fix is possible, build remediation steps,
 * consolidate them into a single step if multiple are needed, call
 * `executeReplan`, re-run gates, and if still failing do a second attempt
 * with specific findings.
 *
 * Returns whether the final gate run passed and the latest gate results.
 */
export async function runQualityGateRemediation(params: {
  workingDir: string;
  gatesConfig: any;
  gatesOut: string;
  baselineFiles?: Set<string>;
  baseCommit?: string;
  skippedReqIds?: Set<string>;
  context: RemediationContext;
  agents: Map<string, AgentProfile>;
  options?: any;
  resolveAgent: (agents: Map<string, AgentProfile>, name: string) => AgentProfile | undefined;
  executeReplan: (context: any, payload: any, agents: Map<string, AgentProfile>, options?: any) => Promise<void>;
}): Promise<{ passed: boolean; results: GateResult[] }> {
  const {
    workingDir,
    gatesConfig,
    gatesOut,
    baselineFiles,
    baseCommit,
    skippedReqIds,
    context,
    agents,
    options,
    resolveAgent,
    executeReplan,
  } = params;

  // Initial quality-gate run
  let gatesResult = await run_quality_gates(workingDir, gatesConfig, gatesOut, baselineFiles, baseCommit, skippedReqIds);
  context.finalGateResults = gatesResult.results;

  if (!gatesResult.passed && gatesConfig.failOnIssues) {
    const failedIds = new Set(gatesResult.results.filter(r => r.status === 'fail').map(r => r.id));
    let remediationAttempted = false;

    const triggeredFlags = context.qualityGatesTriggered || {};

    const canAutoFix = !!context.qualityGatesTriggered && (
      (failedIds.has('duplicate-blocks') && gatesConfig.autoAddRefactorStepOnDuplicateBlocks && !triggeredFlags.duplicateRefactorAdded) ||
      (failedIds.has('readme-claims') && gatesConfig.autoAddReadmeTruthStepOnReadmeClaims && !triggeredFlags.readmeTruthAdded) ||
      (failedIds.has('scaffold-defaults') && gatesConfig.autoAddScaffoldFixStepOnScaffoldDefaults && !triggeredFlags.scaffoldFixAdded) ||
      (failedIds.has('hardcoded-config') && gatesConfig.autoAddConfigFixStepOnHardcodedConfig && !triggeredFlags.configFixAdded) ||
      (failedIds.has('accessibility') && gatesConfig.autoAddAccessibilityFixStepOnAccessibility && !triggeredFlags.accessibilityFixAdded) ||
      (failedIds.has('test-coverage') && gatesConfig.autoAddTestCoverageStepOnTestCoverage && !triggeredFlags.testCoverageFixAdded)
    );

    if (canAutoFix) {
      // Remediation steps should depend only on steps that actually completed.
      // Using the max step number can create dependencies on failed/blocked steps,
      // causing the remediation to wait forever then timeout.
      const completedStepNumbers = context.results
        .filter(r => r.status === 'completed')
        .map(r => r.stepNumber);
      const maxCompletedStep = completedStepNumbers.length > 0
        ? Math.max(...completedStepNumbers)
        : 0; // no dependency if nothing completed
      const lastAgent = context.plan.steps[context.plan.steps.length - 1]?.agentName || 'integrator_finalizer';

      const addSteps: Array<{ agent: string; task: string; afterStep?: number }> = [];

      const dupStep = buildRemediationStep(
        gatesResult.results.find(r => r.id === 'duplicate-blocks'),
        gatesConfig.autoAddRefactorStepOnDuplicateBlocks,
        'duplicateRefactorAdded', triggeredFlags, agents, resolveAgent,
        'Quality gates flagged repeated code blocks. Extract shared utilities/hooks/middleware and refactor duplicates away. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: duplicate blocks detected; scheduling refactor',
        maxCompletedStep, lastAgent,
      );
      if (dupStep) addSteps.push(dupStep);

      const readmeStep = buildRemediationStep(
        gatesResult.results.find(r => r.id === 'readme-claims'),
        gatesConfig.autoAddReadmeTruthStepOnReadmeClaims,
        'readmeTruthAdded', triggeredFlags, agents, resolveAgent,
        'Quality gates flagged README claims that are not backed by code. Either implement the missing features or downgrade/remove the claims. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: README claims mismatch; scheduling truth step',
        maxCompletedStep, lastAgent,
      );
      if (readmeStep) addSteps.push(readmeStep);

      const scaffoldStep = buildRemediationStep(
        gatesResult.results.find(r => r.id === 'scaffold-defaults'),
        gatesConfig.autoAddScaffoldFixStepOnScaffoldDefaults,
        'scaffoldFixAdded', triggeredFlags, agents, resolveAgent,
        'Quality gates flagged scaffold defaults. Remove placeholder assets and generic scaffold README sections, and ensure HTML title/app metadata are meaningful. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: scaffold defaults detected; scheduling cleanup',
        maxCompletedStep, lastAgent,
      );
      if (scaffoldStep) addSteps.push(scaffoldStep);

      const configStep = buildRemediationStep(
        gatesResult.results.find(r => r.id === 'hardcoded-config'),
        gatesConfig.autoAddConfigFixStepOnHardcodedConfig,
        'configFixAdded', triggeredFlags, agents, resolveAgent,
        'Quality gates flagged hardcoded config values. Move API base URLs, ports, retry counts, timeouts, and environment-specific values into env/typed config. For Vite proxy targets, prefer import.meta.env with a safe default. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: hardcoded config detected; scheduling cleanup',
        maxCompletedStep, lastAgent,
      );
      if (configStep) addSteps.push(configStep);

      const a11yStep = buildRemediationStep(
        gatesResult.results.find(r => r.id === 'accessibility'),
        gatesConfig.autoAddAccessibilityFixStepOnAccessibility,
        'accessibilityFixAdded', triggeredFlags, agents, resolveAgent,
        'Quality gates flagged accessibility issues. Fix all items from the gate report: skip-to-content link, heading hierarchy, aria-labels, focus-visible styles, meta description + theme-color tags, responsive CSS (viewport meta, media queries or relative units), CSS custom properties on :root with prefers-color-scheme:dark override, semantic HTML landmarks (main, nav, header), img alt attributes. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: accessibility issues detected; scheduling fix',
        maxCompletedStep, lastAgent,
      );
      if (a11yStep) addSteps.push(a11yStep);

      const testCovStep = buildRemediationStep(
        gatesResult.results.find(r => r.id === 'test-coverage'),
        gatesConfig.autoAddTestCoverageStepOnTestCoverage,
        'testCoverageFixAdded', triggeredFlags, agents, resolveAgent,
        'Quality gates flagged missing test coverage. Add tests for uncovered source files, ensure each test file contains real assertions, and add component-level tests for React projects. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: test coverage gaps detected; scheduling fix',
        maxCompletedStep, lastAgent,
      );
      if (testCovStep) addSteps.push(testCovStep);

      // Consolidate multiple gate failures into a single remediation step
      // to avoid burning one premium request per gate failure.
      if (addSteps.length > 1) {
        const combinedTask = addSteps.map(s => s.task).join('\n\nALSO: ');
        const singleStep: { agent: string; task: string; afterStep?: number } = {
          agent: addSteps[0].agent,
          task: combinedTask,
        };
        if (addSteps[0].afterStep !== undefined) {
          singleStep.afterStep = addSteps[0].afterStep;
        }
        addSteps.length = 0;
        addSteps.push(singleStep);
        logger.warn(`⚠️  Final quality gates failed (${failedIds.size} gates); scheduling single consolidated remediation step...`);
      } else if (addSteps.length === 1) {
        logger.warn('⚠️  Final quality gates failed; attempting one remediation pass...');
      }

      if (addSteps.length > 0) {
        remediationAttempted = true;
        await executeReplan(context, { retrySteps: [], addSteps }, agents, options);
        gatesResult = await run_quality_gates(workingDir, gatesConfig, gatesOut, baselineFiles, baseCommit, skippedReqIds);
        context.finalGateResults = gatesResult.results;

        // Second remediation attempt if gates still fail after first fix
        if (!gatesResult.passed && gatesConfig.failOnIssues) {
          const stillFailed = gatesResult.results.filter(r => r.status === 'fail');
          if (stillFailed.length > 0) {
            const findings = stillFailed.flatMap(gate =>
              gate.issues.map(issue => {
                let desc = `[${gate.id}] ${issue.message}`;
                if (issue.filePath) desc += ` (${issue.filePath})`;
                if (issue.hint) desc += ` -- hint: ${issue.hint}`;
                return desc;
              })
            ).join('\n');

            const retryTask = [
              'The previous remediation attempt did not fully resolve the quality gate failures.',
              'The following issues remain. Fix each one specifically:',
              '',
              findings,
              '',
              'Verify your fixes by checking that the specific issues listed above are resolved.',
              'Run tests to ensure nothing is broken.',
            ].join('\n');

            const retryAgent = resolveAgent(agents, 'integrator_finalizer')
              ? 'integrator_finalizer'
              : lastAgent;
            const retryMaxStep = Math.max(...context.plan.steps.map(s => s.stepNumber));

            logger.warn('⚠️  First remediation did not resolve all gate failures. Running second attempt with specific findings...');
            await executeReplan(context, {
              retrySteps: [],
              addSteps: [{ agent: retryAgent, task: retryTask, afterStep: retryMaxStep }],
            }, agents, options);

            gatesResult = await run_quality_gates(workingDir, gatesConfig, gatesOut, baselineFiles, baseCommit, skippedReqIds);
            context.finalGateResults = gatesResult.results;
          }
        }
      }
    }

    if (!gatesResult.passed) {
      if (remediationAttempted) {
        // Remediation was attempted but couldn't fully resolve all issues.
        // Downgrade to a warning so callers can decide how to handle.
        const remaining = gatesResult.results
          .filter(r => r.status === 'fail')
          .map(r => `${r.id} (${r.issues.length} issues)`);
        logger.warn(`⚠️  Quality gates still have issues after remediation: ${remaining.join(', ')}`);
      } else {
        logger.error('❌ Quality gates failed. See report in:', gatesOut);
      }
    }
  }

  return { passed: gatesResult.passed, results: gatesResult.results };
}
