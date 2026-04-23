import * as fs from 'fs';
import * as path from 'path';
import { AgentProfile } from '../config-loader';
import { ExecutionPlan, PlanGenerator, PlanStep, ReplanPayload } from '../plan-generator';
import RepairAgent, { RepairContext } from '../repair-agent';
import { SessionOptions } from '../session-executor';
import { VerificationResult } from '../verifier-engine';
import { getLogger } from '../logger';

const logger = getLogger('orchestrator');

/**
 * Narrow view of `ParallelStepResult` that executeReplan reads and
 * mutates. Defined locally so this module does not import
 * `ParallelStepResult` from swarm-orchestrator, which would form a
 * circular dependency. `ParallelStepResult` is assignable to this shape.
 */
export interface ReplanStepResult {
  stepNumber: number;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  branchName?: string;
  verificationResult?: VerificationResult;
  retryCount?: number;
  error?: string;
  sessionResult?: unknown;
  endTime?: string;
}

/**
 * Narrow view of `ReplanState` — matches swarm-orchestrator's shape
 * without importing the interface (which would cycle).
 */
export interface ReplanStateLike {
  triggeredAt: string;
  payload: ReplanPayload;
  retryBranches: Map<number, string[]>;
}

/**
 * Narrow view of `KnowledgeBaseManager` used by executeReplan — only
 * the pattern-write method.
 */
export interface ReplanKnowledgeBaseLike {
  addOrUpdatePattern(pattern: {
    category: string;
    insight: string;
    confidence: string;
    evidence: string[];
    impact: string;
  }): void;
}

/**
 * Narrow view of `ContextBroker` — only the lock-release method
 * executeReplan calls.
 */
export interface ReplanContextBrokerLike {
  forceReleaseStaleLocks(): void;
}

/**
 * Context subset executeReplan reads and writes. Defined locally
 * (duck-typed) so this module does not import `SwarmExecutionContext`
 * from swarm-orchestrator; the full context is structurally assignable
 * to this shape.
 *
 * `plan` is REASSIGNED by this function (see `context.plan = revised`
 * below). Any caller that cached `context.plan` or its derivatives
 * before invoking executeReplan is holding a stale reference.
 */
export interface ReplanContext {
  plan: ExecutionPlan;
  results: ReplanStepResult[];
  replanState?: ReplanStateLike;
  knowledgeBase?: ReplanKnowledgeBaseLike;
  contextBroker: ReplanContextBrokerLike;
  mainBranch: string;
  executionId: string;
  runDir: string;
}

/**
 * Options the replan loop reads directly, plus fields it passes
 * through to `host.executeStepInSwarm` and `host.mergeWaveBranches`.
 * Mirrors the subset of `SwarmExecutionOptions` replan touches.
 */
export interface ReplanOptions {
  model?: string;
  // Method-shorthand form (not arrow property) so parameter types are
  // bivariant, letting callers pass a SwarmExecutionOptions whose
  // onProgress takes the wider SwarmExecutionContext.
  onProgress?(context: ReplanContext, event: string): void;
}

/**
 * Orchestrator surface executeReplan calls back into. Kept narrow
 * (6 members) so the boundary between the class and this module
 * stays auditable. `SwarmOrchestrator` implements this via its
 * existing thin-delegate methods.
 */
export interface ReplanHost {
  readonly workingDir: string;
  resolveAgent(agents: Map<string, AgentProfile>, name: string): AgentProfile | undefined;
  switchBranch(branchName: string): Promise<void>;
  createAgentBranch(branchName: string, fromBranch: string): Promise<void>;
  executeStepInSwarm(
    step: PlanStep,
    agent: AgentProfile,
    context: ReplanContext,
    options?: ReplanOptions
  ): Promise<void>;
  mergeWaveBranches(
    completedResults: ReplanStepResult[],
    context: ReplanContext,
    options?: ReplanOptions
  ): Promise<void>;
}

/**
 * WARNING: This function mutates context.plan by assignment.
 *
 * After executeReplan returns, context.plan points to a different
 * ExecutionPlan object than it did before the call. Any code that
 * cached context.plan or context.plan.steps before the call is
 * now holding a stale reference.
 *
 * The wave scheduler (wave-scheduler-loop.ts) handles this by
 * re-reading context.plan.steps on every loop iteration. Do not
 * change this function's mutation behavior without updating the
 * scheduler's invariant comment and test.
 *
 * Behavior: retries failed steps on new branches with a "-retryN"
 * suffix (preserving completed work), then appends and runs any
 * `replanPayload.addSteps`, finally merging their successful
 * branches to main so subsequent quality-gate re-checks see the
 * remediation changes.
 *
 * @param host - orchestrator surface providing workingDir, resolveAgent,
 *   switchBranch, createAgentBranch, executeStepInSwarm, mergeWaveBranches
 * @param context - mutable replan context; `context.plan` may be reassigned
 * @param replanPayload - retries and add-steps to execute
 * @param agents - available agent map
 * @param options - orchestrator options (model, onProgress)
 */
