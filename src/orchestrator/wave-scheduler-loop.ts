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
import { CriticResult } from '../types';

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
  criticResults?: CriticResult[];
  leanSavedRequests?: number;
  totalWaves?: number;
}

/**
 * Options the scheduler reads and passes through to step execution.
 */
export interface SchedulerOptions {
  model?: string;
  lean?: boolean;
  governance?: boolean;
  fleetWaveMode?: boolean;
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
  runCriticReview(
    completedResults: SchedulerStepResult[],
    context: SchedulerContext,
    plan: ExecutionPlan,
  ): CriticResult;
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
  const pending = new Set(context.plan.steps.map((step) => step.stepNumber));
  const completed = new Set<number>();
  const failed = new Set<number>();
  const inFlight = new Set<number>();
  let waveCounter = 0;

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
    pending.delete(stepNumber);
    inFlight.delete(stepNumber);
    completed.add(stepNumber);
    context.adaptiveConcurrency?.recordSuccess();

    const result = context.results.find((entry) => entry.stepNumber === stepNumber);
    if (result && result.branchName && result.status === 'completed') {
      pendingMerge.push(result);
    }

    if (inFlight.size === 0 || pendingMerge.length >= 3) {
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
    pending.delete(stepNumber);
    inFlight.delete(stepNumber);
    failed.add(stepNumber);

    const isRateLimit = /rate limit|quota|429|throttle/i.test(errorMsg);
    context.adaptiveConcurrency?.recordFailure(isRateLimit ? 'rate_limit' : 'error');

    const newLimit = context.adaptiveConcurrency?.getCurrentLimit() || 3;
    context.executionQueue?.setMaxConcurrency(newLimit);

    options?.onProgress?.(context, `step-failed:${stepNumber}`);
  };

  const getReadySteps = (): number[] => {
    const ready: number[] = [];
    for (const stepNum of pending) {
      if (inFlight.has(stepNum)) continue;
      const step = context.plan.steps.find((candidate) => candidate.stepNumber === stepNum);
      if (!step) continue;
      if (step.dependencies.every((dep) => completed.has(dep))) {
        ready.push(stepNum);
      }
    }
    return ready.sort((a, b) => a - b);
  };

  while (pending.size > 0) {
    if (host.pauseController.isPauseRequested()) {
      logger.info('\n⏸️  Pause requested. Waiting for resume...');
      await host.pauseController.waitForResume();
      logger.info('\n▶️  Resuming execution...');
    }

    for (const step of context.plan.steps) {
      if (
        !pending.has(step.stepNumber) &&
        !completed.has(step.stepNumber) &&
        !failed.has(step.stepNumber) &&
        !inFlight.has(step.stepNumber)
      ) {
        pending.add(step.stepNumber);
      }
    }

    const ready = getReadySteps();

    if (ready.length === 0 && inFlight.size === 0) {
      const blocked = Array.from(pending);
      logger.error(`\n❌ ${blocked.length} step(s) blocked by failed dependencies: ${blocked.join(', ')}`);
      break;
    }

    if (ready.length > 0) {
      waveCounter++;
      context.metricsCollector?.startWave(waveCounter);
      options?.onProgress?.(context, `wave-start:${waveCounter}`);

      logger.info(`\n📊 Batch ${waveCounter}: launching ${ready.length} step(s) [${ready.join(', ')}]`);

      const batchPromises = ready.map((stepNumber) => {
        const step = context.plan.steps.find((candidate) => candidate.stepNumber === stepNumber);
        if (!step) {
          throw new Error(`Step ${stepNumber} disappeared from the active plan; rerun planning before scheduling`);
        }

        const agent = host.resolveAgent(agents, step.agentName);
        if (!agent) {
          throw new Error(`Agent ${step.agentName} not found for step ${stepNumber}`);
        }

        inFlight.add(stepNumber);

        return context.executionQueue!
          .enqueue(
            `step-${stepNumber}`,
            () => host.executeStepInSwarm(step, agent, context, options),
            {
              priority: 100 - stepNumber,
              maxRetries: 3,
              metadata: {
                stepNumber: step.stepNumber,
                agentName: agent.name,
                wave: waveCounter,
              },
            },
          )
          .then(
            () => onStepComplete(stepNumber),
            (err: Error) => onStepFailed(stepNumber, err.message),
          );
      });

      await Promise.race(batchPromises);
      await Promise.allSettled(batchPromises);

      context.queueStats = context.executionQueue!.getStats();

      const completedInBatch = context.results.filter(
        (result) => ready.includes(result.stepNumber) && result.status === 'completed',
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

  context.totalWaves = waveCounter;

  if (pendingMerge.length > 0) {
    context.contextBroker.forceReleaseStaleLocks();
    await host.mergeWaveBranches(pendingMerge, context, options);
    pendingMerge.length = 0;
  }
}
