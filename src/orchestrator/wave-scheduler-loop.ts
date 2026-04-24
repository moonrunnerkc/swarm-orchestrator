/**
 * INVARIANT: plan.steps is re-read on every iteration.
 *
 * executeReplan (replan-runner.ts) mutates context.plan by assignment
 * (context.plan = revised). This scheduler must not cache
 * context.plan, plan.steps, or any derivative (readySteps,
 * pendingSteps, blockedSteps) across iterations of the main loop.
 * Every iteration that needs plan data must read it fresh from
 * context.plan.
 *
 * Violating this invariant will cause the scheduler to operate on
 * stale step data after a replan, resulting in either:
 * (a) scheduling steps that no longer exist in the revised plan, or
 * (b) failing to schedule new steps that the replan added.
 * Both failure modes surface only in integration tests that exercise
 * replan mid-run.
 *
 * See test/wave-scheduler-replan.test.ts for the lock-in test.
 */
import * as path from 'path';
import { AgentProfile } from '../config-loader';
import FleetExecutor from '../fleet-executor';
import { KnowledgeBaseManager } from '../knowledge-base';
import MetricsCollector from '../metrics-collector';
import { ExecutionPlan, PlanStep } from '../plan-generator';
import { runAsyncMetaAnalysis as _runAsyncMetaAnalysis } from './async-meta-analysis';
import { PauseController } from './pause-controller';
import { ExecutionQueue, QueueStats } from '../execution-queue';
import { AdaptiveConcurrencyManager } from '../wave-resizer';
import { MetaAnalyzer, MetaReviewResult } from '../meta-analyzer';
import { SessionResult } from '../session-executor';
import { VerificationResult } from '../verifier-engine';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '../defaults';
import { getLogger } from '../logger';
import { CriticResult } from '../types';

const logger = getLogger('orchestrator');

/**
 * Narrow view of `ParallelStepResult` that the scheduler reads and
 * mutates. Mirrored locally so this module does not import from
 * swarm-orchestrator, which would form a circular dependency.
 * `ParallelStepResult` is assignable to this shape.
 */
export interface SchedulerStepResult {
  stepNumber: number;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  branchName?: string;
  sessionResult?: SessionResult;
  verificationResult?: VerificationResult;
  error?: string;
  startTime?: string;
  endTime?: string;
  retryCount?: number;
}

/**
 * Narrow view of `ContextBroker` methods the scheduler uses for
 * inter-step event signalling and stale-lock cleanup.
 */
export interface SchedulerContextBroker {
  forceReleaseStaleLocks(): void;
  once(event: string, handler: () => void): void;
  removeListener(event: string, handler: () => void): void;
}

/**
 * Context subset the scheduler reads and writes. Defined locally
 * (duck-typed) so this module does not import `SwarmExecutionContext`
 * from swarm-orchestrator; `SwarmExecutionContext` satisfies the
 * shape structurally.
 *
 * `plan` is re-read on every loop iteration per the invariant above.
 */
export interface SchedulerContext {
  plan: ExecutionPlan;
  results: SchedulerStepResult[];
  contextBroker: SchedulerContextBroker;
  mainBranch: string;
  executionId: string;
  runDir: string;
  startTime: string;
  metricsCollector?: MetricsCollector;
  executionQueue?: ExecutionQueue;
  queueStats?: QueueStats;
  adaptiveConcurrency?: AdaptiveConcurrencyManager;
  metaAnalyzer?: MetaAnalyzer;
  knowledgeBase?: KnowledgeBaseManager;
  waveAnalyses?: MetaReviewResult[];
  criticResults?: CriticResult[];
  leanSavedRequests?: number;
  totalWaves?: number;
}

/**
 * Options the scheduler reads, plus fields it passes through to
 * host.executeStepInSwarm and host.mergeWaveBranches. Optional
 * callbacks use method-shorthand syntax for bivariant parameter
 * behavior under `exactOptionalPropertyTypes: true`.
 */
export interface SchedulerOptions {
  model?: string;
  lean?: boolean;
  governance?: boolean;
  fleetWaveMode?: boolean;
  // Fields passed through to executeStepInSwarm:
  cliAgent?: string;
  strictIsolation?: boolean;
  useInnerFleet?: boolean;
  hooksEnabled?: boolean;
  replay?: boolean;
  confirmDeploy?: boolean;
  enableExternal?: boolean;
  dryRun?: boolean;
  onProgress?(context: SchedulerContext, event: string): void;
  onAgentLine?(line: string): void;
}

