import * as path from 'path';
import { AgentProfile } from '../config-loader';
import { BaselineSnapshot } from '../baseline-scanner';
import { ExecutionPlan, ReplanPayload } from '../plan-generator';
import { FilteredRequirements } from '../requirement-filter';
import type { GateResult, QualityGatesConfig } from '../quality-gates';
import { run_quality_gates } from '../quality-gates';
import { SELF_IMPROVEMENT_GATE_KEYS } from '../quality-gates/registry';
import { getLogger } from '../logger';

const logger = getLogger('orchestrator');

/**
 * Narrow view of `ParallelStepResult` that the final-gates-remediation
 * pipeline reads. Mirrored locally so this module does not import from
 * swarm-orchestrator, which would form a circular dependency.
 * `ParallelStepResult` (the orchestrator's full type) is assignable to
 * this narrower shape.
 */
export interface RemediationStepResult {
  stepNumber: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
}

/**
 * Flags tracking which remediation steps have been injected during this
 * run, to prevent infinite remediation loops. Mirrors
 * `SwarmExecutionContext.qualityGatesTriggered`.
 */
export interface QualityGatesTriggeredFlags {
  duplicateRefactorAdded: boolean;
  readmeTruthAdded: boolean;
  scaffoldFixAdded: boolean;
  configFixAdded: boolean;
  accessibilityFixAdded: boolean;
  testCoverageFixAdded: boolean;
}

/**
 * Context subset the remediation pipeline reads and writes. Defined
 * locally (duck-typed) so this module does not import
 * `SwarmExecutionContext` from swarm-orchestrator; the full context is
 * structurally assignable to this shape.
 *
 * Mutated fields: `qualityGatesTriggered` (flags set by
 * `buildRemediationStep`), `finalGateResults` (overwritten after each
 * gate re-run).
 */
export interface RemediationContext {
  plan: ExecutionPlan;
  results: RemediationStepResult[];
  agents?: Map<string, AgentProfile>;
  baselineSnapshot?: BaselineSnapshot;
  filteredRequirements?: FilteredRequirements;
  qualityGatesTriggered?: QualityGatesTriggeredFlags;
  finalGateResults?: GateResult[];
}

/**
 * Options the remediation pipeline reads directly, plus fields it
 * passes through to `host.executeReplan`. Mirrors the subset of
 * `SwarmExecutionOptions` the pipeline touches.
 */
export interface RemediationOptions {
  qualityGates?: boolean;
  qualityGatesOutDir?: string;
  // Fields forwarded to executeReplan:
  model?: string;
  cliAgent?: string;
  enableExternal?: boolean;
  dryRun?: boolean;
}

/**
 * Orchestrator surface the remediation pipeline calls back into. Kept
 * narrow (4 members) so the boundary between the class and this module
 * stays auditable. `SwarmOrchestrator` implements this via its existing
 * thin-delegate methods.
 */
export interface RemediationHost {
  readonly workingDir: string;
  readonly targetMode: boolean;
  resolveAgent(agents: Map<string, AgentProfile>, name: string): AgentProfile | undefined;
  executeReplan(
    context: RemediationContext,
    replanPayload: ReplanPayload,
    agents: Map<string, AgentProfile>,
    options?: RemediationOptions
  ): Promise<void>;
}

/**
 * Descriptor for a single remediation step produced by
 * `buildRemediationStep`. Matches the shape `ReplanPayload.addSteps`
 * expects.
 */
interface RemediationStep {
  agent: string;
  task: string;
  afterStep: number;
}

