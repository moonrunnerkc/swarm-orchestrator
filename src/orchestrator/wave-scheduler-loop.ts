/**
 * INVARIANT: plan.steps is re-read on every iteration.
 *
 * executeReplan (replan-runner.ts) mutates context.plan by assignment
 * (context.plan = revised). This scheduler must not cache context.plan,
 * plan.steps, or any derivative across iterations of the main loop.
 */
import { AgentProfile } from '../config-loader';
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
import { WorkStealingQueue } from '../scheduling/work-stealing-queue';

const logger = getLogger('orchestrator');

/**
 * Narrow view of `ParallelStepResult` that the scheduler reads and mutates.
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
 * Narrow view of `ContextBroker` methods the scheduler uses.
 */
export interface SchedulerContextBroker {
  forceReleaseStaleLocks(): void;
  once(event: string, handler: () => void): void;
  removeListener(event: string, handler: () => void): void;
}

/**
 * Context subset the scheduler reads and writes.
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
  leanSavedRequests?: number;
  totalWaves?: number;
}

/**
 * Options the scheduler reads and passes through to step execution.
 */
export interface SchedulerOptions {
  model?: string;
  lean?: boolean;
  fleetWaveMode?: boolean;
  cliAgent?: string;
  strictIsolation?: boolean;
  useInnerFleet?: boolean;
  hooksEnabled?: boolean;
  confirmDeploy?: boolean;
  enableExternal?: boolean;
  dryRun?: boolean;
  onProgress?(context: SchedulerContext, event: string): void;
  onAgentLine?(line: string): void;
}

/**
 * Orchestrator surface the scheduler calls back into.
 */
export interface SchedulerHost {
  readonly workingDir: string;
  readonly pauseController: PauseController;
  resolveAgent(agents: Map<string, AgentProfile>, name: string): AgentProfile | undefined;
  executeStepInSwarm(
    step: PlanStep,
    agent: AgentProfile,
    context: SchedulerContext,
    options?: SchedulerOptions,
  ): Promise<void>;
  mergeWaveBranches(
    completedResults: SchedulerStepResult[],
    context: SchedulerContext,
    options?: SchedulerOptions,
  ): Promise<void>;
}

/**
 * Run the greedy as-soon-as-ready scheduler loop. The custom fleet-wave executor was
 * removed for v7. Native `/fleet` pass-through remains available per step through
 * `useInnerFleet`.
 *
 * @param host - Orchestrator surface.
 * @param _plan - Initial plan, retained for API compatibility. The loop reads `context.plan`.
 * @param agents - Available agent map.
 * @param context - Mutable execution context.
 * @param options - Scheduler options.
 */