/**
 * Orchestrator surface the scheduler calls back into. Kept narrow
 * (6 members). `pauseController` is exposed directly rather than as
 * host methods so the scheduler uses `pauseController.isPauseRequested()`
 * and `pauseController.waitForResume()` directly. `runCriticReview`
 * remains on the host because `critic-reviewer.ts` imports from
 * swarm-orchestrator (pre-existing baseline cycle); calling it via
 * the host avoids extending the cycle through this module.
 */
export interface SchedulerHost {
  readonly workingDir: string;
  readonly pauseController: PauseController;
  resolveAgent(agents: Map<string, AgentProfile>, name: string): AgentProfile | undefined;
  executeStepInSwarm(
    step: PlanStep,
    agent: AgentProfile,
    context: SchedulerContext,
    options?: SchedulerOptions
  ): Promise<void>;
  mergeWaveBranches(
    completedResults: SchedulerStepResult[],
    context: SchedulerContext,
    options?: SchedulerOptions
  ): Promise<void>;
  runCriticReview(
    completedResults: SchedulerStepResult[],
    context: SchedulerContext,
    plan: ExecutionPlan
  ): CriticResult;
}

/**
 * Attempt to dispatch a batch of steps via a single /fleet prompt.
 * If fleet dispatch fails or any subtask cannot be mapped back,
 * returns false so the scheduler can fall back to subprocess mode.
 *
 * Not exported: only the scheduler's main loop needs this helper.
 */
async function attemptFleetDispatch(
  host: SchedulerHost,
  readySteps: number[],
  plan: ExecutionPlan,
  agents: Map<string, AgentProfile>,
  context: SchedulerContext,
  options?: SchedulerOptions
): Promise<boolean> {
  const fleetExecutor = new FleetExecutor(host.workingDir);

  if (!fleetExecutor.isAvailable()) {
    logger.info('  ⚠️  Fleet mode requested but copilot CLI does not support /fleet. Falling back to subprocess mode.');
    return false;
  }

  const steps = readySteps
    .map(n => plan.steps.find(s => s.stepNumber === n))
    .filter((s): s is PlanStep => s !== undefined);

  if (steps.length === 0) return false;

  logger.info(`  ⚡ [fleet] Dispatching ${steps.length} step(s) via /fleet`);

  const transcriptDir = path.join(context.runDir, 'steps');

  try {
    const waveResult = await fleetExecutor.executeWave(steps, agents, {
      model: options?.model,
      runDir: context.runDir,
      executionId: context.executionId,
      mainBranch: context.mainBranch,
      transcriptDir
    });

    if (!waveResult.success) {
      logger.info('  ⚠️  Fleet dispatch failed. Falling back to subprocess mode.');
      return false;
    }

    // Check how many subtasks completed
    const completedCount = waveResult.subtaskResults.filter(r => r.completed).length;
    const failedCount = waveResult.subtaskResults.filter(r => !r.completed).length;

    logger.info(`  ⚡ [fleet] ${completedCount} subtask(s) completed, ${failedCount} incomplete`);

    if (failedCount > 0) {
      logger.info('  ⚠️  Some fleet subtasks incomplete. Falling back to subprocess mode for all steps.');
      return false;
    }

    // Map fleet results back to step results
    for (const subtask of waveResult.subtaskResults) {
      const result: SchedulerStepResult = {
        stepNumber: subtask.stepNumber,
        agentName: subtask.agentName,
        status: subtask.completed ? 'completed' : 'failed',
        startTime: context.startTime,
        endTime: new Date().toISOString(),
        sessionResult: {
          success: subtask.completed,
          output: subtask.outputFragment,
          exitCode: subtask.completed ? 0 : 1,
          duration: waveResult.sessionResult.duration / steps.length
        }
      };
      context.results.push(result);
    }

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.info(`  ⚠️  Fleet dispatch error: ${message}. Falling back to subprocess mode.`);
    return false;
  }
}

/**
 * Run the greedy as-soon-as-ready scheduler loop: launch steps the
 * moment their dependencies are satisfied, not when an entire "wave"
 * finishes. Eliminates idle time from unbalanced step durations.
 *
 * Mutates `context.queueStats`, `context.totalWaves`,
 * `context.criticResults`, `context.leanSavedRequests`, and
 * `context.results[i].status` (indirectly via host.executeStepInSwarm).
 *
 * Applies lean-mode KB reference injection before scheduling begins.
 * Fires `onProgress` events for wave-start, wave-done, step-running,
 * step-done, and step-failed transitions. Triggers async meta-analysis
 * off the critical path when metaAnalyzer + knowledgeBase are present.
 *
 * @param host - orchestrator surface
 * @param plan - initial plan (do not cache; re-read via context.plan every iteration)
 * @param agents - available agent map
 * @param context - mutable execution context
 * @param options - scheduler options (model, lean, governance, etc.)
 */