export async function executeReplan(
  host: ReplanHost,
  context: ReplanContext,
  replanPayload: ReplanPayload,
  agents: Map<string, AgentProfile>,
  options?: ReplanOptions
): Promise<void> {
  logger.info('\n🔄 Executing replan...');

  // initialize replan state
  context.replanState = {
    triggeredAt: new Date().toISOString(),
    payload: replanPayload,
    retryBranches: new Map()
  };

  // update knowledge base with replan event
  context.knowledgeBase?.addOrUpdatePattern({
    category: 'failure_mode',
    insight: `replan triggered for steps: ${replanPayload.retrySteps.join(', ')}`,
    confidence: 'high',
    evidence: [`replan at ${context.replanState.triggeredAt}`],
    impact: 'medium'
  });

  // execute retries for each failed step using the repair agent
  for (const stepNumber of replanPayload.retrySteps) {
    const step = context.plan.steps.find(s => s.stepNumber === stepNumber);
    if (!step) {
      logger.warn(`  replan: step ${stepNumber} not found, skipping`);
      continue;
    }

    const agent = host.resolveAgent(agents, step.agentName);
    if (!agent) {
      logger.warn(`  replan: agent ${step.agentName} not found, skipping`);
      continue;
    }

    // get current retry count
    const resultIndex = context.results.findIndex(r => r.stepNumber === stepNumber);
    const result = context.results[resultIndex];
    const retryCount = (result?.retryCount || 0) + 1;

    // max 3 retries to avoid infinite loops
    if (retryCount > 3) {
      logger.error(`  step ${stepNumber} exceeded max retries (3), skipping`);
      continue;
    }

    logger.info(`  🔧 Spawning repair agent for step ${stepNumber} (${agent.name}) - attempt ${retryCount}`);

    // create retry branch with suffix
    const retryBranchName = `swarm/${context.executionId}/step-${stepNumber}-${agent.name.toLowerCase()}-retry${retryCount}`;

    // track retry branch
    if (!context.replanState.retryBranches.has(stepNumber)) {
      context.replanState.retryBranches.set(stepNumber, []);
    }
    context.replanState.retryBranches.get(stepNumber)!.push(retryBranchName);

    // reset result status
    if (result) {
      result.status = 'pending';
      result.retryCount = retryCount;
      result.branchName = retryBranchName;
      delete result.error;
      delete result.sessionResult;
      delete result.verificationResult;
    }

    try {
      // switch to main branch before creating retry branch
      await host.switchBranch(context.mainBranch);
      await host.createAgentBranch(retryBranchName, context.mainBranch);

      // Build repair context from the failed step's results
      const stepDir = path.join(context.runDir, 'steps', `step-${stepNumber}`);
      const transcriptPath = path.join(stepDir, 'share.md');
      const verificationReportPath = path.join(
        context.runDir, 'verification', `step-${stepNumber}-verification.md`
      );

      const failedChecks: string[] = [];
      let rootCause = 'Verification checks failed';
      if (result?.verificationResult) {
        const repairAgentHelper = new RepairAgent(host.workingDir);
        const extracted = repairAgentHelper.extractFailedChecks(result.verificationResult);
        failedChecks.push(...extracted);

        // Derive root cause from check types (includes outcome-based checks)
        const hasTestFailure = result.verificationResult.checks.some(c => !c.passed && (c.type === 'test' || c.type === 'test_exec'));
        const hasBuildFailure = result.verificationResult.checks.some(c => !c.passed && (c.type === 'build' || c.type === 'build_exec'));
        const hasCommitFailure = result.verificationResult.checks.some(c => !c.passed && c.type === 'commit');
        const hasNoDiff = result.verificationResult.checks.some(c => !c.passed && c.type === 'git_diff');
        const hasMissingFiles = result.verificationResult.checks.some(c => !c.passed && c.type === 'file_existence');
        if (hasMissingFiles) rootCause = 'Expected files were not created';
        else if (hasTestFailure) rootCause = 'Tests not executed or failed';
        else if (hasBuildFailure) rootCause = 'Build not executed or failed';
        else if (hasNoDiff) rootCause = 'Agent made no code changes';
        else if (hasCommitFailure) rootCause = 'No commits made';
      }

      const repairContext: RepairContext = {
        stepNumber,
        agentName: agent.name,
        originalTask: step.task,
        transcriptPath,
        verificationReportPath,
        branchName: retryBranchName,
        failedChecks,
        rootCause,
        retryCount,
        failureContext: result.verificationResult?.failureContext,
      };

      const repairAgent = new RepairAgent(host.workingDir, 3);
      const sessionOpts: SessionOptions = {
        allowAllTools: true,
        ...(options?.model && { model: options.model })
      };

      const repairResult = await repairAgent.attemptRepair(
        repairContext,
        sessionOpts,
        {
          requireTests: /\b(test suite|unit test|integration test|e2e test|write tests)\b/i.test(step.task),
          requireBuild: /\b(npm build|run build|compile|bundle|webpack)\b/i.test(step.task),
          requireCommits: false
        }
      );

      // Log repair cost
      logger.info(`  📊 Repair cost: ~${repairResult.estimatedTokenCost} tokens, ${repairResult.attempts} attempt(s), ${Math.round(repairResult.totalDurationMs / 1000)}s`);

      // Save repair result to run directory
      const repairResultPath = path.join(context.runDir, `repair-step-${stepNumber}.json`);
      fs.writeFileSync(repairResultPath, JSON.stringify(repairResult, null, 2), 'utf8');

      if (repairResult.success) {
        if (result) {
          result.status = 'completed';
          result.endTime = new Date().toISOString();
        }
        logger.info(`  ✅ Repair succeeded for step ${stepNumber} after ${repairResult.attempts} attempt(s)`);
      } else {
        // Repair failed - fall back to standard re-execution as last resort
        logger.warn(`  ⚠️  Repair agent failed; falling back to full re-execution for step ${stepNumber}`);
        const retryStep = { ...step, task: `[RETRY ${retryCount}] ${step.task}` };
        await host.executeStepInSwarm(retryStep, agent, context, options);
        logger.info(`  ✅ Fallback retry succeeded for step ${stepNumber}`);
      }
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`  ❌ Retry ${retryCount} failed for step ${stepNumber}: ${err.message}`);
    }
  }

  // append and execute any new steps
  if (replanPayload.addSteps && replanPayload.addSteps.length > 0) {
    const generator = new PlanGenerator(Array.from(agents.values()));

    const completed = context.results.filter(r => r.status === 'completed').map(r => r.stepNumber);
    const revised = generator.revisePlan(context.plan, replanPayload, completed);

    const oldMax = Math.max(...context.plan.steps.map(s => s.stepNumber));
    const newSteps = revised.steps.filter((s: PlanStep) => s.stepNumber > oldMax);

    context.plan = revised;
    for (const s of newSteps) {
      context.results.push({
        stepNumber: s.stepNumber,
        agentName: s.agentName,
        status: 'pending'
      });
    }

    logger.info(`  ➕ Replan added ${newSteps.length} new step(s)`);

    // Notify dashboard immediately so totalSteps and progress bar update
    // before the replan steps start executing
    options?.onProgress?.(context, `replan-added:${newSteps.length}`);

    // Execute added steps in parallel when they have no mutual dependencies
    const replanPromises = newSteps.map(async (added: PlanStep) => {
      const agent = host.resolveAgent(agents, added.agentName);
      if (!agent) {
        logger.warn(`  replan: agent ${added.agentName} not found for step ${added.stepNumber}, skipping`);
        return;
      }

      logger.info(`  🧩 Executing added step ${added.stepNumber} (${agent.name})`);
      try {
        await host.executeStepInSwarm(added, agent, context, options);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`  ❌ Replan step ${added.stepNumber} failed: ${msg}`);
      }
    });
    await Promise.allSettled(replanPromises);

    // Merge completed replan branches to main so quality gate re-checks
    // see the remediation changes. Without this, replan work stays on
    // unmerged branches and gate re-runs read stale code.
    const completedReplan = newSteps
      .map(s => context.results.find(r => r.stepNumber === s.stepNumber))
      .filter((r): r is ReplanStepResult =>
        !!r && r.status === 'completed' && !!r.branchName
      );
    if (completedReplan.length > 0) {
      context.contextBroker.forceReleaseStaleLocks();
      await host.mergeWaveBranches(completedReplan, context, options);
    }
  }

  // save replan state to run directory
  const replanPath = path.join(context.runDir, 'replan-state.json');
  fs.writeFileSync(replanPath, JSON.stringify({
    ...context.replanState,
    retryBranches: Object.fromEntries(context.replanState.retryBranches)
  }, null, 2), 'utf8');

  logger.info('  📝 Replan state saved');
}