export async function runWaveLoop(
  host: SchedulerHost,
  _plan: ExecutionPlan,
  agents: Map<string, AgentProfile>,
  context: SchedulerContext,
  options?: SchedulerOptions,
): Promise<void> {
  const completed = new Set<number>();
  const scheduler = new WorkStealingQueue(context.plan, {
    maxWorkers: context.executionQueue?.getStats().maxConcurrency ?? 1,
  });
  const runningPromises = new Map<number, Promise<void>>();
  let dispatchCounter = 0;

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

  const pendingMerge: SchedulerStepResult[] = [];

  const onStepComplete = async (stepNumber: number) => {
    scheduler.markCompleted(stepNumber);
    completed.add(stepNumber);
    context.adaptiveConcurrency?.recordSuccess();

    const result = context.results.find((entry) => entry.stepNumber === stepNumber);
    if (result && result.branchName && result.status === 'completed') {
      pendingMerge.push(result);
    }

    if (scheduler.stats().running === 0 || pendingMerge.length >= 3) {
      if (pendingMerge.length > 0) {
        context.contextBroker.forceReleaseStaleLocks();
        await host.mergeWaveBranches(pendingMerge, context, options);
        pendingMerge.length = 0;
      }
    }

    if (context.metaAnalyzer && context.knowledgeBase) {
      setImmediate(() => {
        _runAsyncMetaAnalysis(context, context.plan, context.runDir, Array.from(completed));
      });
    }

    options?.onProgress?.(context, `step-done:${stepNumber}`);
  };

  const onStepFailed = (stepNumber: number, errorMsg: string) => {
    scheduler.markFailed(stepNumber);

    const isRateLimit = /rate limit|quota|429|throttle/i.test(errorMsg);
    context.adaptiveConcurrency?.recordFailure(isRateLimit ? 'rate_limit' : 'error');

    const newLimit = context.adaptiveConcurrency?.getCurrentLimit() || 3;
    context.executionQueue?.setMaxConcurrency(newLimit);
    scheduler.setMaxWorkers(newLimit);

    options?.onProgress?.(context, `step-failed:${stepNumber}`);
  };

  while (scheduler.hasPendingWork()) {
    if (host.pauseController.isPauseRequested()) {
      logger.info('\n⏸️  Pause requested. Waiting for resume...');
      await host.pauseController.waitForResume();
      logger.info('\n▶️  Resuming execution...');
    }

    scheduler.syncPlan(context.plan);
    const ready = scheduler.nextDispatches();

    if (ready.length === 0 && scheduler.isBlocked()) {
      const blocked = scheduler.blockedSteps();
      logger.error(`\n❌ ${blocked.length} step(s) blocked by failed dependencies: ${blocked.join(', ')}`);
      break;
    }

    if (ready.length > 0) {
      dispatchCounter++;
      context.metricsCollector?.startWave(dispatchCounter);
      options?.onProgress?.(context, `wave-start:${dispatchCounter}`);

      const stats = scheduler.stats();
      const label = stats.parallelEnabled ? 'parallel work-stealing' : 'linear work queue';
      logger.info(`\n📊 Batch ${dispatchCounter}: launching ${ready.length} step(s) [${ready.join(', ')}] via ${label}`);

      for (const stepNumber of ready) {
        const step = context.plan.steps.find((candidate) => candidate.stepNumber === stepNumber);
        if (!step) {
          throw new Error(`Step ${stepNumber} disappeared from the active plan; rerun planning before scheduling`);
        }

        const agent = host.resolveAgent(agents, step.agentName);
        if (!agent) {
          throw new Error(`Agent ${step.agentName} not found for step ${stepNumber}`);
        }

        scheduler.markRunning(stepNumber);

        const promise = context.executionQueue!
          .enqueue(
            `step-${stepNumber}`,
            () => host.executeStepInSwarm(step, agent, context, options),
            {
              priority: 100 - stepNumber,
              maxRetries: 3,
              metadata: {
                stepNumber: step.stepNumber,
                agentName: agent.name,
                wave: dispatchCounter,
              },
            },
          )
          .then(
            () => onStepComplete(stepNumber),
            (err: Error) => onStepFailed(stepNumber, err.message),
          )
          .finally(() => {
            runningPromises.delete(stepNumber);
          });
        runningPromises.set(stepNumber, promise);
      }

      context.queueStats = context.executionQueue!.getStats();

      options?.onProgress?.(context, `wave-done:${dispatchCounter}`);
      if (runningPromises.size > 0) {
        await Promise.race(runningPromises.values());
      }
    } else {
      await new Promise<void>((resolve) => {
        const handler = () => {
          context.contextBroker.removeListener('step-completed', handler);
          resolve();
        };
        context.contextBroker.once('step-completed', handler);
        setTimeout(() => {
          context.contextBroker.removeListener('step-completed', handler);
          resolve();
        }, DEFAULT_HEARTBEAT_INTERVAL_MS);
      });
    }
  }

  if (runningPromises.size > 0) {
    await Promise.allSettled(runningPromises.values());
  }

  context.totalWaves = dispatchCounter;

  if (pendingMerge.length > 0) {
    context.contextBroker.forceReleaseStaleLocks();
    await host.mergeWaveBranches(pendingMerge, context, options);
    pendingMerge.length = 0;
  }
}