export async function runWaveLoop(
  host: SchedulerHost,
  plan: ExecutionPlan,
  agents: Map<string, AgentProfile>,
  context: SchedulerContext,
  options?: SchedulerOptions
): Promise<void> {
  // Greedy as-soon-as-ready scheduler: launch steps the moment their deps are satisfied,
  // not when an entire "wave" finishes. Eliminates idle time from unbalanced step durations.
  const pending = new Set(context.plan.steps.map(s => s.stepNumber));
  const completed = new Set<number>();
  const failed = new Set<number>();
  const inFlight = new Set<number>();
  let waveCounter = 0;

  // Lean mode: attach knowledge base references before scheduling
  if (options?.lean && context.knowledgeBase) {
    for (const step of context.plan.steps) {
      const matches = context.knowledgeBase.findSimilarTasks(step.task);
      if (matches.length > 0) {
        const ref = matches[0];
        const commitRef = ref.evidence[0] || 'unknown';
        step.task += `\nReference: similar task completed in session ${ref.id}, commit ${commitRef}.`;
        context.leanSavedRequests = (context.leanSavedRequests || 0) + 1;
        logger.info(`  [lean] Step ${step.stepNumber}: found similar pattern "${ref.insight.slice(0, 50)}"`);
      }
    }
  }

  // Track which steps need merging once complete
  const pendingMerge: SchedulerStepResult[] = [];

  // Resolve a single step: merge its branch to main and launch newly-unblocked steps
  const onStepComplete = async (stepNumber: number) => {
    pending.delete(stepNumber);
    inFlight.delete(stepNumber);
    completed.add(stepNumber);
    context.adaptiveConcurrency?.recordSuccess();

    const result = context.results.find(r => r.stepNumber === stepNumber);
    if (result && result.branchName && result.status === 'completed') {
      pendingMerge.push(result);
    }

    // Merge completed branches in batches (octopus merge when possible)
    if (inFlight.size === 0 || pendingMerge.length >= 3) {
      if (pendingMerge.length > 0) {
        context.contextBroker.forceReleaseStaleLocks();
        await host.mergeWaveBranches(pendingMerge, context, options);
        pendingMerge.length = 0;
      }
    }

    // Fire meta-analysis asynchronously (off the critical path).
    // Re-read context.plan every fire — executeReplan may have swapped it.
    if (context.metaAnalyzer && context.knowledgeBase) {
      setImmediate(() => {
        _runAsyncMetaAnalysis(context, context.plan, context.runDir, Array.from(completed));
      });
    }

    // Notify progress
    options?.onProgress?.(context, `step-done:${stepNumber}`);
  };

  const onStepFailed = (stepNumber: number, errorMsg: string) => {
    pending.delete(stepNumber);
    inFlight.delete(stepNumber);
    failed.add(stepNumber);

    const isRateLimit = /rate limit|quota|429|throttle/i.test(errorMsg);
    context.adaptiveConcurrency?.recordFailure(isRateLimit ? 'rate_limit' : 'error');

    const newLimit = context.adaptiveConcurrency?.getCurrentLimit() || 3;
    context.executionQueue?.setMaxConcurrency(newLimit);

    options?.onProgress?.(context, `step-failed:${stepNumber}`);
  };

  // Returns step numbers whose dependencies are all satisfied.
  // Re-reads context.plan.steps every call — executeReplan may have
  // swapped context.plan while this function was not executing.
  const getReadySteps = (): number[] => {
    const ready: number[] = [];
    for (const stepNum of pending) {
      if (inFlight.has(stepNum)) continue;
      const step = context.plan.steps.find(s => s.stepNumber === stepNum);
      if (!step) continue;
      if (step.dependencies.every(dep => completed.has(dep))) {
        ready.push(stepNum);
      }
    }
    return ready.sort((a, b) => a - b);
  };

  // Main scheduling loop: keep launching ready steps until everything is done or blocked
  while (pending.size > 0) {
    // Check for pause
    if (host.pauseController.isPauseRequested()) {
      logger.info('\n⏸️  Pause requested. Waiting for resume...');
      await host.pauseController.waitForResume();
      logger.info('\n▶️  Resuming execution...');
    }

    // Pick up any steps the replan added since the last iteration.
    // context.plan may have been swapped by executeReplan; context.results
    // gets new entries for added steps. Ensure they are in `pending` if
    // not already completed/failed/inFlight.
    for (const step of context.plan.steps) {
      if (
        !pending.has(step.stepNumber)
        && !completed.has(step.stepNumber)
        && !failed.has(step.stepNumber)
        && !inFlight.has(step.stepNumber)
      ) {
        pending.add(step.stepNumber);
      }
    }

    const ready = getReadySteps();

    if (ready.length === 0 && inFlight.size === 0) {
      // Nothing ready and nothing in flight: remaining steps are blocked by failures
      const blocked = Array.from(pending);
      logger.error(`\n❌ ${blocked.length} step(s) blocked by failed dependencies: ${blocked.join(', ')}`);
      break;
    }

    if (ready.length > 0) {
      waveCounter++;
      context.metricsCollector?.startWave(waveCounter);
      options?.onProgress?.(context, `wave-start:${waveCounter}`);

      logger.info(`\n📊 Batch ${waveCounter}: launching ${ready.length} step(s) [${ready.join(', ')}]`);

      // Fleet wave mode: attempt single /fleet dispatch for the batch, fall back on failure
      let fleetHandled = false;
      if (options?.fleetWaveMode && ready.length > 1) {
        fleetHandled = await attemptFleetDispatch(host, ready, context.plan, agents, context, options);
        if (fleetHandled) {
          // All steps handled by fleet; mark them complete
          for (const stepNum of ready) {
            inFlight.add(stepNum);
            await onStepComplete(stepNum);
          }
        }
      }

      if (!fleetHandled) {
      // Launch all ready steps concurrently
      const batchPromises = ready.map(stepNumber => {
        const step = context.plan.steps.find(s => s.stepNumber === stepNumber)!;
        const agent = host.resolveAgent(agents, step.agentName);

        if (!agent) {
          throw new Error(`Agent ${step.agentName} not found for step ${stepNumber}`);
        }

        inFlight.add(stepNumber);

        return context.executionQueue!.enqueue(
          `step-${stepNumber}`,
          () => host.executeStepInSwarm(step, agent, context, options),
          {
            priority: 100 - stepNumber,
            maxRetries: 3,
            metadata: {
              stepNumber: step.stepNumber,
              agentName: agent.name,
              wave: waveCounter
            }
          }
        ).then(
          () => onStepComplete(stepNumber),
          (err: Error) => onStepFailed(stepNumber, err.message)
        );
      });

      // Wait for at least one step to finish before re-evaluating the ready set
      await Promise.race(batchPromises);

      // Settle any remaining promises that are already resolved
      await Promise.allSettled(batchPromises);
      } // end if (!fleetHandled)

      // Update queue stats
      context.queueStats = context.executionQueue!.getStats();

      // Governance: critic review on completed batch
      const completedInBatch = context.results.filter(
        r => ready.includes(r.stepNumber) && r.status === 'completed'
      );
      if (options?.governance && completedInBatch.length > 0) {
        if (!context.criticResults) context.criticResults = [];
        const criticResult = host.runCriticReview(completedInBatch, context, context.plan);
        context.criticResults.push(criticResult);
        logger.info(`  🎭 Critic score: ${criticResult.score}/100 (${criticResult.recommendation})`);
        if (criticResult.flags.length > 0) {
          logger.info(`  ⚠️  Critic flags: ${criticResult.flags.join(', ')}`);
          logger.info('  ⏸️  Governance pause: awaiting human approval...');
          host.pauseController.requestPause();
          await host.pauseController.waitForResume();
        }
      }

      options?.onProgress?.(context, `wave-done:${waveCounter}`);
    } else {
      // Steps in flight but none ready yet: wait for next completion
      await new Promise<void>(resolve => {
        const handler = () => {
          context.contextBroker.removeListener('step-completed', handler);
          resolve();
        };
        context.contextBroker.once('step-completed', handler);
        // Safety timeout in case event is missed
        setTimeout(() => {
          context.contextBroker.removeListener('step-completed', handler);
          resolve();
        }, DEFAULT_HEARTBEAT_INTERVAL_MS);
      });
    }
  }

  context.totalWaves = waveCounter;

  // Flush any remaining pending merges
  if (pendingMerge.length > 0) {
    context.contextBroker.forceReleaseStaleLocks();
    await host.mergeWaveBranches(pendingMerge, context, options);
    pendingMerge.length = 0;
  }
}