/**
 * Shared auto-remediation logic for quality gate failures. Returns a
 * remediation step descriptor if the gate failed and auto-fix is both
 * enabled and not already triggered; otherwise returns null. Includes
 * specific gate findings in the task so the fix agent knows exactly
 * what to address.
 *
 * Mutates `context.qualityGatesTriggered[triggeredFlag] = true` when a
 * step is produced, to prevent re-adding the same remediation on a
 * subsequent gate-failure pass.
 *
 * @param host - orchestrator surface (used for agent resolution)
 * @param gateResult - the gate result being remediated; may be undefined if the gate didn't run
 * @param configEnabled - whether the auto-remediation is enabled in the gate config
 * @param triggeredFlag - key on `context.qualityGatesTriggered` to flip when this remediation fires
 * @param context - mutable remediation context
 * @param agents - available agent map for `resolveAgent`
 * @param taskDescription - base task text for the remediation step
 * @param warningMessage - log line emitted when the remediation is scheduled
 * @param afterStep - dependency step number for the new remediation step
 * @param fallbackAgent - agent to use when `integrator_finalizer` is not available
 * @returns remediation step descriptor, or null when no remediation should fire
 */
function buildRemediationStep(
  host: RemediationHost,
  gateResult: { status: string; issues?: Array<{ message: string; filePath?: string; hint?: string }> } | undefined,
  configEnabled: boolean,
  triggeredFlag: keyof QualityGatesTriggeredFlags,
  context: RemediationContext,
  agents: Map<string, AgentProfile>,
  taskDescription: string,
  warningMessage: string,
  afterStep: number,
  fallbackAgent: string,
): RemediationStep | null {
  if (!gateResult || gateResult.status !== 'fail') return null;
  if (!configEnabled) return null;
  if (!context.qualityGatesTriggered || context.qualityGatesTriggered[triggeredFlag]) return null;

  const preferredAgent = host.resolveAgent(agents, 'integrator_finalizer')
    ? 'integrator_finalizer'
    : fallbackAgent;

  logger.warn(warningMessage);
  context.qualityGatesTriggered[triggeredFlag] = true;

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

/**
 * Exposes `buildRemediationStep` for the thin private delegate on
 * `SwarmOrchestrator`. Tests access the class method via
 * `(orch as any).buildRemediationStep(...)` so this wrapper preserves
 * the exact call surface while keeping the module's internal helper
 * unexported.
 */
export function buildRemediationStepForDelegate(
  host: RemediationHost,
  gateResult: { status: string; issues?: Array<{ message: string; filePath?: string; hint?: string }> } | undefined,
  configEnabled: boolean,
  triggeredFlag: keyof QualityGatesTriggeredFlags,
  context: RemediationContext,
  agents: Map<string, AgentProfile>,
  taskDescription: string,
  warningMessage: string,
  afterStep: number,
  fallbackAgent: string,
): RemediationStep | null {
  return buildRemediationStep(
    host, gateResult, configEnabled, triggeredFlag, context, agents,
    taskDescription, warningMessage, afterStep, fallbackAgent,
  );
}

/**
 * Return value of `runFinalGatesPipeline`. Callers use `remediationAttempted`
 * to decide whether to downgrade a still-failing gate result to a warning
 * (when all plan steps passed but remediation couldn't clear pre-existing
 * gaps).
 */
export interface FinalGatesPipelineResult {
  finalGateResults: GateResult[];
  remediationAttempted: boolean;
  passed: boolean;
  gatesOut: string;
}

/**
 * Run the final quality gates pass and, if the gates fail with
 * auto-fixable findings, schedule remediation replan(s) until either
 * the gates pass or the auto-fix budget is exhausted.
 *
 * Behavior mirrors the inline block previously at
 * swarm-orchestrator.ts:700-907 exactly. Preserves the
 * gate-replan-gate-replan-gate ordering. Mutates
 * `context.finalGateResults` after each gate run and
 * `context.qualityGatesTriggered` when remediation fires.
 *
 * @param host - orchestrator surface providing workingDir, targetMode,
 *   resolveAgent, and executeReplan
 * @param context - mutable remediation context
 * @param runDir - run directory used to resolve the gate output path
 * @param agents - fallback agent map (used when `context.agents` is not set)
 * @param gatesConfig - cached quality gates config
 * @param options - orchestrator options (qualityGates, qualityGatesOutDir, plus pass-through for replan)
 * @returns pipeline outcome including the final gate results, whether
 *   any remediation was attempted, and the gate output directory
 */
export async function runFinalGatesPipeline(
  host: RemediationHost,
  context: RemediationContext,
  runDir: string,
  agents: Map<string, AgentProfile>,
  gatesConfig: QualityGatesConfig,
  options: RemediationOptions | undefined,
): Promise<FinalGatesPipelineResult> {
  logger.info('\n🧪 Running final quality gates...');
  const gatesOut = options?.qualityGatesOutDir
    ? path.isAbsolute(options.qualityGatesOutDir)
      ? options.qualityGatesOutDir
      : path.join(runDir, options.qualityGatesOutDir)
    : path.join(runDir, 'quality-gates');

  // Reuse cached gatesConfig from top of executeSwarm.
  // Pass baseline so gates only flag issues on agent-created files,
  // not pre-existing project code the agents weren't asked to change.
  const baselineFiles = context.baselineSnapshot
    ? new Set(context.baselineSnapshot.allFiles)
    : undefined;
  const baseCommit = context.baselineSnapshot?.headCommit || undefined;
  const skippedReqIds = context.filteredRequirements
    ? new Set(context.filteredRequirements.skipped.map(r => r.id))
    : undefined;
  // targetMode: skip orchestrator-internal self-improvement gates when
  // we're operating on an external repo. Universal gates
  // (hardcodedConfig, testFileProtection) continue to fire. See
  // registry.ts for the classification rationale.
  const skippedGateKeys = host.targetMode ? SELF_IMPROVEMENT_GATE_KEYS : undefined;
  let gatesResult = await run_quality_gates(
    host.workingDir, gatesConfig, gatesOut, baselineFiles, baseCommit,
    skippedReqIds, skippedGateKeys,
  );
  context.finalGateResults = gatesResult.results;

  let remediationAttempted = false;

  if (!gatesResult.passed && gatesConfig.failOnIssues) {
    const failedIds = new Set(gatesResult.results.filter(r => r.status === 'fail').map(r => r.id));
    const agentMap = context.agents || agents;

    const canAutoFix = !!context.qualityGatesTriggered && (
      (failedIds.has('duplicate-blocks') && gatesConfig.autoAddRefactorStepOnDuplicateBlocks && !context.qualityGatesTriggered.duplicateRefactorAdded) ||
      (failedIds.has('readme-claims') && gatesConfig.autoAddReadmeTruthStepOnReadmeClaims && !context.qualityGatesTriggered.readmeTruthAdded) ||
      (failedIds.has('scaffold-defaults') && gatesConfig.autoAddScaffoldFixStepOnScaffoldDefaults && !context.qualityGatesTriggered.scaffoldFixAdded) ||
      (failedIds.has('hardcoded-config') && gatesConfig.autoAddConfigFixStepOnHardcodedConfig && !context.qualityGatesTriggered.configFixAdded) ||
      (failedIds.has('accessibility') && gatesConfig.autoAddAccessibilityFixStepOnAccessibility && !context.qualityGatesTriggered.accessibilityFixAdded) ||
      (failedIds.has('test-coverage') && gatesConfig.autoAddTestCoverageStepOnTestCoverage && !context.qualityGatesTriggered.testCoverageFixAdded)
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

      const addSteps: RemediationStep[] = [];

      const dupStep = buildRemediationStep(
        host,
        gatesResult.results.find(r => r.id === 'duplicate-blocks'),
        gatesConfig.autoAddRefactorStepOnDuplicateBlocks,
        'duplicateRefactorAdded', context, agentMap,
        'Quality gates flagged repeated code blocks. Extract shared utilities/hooks/middleware and refactor duplicates away. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: duplicate blocks detected; scheduling refactor',
        maxCompletedStep, lastAgent,
      );
      if (dupStep) addSteps.push(dupStep);

      const readmeStep = buildRemediationStep(
        host,
        gatesResult.results.find(r => r.id === 'readme-claims'),
        gatesConfig.autoAddReadmeTruthStepOnReadmeClaims,
        'readmeTruthAdded', context, agentMap,
        'Quality gates flagged README claims that are not backed by code. Either implement the missing features or downgrade/remove the claims. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: README claims mismatch; scheduling truth step',
        maxCompletedStep, lastAgent,
      );
      if (readmeStep) addSteps.push(readmeStep);

      const scaffoldStep = buildRemediationStep(
        host,
        gatesResult.results.find(r => r.id === 'scaffold-defaults'),
        gatesConfig.autoAddScaffoldFixStepOnScaffoldDefaults,
        'scaffoldFixAdded', context, agentMap,
        'Quality gates flagged scaffold defaults. Remove placeholder assets and generic scaffold README sections, and ensure HTML title/app metadata are meaningful. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: scaffold defaults detected; scheduling cleanup',
        maxCompletedStep, lastAgent,
      );
      if (scaffoldStep) addSteps.push(scaffoldStep);

      const configStep = buildRemediationStep(
        host,
        gatesResult.results.find(r => r.id === 'hardcoded-config'),
        gatesConfig.autoAddConfigFixStepOnHardcodedConfig,
        'configFixAdded', context, agentMap,
        'Quality gates flagged hardcoded config values. Move API base URLs, ports, retry counts, timeouts, and environment-specific values into env/typed config. For Vite proxy targets, prefer import.meta.env with a safe default. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: hardcoded config detected; scheduling cleanup',
        maxCompletedStep, lastAgent,
      );
      if (configStep) addSteps.push(configStep);

      const a11yStep = buildRemediationStep(
        host,
        gatesResult.results.find(r => r.id === 'accessibility'),
        gatesConfig.autoAddAccessibilityFixStepOnAccessibility,
        'accessibilityFixAdded', context, agentMap,
        'Quality gates flagged accessibility issues. Fix all items from the gate report: skip-to-content link, heading hierarchy, aria-labels, focus-visible styles, meta description + theme-color tags, responsive CSS (viewport meta, media queries or relative units), CSS custom properties on :root with prefers-color-scheme:dark override, semantic HTML landmarks (main, nav, header), img alt attributes. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
        '⚠️  Final quality gates: accessibility issues detected; scheduling fix',
        maxCompletedStep, lastAgent,
      );
      if (a11yStep) addSteps.push(a11yStep);

      const testCovStep = buildRemediationStep(
        host,
        gatesResult.results.find(r => r.id === 'test-coverage'),
        gatesConfig.autoAddTestCoverageStepOnTestCoverage,
        'testCoverageFixAdded', context, agentMap,
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
        addSteps.push(singleStep as RemediationStep);
        logger.warn(`⚠️  Final quality gates failed (${failedIds.size} gates); scheduling single consolidated remediation step...`);
      } else if (addSteps.length === 1) {
        logger.warn('⚠️  Final quality gates failed; attempting one remediation pass...');
      }

      if (addSteps.length > 0) {
        remediationAttempted = true;
        await host.executeReplan(context, { retrySteps: [], addSteps }, agentMap, options);
        gatesResult = await run_quality_gates(
          host.workingDir, gatesConfig, gatesOut, baselineFiles, baseCommit,
          skippedReqIds, skippedGateKeys,
        );
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

            const retryAgent = host.resolveAgent(agentMap, 'integrator_finalizer')
              ? 'integrator_finalizer'
              : lastAgent;
            const retryMaxStep = Math.max(...context.plan.steps.map(s => s.stepNumber));

            logger.warn('⚠️  First remediation did not resolve all gate failures. Running second attempt with specific findings...');
            await host.executeReplan(context, {
              retrySteps: [],
              addSteps: [{ agent: retryAgent, task: retryTask, afterStep: retryMaxStep }]
            }, agentMap, options);

            gatesResult = await run_quality_gates(
              host.workingDir, gatesConfig, gatesOut, baselineFiles, baseCommit,
              skippedReqIds, skippedGateKeys,
            );
            context.finalGateResults = gatesResult.results;
          }
        }
      }
    }
  }

  return {
    finalGateResults: gatesResult.results,
    remediationAttempted,
    passed: gatesResult.passed,
    gatesOut,
  };
}
