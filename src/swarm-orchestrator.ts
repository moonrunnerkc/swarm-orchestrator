import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { resolveAdapter, defaultModelForAdapter, AgentSpawnOptions } from './adapters';
import AnalyticsLog from './analytics-log';
import { AgentProfile, ConfigLoader } from './config-loader';
import ContextBroker, { ContextEntry } from './context-broker';
import DeploymentManager, { DeploymentMetadata } from './deployment-manager';
import { ExecutionQueue, QueueStats } from './execution-queue';
import ExternalToolManager from './external-tool-manager';
import { KnowledgeBaseManager } from './knowledge-base';
import { MetaAnalyzer, MetaReviewResult } from './meta-analyzer';
import MetricsCollector from './metrics-collector';
import { ExecutionPlan, PlanGenerator, PlanStep, ReplanPayload } from './plan-generator';
import PRAutomation from './pr-automation';
import { load_quality_gates_config, run_quality_gates } from './quality-gates';
import { SELF_IMPROVEMENT_GATE_KEYS } from './quality-gates/registry';
import type { GateResult } from './quality-gates';
import RepairAgent, { RepairContext } from './repair-agent';
import SessionExecutor, { SessionOptions, SessionResult } from './session-executor';
import ShareParser, { ShareIndex } from './share-parser';
import { Spinner } from './spinner';
import { CriticResult, SessionState } from './types';
import VerifierEngine, { VerificationResult } from './verifier-engine';
import { AdaptiveConcurrencyManager, WaveResizer } from './wave-resizer';
import { CostEstimator, CostEstimate } from './cost-estimator';
import { HookGenerator, GeneratedHooks } from './hook-generator';
import FleetExecutor from './fleet-executor';
import { CostAttribution, CostHistoryEvidence, StepCostRecord } from './metrics-types';
import PRManager from './pr-manager';
import { WorktreeManager } from './worktree-manager';
import { gitPathspecExcludes } from './worktree-reserved-paths';
import { BranchMerger, MergeContext } from './branch-merger';
import { BaselineSnapshot, scanBaseline } from './baseline-scanner';
import { TaskClassifier } from './task-classifier';
import { TIER_MAPS } from './tier-maps';
import { RequirementFilter, FilteredRequirements } from './requirement-filter';
import {
  DEFAULT_DEPENDENCY_WAIT_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from './defaults';
import { getLogger, isPrettyMode } from './logger';
import { buildSwarmPrompt as _buildSwarmPrompt, writeSharedInstructions as _writeSharedInstructions } from './prompt-builder';
import { buildDependencyGraph as _buildDependencyGraph, identifyExecutionWaves as _identifyExecutionWaves } from './wave-scheduler';
import { runCriticReview as _runCriticReview } from './critic-reviewer';
import { executeOptionalDeployment as _executeOptionalDeployment } from './deployment-handler';
import { analyzeCommitQuality as _analyzeCommitQuality } from './commit-quality-analyzer';

const logger = getLogger('orchestrator');

export interface ParallelStepResult {
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

// tracks replan execution state
export interface ReplanState {
  triggeredAt: string;
  payload: ReplanPayload;
  retryBranches: Map<number, string[]>;
}

// Single source of truth for the options object threaded through executeSwarm,
// executeReplan, executeStepInSwarm, and related methods.
export interface SwarmExecutionOptions {
  model?: string;
  maxConcurrency?: number;
  enableExternal?: boolean;
  confirmDeploy?: boolean;
  dryRun?: boolean;
  autoPR?: boolean;
  qualityGates?: boolean;
  qualityGatesConfigPath?: string;
  qualityGatesOutDir?: string;
  strictIsolation?: boolean;
  governance?: boolean;
  lean?: boolean;
  useInnerFleet?: boolean;
  replay?: boolean;
  prMode?: 'auto' | 'review';
  hooksEnabled?: boolean;
  fleetWaveMode?: boolean;
  cliAgent?: string;
  owaspReport?: boolean;
  teamSize?: number;
  onProgress?: (context: SwarmExecutionContext, event: string) => void;
  onAgentLine?: (line: string) => void;
}

export interface SwarmExecutionContext {
  plan: ExecutionPlan;
  runDir: string;
  executionId: string;
  startTime: string;
  results: ParallelStepResult[];
  contextBroker: ContextBroker;
  mainBranch: string;
  deployments?: DeploymentMetadata[];
  metricsCollector?: MetricsCollector;
  executionQueue?: ExecutionQueue;
  queueStats?: QueueStats;
  waveResizer?: WaveResizer;
  adaptiveConcurrency?: AdaptiveConcurrencyManager;
  knowledgeBase?: KnowledgeBaseManager;
  metaAnalyzer?: MetaAnalyzer;
  waveAnalyses?: MetaReviewResult[];
  replanState?: ReplanState;
  agents?: Map<string, AgentProfile>;
  qualityGatesTriggered?: {
    duplicateRefactorAdded: boolean;
    readmeTruthAdded: boolean;
    scaffoldFixAdded: boolean;
    configFixAdded: boolean;
    accessibilityFixAdded: boolean;
    testCoverageFixAdded: boolean;
  };
  criticResults?: CriticResult[];
  leanSavedRequests?: number;
  totalWaves?: number;
  costEstimator?: CostEstimator;
  costEstimate?: CostEstimate;
  stepCostRecords?: StepCostRecord[];
  prManager?: PRManager;
  prUrls?: Map<number, string>;
  finalGateResults?: GateResult[];
  unmergedBranches?: Array<{
    stepNumber: number;
    branchName: string;
    agentName: string;
    reason: string;
  }>;
  baselineSnapshot?: BaselineSnapshot;
  filteredRequirements?: FilteredRequirements;
}

/**
 * Swarm Orchestrator - coordinates parallel execution of independent Copilot CLI sessions
 * Manages concurrent sessions, per-agent branches, and automatic merging
 */
export class SwarmOrchestrator {
  private sessionExecutor: SessionExecutor;
  private shareParser: ShareParser;
  private verifier: VerifierEngine;
  private workingDir: string;
  private worktreeManager: WorktreeManager;
  private branchMerger: BranchMerger;
  private pauseRequested: boolean = false;
  private resumeRequested: boolean = false;

  /**
   * `targetMode` is true when the orchestrator is operating on an external
   * target repo (e.g. `swarm bootstrap ./external-repo`, the SWE-bench
   * harness). False when operating on its own codebase (self-improvement
   * runs). Structural signal, not keyword-based: the caller passes a
   * truthy `workingDir` that is not the orchestrator's own cwd, and the
   * CLI dispatcher sets `targetMode = true` at that boundary.
   *
   * Drives two behaviors:
   *   1. Orchestrator-internal quality gates (scaffoldDefaults,
   *      duplicateBlocks, readmeClaims, testIsolation, runtimeChecks,
   *      accessibility, testCoverage) are skipped when targetMode is
   *      true — those enforce conventions on the orchestrator's own
   *      generated code, not on arbitrary target repos. See #27 Phase-4a
   *      smoke4 for the failure mode this prevents.
   *   2. Verifier per-step outcome checks (git_diff, file_existence,
   *      build_exec, test_exec) are NOT affected by targetMode. Those
   *      are the orchestrator's verification contract for detecting
   *      agent lies about their own work, and apply universally.
   */
  private targetMode: boolean;

  constructor(workingDir?: string, targetMode: boolean = false) {
    this.workingDir = workingDir || process.cwd();
    this.targetMode = targetMode;
    this.sessionExecutor = new SessionExecutor(this.workingDir);
    this.shareParser = new ShareParser();
    this.verifier = new VerifierEngine(this.workingDir);
    this.worktreeManager = new WorktreeManager(this.workingDir);
    this.branchMerger = new BranchMerger(this.workingDir, this.worktreeManager);
  }

  /**
   * Look up an agent by name, falling back to normalized (snake_case) matching.
   * Handles plans using snake_case (frontend_expert) against YAML agents (FrontendExpert).
   */
  private resolveAgent(agents: Map<string, AgentProfile>, name: string): AgentProfile | undefined {
    const exact = agents.get(name);
    if (exact) return exact;
    const normalized = ConfigLoader.normalizeAgentName(name);
    for (const [key, agent] of agents) {
      if (ConfigLoader.normalizeAgentName(key) === normalized) return agent;
    }
    return undefined;
  }

  /**
   * Request pause of current execution
   */
  requestPause(): void {
    this.pauseRequested = true;
  }

  /**
   * Request resume of paused execution
   */
  requestResume(): void {
    this.resumeRequested = true;
    this.pauseRequested = false;
  }

  /**
   * Check if pause is requested
   */
  isPauseRequested(): boolean {
    return this.pauseRequested;
  }

  /**
   * Initialize swarm execution context
   */
  initializeSwarmExecution(
    plan: ExecutionPlan,
    runDir: string,
    maxConcurrency?: number
  ): SwarmExecutionContext {
    const executionId = this.generateExecutionId();
    const contextBroker = new ContextBroker(runDir);
    const metricsCollector = new MetricsCollector(executionId, plan.goal);

    // ensure repo has at least one commit (required for branch creation)
    this.ensureInitialCommit();

    // resolve the integration branch: prefer origin/HEAD's symbolic ref (so repos
    // whose default is `master` or `trunk` work), fall back to the currently
    // checked-out branch, then fall back to 'main'. See worktree-manager
    // .resolveDefaultBranch() for the rationale.
    const mainBranch = this.worktreeManager.resolveDefaultBranch();
    let baseCommitSha: string | undefined;
    try {
      baseCommitSha = execSync('git rev-parse HEAD', {
        cwd: this.workingDir, encoding: 'utf8', stdio: 'pipe'
      }).trim();
    } catch {
      // fresh repo with no commits yet
    }

    // initialize scalability components
    const concurrencyLimit = maxConcurrency || 3;
    const executionQueue = new ExecutionQueue(concurrencyLimit);
    const waveResizer = new WaveResizer();
    const adaptiveConcurrency = new AdaptiveConcurrencyManager(concurrencyLimit, 10);

    // initialize adaptive intelligence components
    // save knowledge base in run dir, not target repo (avoids git checkout conflicts)
    const knowledgeBase = new KnowledgeBaseManager(runDir);
    const metaAnalyzer = new MetaAnalyzer();

    const context: SwarmExecutionContext = {
      plan,
      runDir,
      executionId,
      startTime: new Date().toISOString(),
      results: plan.steps.map(step => ({
        stepNumber: step.stepNumber,
        agentName: step.agentName,
        status: 'pending'
      })),
      contextBroker,
      mainBranch,
      ...(baseCommitSha ? { baseCommitSha } : {}),
      metricsCollector,
      executionQueue,
      queueStats: executionQueue.getStats(),
      waveResizer,
      adaptiveConcurrency,
      knowledgeBase,
      metaAnalyzer,
      waveAnalyses: []
    };

    return context;
  }

  /**
   * Execute plan with parallel swarm - independent steps run concurrently
   */
  async executeSwarm(
    plan: ExecutionPlan,
    agents: Map<string, AgentProfile>,
    runDir: string,
    options?: SwarmExecutionOptions
  ): Promise<SwarmExecutionContext> {
    const context = this.initializeSwarmExecution(plan, runDir, options?.maxConcurrency);

    // Sanitize git state before starting. Previous crashed runs may have left
    // unmerged files, staged changes, or an in-progress merge that would block
    // branch creation, worktree setup, and post-step merge operations.
    this.sanitizeGitState();

    context.agents = agents;
    context.qualityGatesTriggered = {
      duplicateRefactorAdded: false,
      readmeTruthAdded: false,
      scaffoldFixAdded: false,
      configFixAdded: false,
      accessibilityFixAdded: false,
      testCoverageFixAdded: false
    };

    // Initialize PR manager when --pr mode is set
    if (options?.prMode) {
      const prManager = new PRManager(this.workingDir);
      if (!prManager.isGhAvailable()) {
        logger.error('  ❌ --pr requires gh CLI installed and authenticated. Run "gh auth login" first.');
        process.exit(1);
      }
      context.prManager = prManager;
      context.prUrls = new Map();
    }

    // Verbose execution-header block: useful for real runs, noisy for demos.
    if (!isPrettyMode()) {
      logger.info('\n🚀 Starting Parallel Swarm Execution');
      logger.info(`${'─'.repeat(50)}`);
      logger.info(`  Execution ID:    ${context.executionId}`);
      logger.info(`  Main branch:     ${context.mainBranch}`);
      logger.info(`  Steps:           ${plan.steps.length}`);
      logger.info(`  Max concurrency: ${options?.maxConcurrency || 'unlimited'}`);
      if (options?.confirmDeploy) {
        logger.info('  ⚠️  Deployment enabled (--confirm-deploy)');
      }
      logger.info(`${'─'.repeat(50)}`);
    } else if (options?.confirmDeploy) {
      logger.info('  ⚠️  Deployment enabled (--confirm-deploy)');
    }

    // Group steps by repo for multi-repo orchestration
    const repoGroups = new Map<string, PlanStep[]>();
    for (const step of plan.steps) {
      const repo = step.repo ?? process.cwd();
      if (!repoGroups.has(repo)) repoGroups.set(repo, []);
      repoGroups.get(repo)!.push(step);
    }

    if (repoGroups.size > 1) {
      logger.info(`\n📂 Multi-repo plan detected: ${repoGroups.size} repo(s)`);
      for (const [repo, steps] of repoGroups) {
        logger.info(`  - ${path.basename(repo)}: ${steps.length} step(s)`);
      }
    }

    // build dependency graph
    const dependencyGraph = this.buildDependencyGraph(plan);

    // identify waves of parallel execution
    const executionWaves = this.identifyExecutionWaves(dependencyGraph);

    context.totalWaves = executionWaves.length;
    logger.info(`Execution will proceed in ${executionWaves.length} wave(s)\n`);

    // Pre-execution cost estimation
    const costEstimator = new CostEstimator(context.knowledgeBase);
    const modelName = options?.model || defaultModelForAdapter(options?.cliAgent);
    context.costEstimator = costEstimator;
    context.costEstimate = costEstimator.estimate(plan, {
      modelName,
      fleetMode: !!options?.useInnerFleet,
      qualityGatesEnabled: options?.qualityGates !== false,
    });
    context.stepCostRecords = [];

    // Capture existing file inventory before agents run, so preservation rules
    // can be injected into shared instructions and per-step prompts.
    context.baselineSnapshot = scanBaseline(this.workingDir);

    // Classify the goal and filter requirements by tier so agents only see
    // what matters for this task type (backend, frontend, CLI, etc.)
    const taskClassifier = new TaskClassifier();
    const taskClassification = taskClassifier.classify(plan.goal || '');
    const requirementFilter = new RequirementFilter(TIER_MAPS);
    const filtered = requirementFilter.filter(taskClassification);
    context.filteredRequirements = filtered;
    const tierInjection = requirementFilter.toPromptInjection(filtered);

    // Write common prompt instructions to repo root so Copilot CLI picks them up natively.
    // Per-step prompts only carry task-specific content; shared boilerplate lives here.
    this.writeSharedInstructions(context.baselineSnapshot, tierInjection);

    // Cache quality gates config once for the entire run
    const gatesConfig = load_quality_gates_config(this.workingDir, options?.qualityGatesConfigPath);

    // Greedy as-soon-as-ready scheduler: launch steps the moment their deps are satisfied,
    // not when an entire "wave" finishes. Eliminates idle time from unbalanced step durations.
    const pending = new Set(plan.steps.map(s => s.stepNumber));
    const completed = new Set<number>();
    const failed = new Set<number>();
    const inFlight = new Set<number>();
    let waveCounter = 0;

    // Lean mode: attach knowledge base references before scheduling
    if (options?.lean && context.knowledgeBase) {
      for (const step of plan.steps) {
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
    const pendingMerge: ParallelStepResult[] = [];

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
          await this.mergeWaveBranches(pendingMerge, context, options);
          pendingMerge.length = 0;
        }
      }

      // Fire meta-analysis asynchronously (off the critical path)
      if (context.metaAnalyzer && context.knowledgeBase) {
        setImmediate(() => {
          this.runAsyncMetaAnalysis(context, plan, runDir, Array.from(completed));
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

    // Returns step numbers whose dependencies are all satisfied
    const getReadySteps = (): number[] => {
      const ready: number[] = [];
      for (const stepNum of pending) {
        if (inFlight.has(stepNum)) continue;
        const step = plan.steps.find(s => s.stepNumber === stepNum);
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
      if (this.pauseRequested) {
        logger.info('\n⏸️  Pause requested. Waiting for resume...');
        await this.waitForResume();
        logger.info('\n▶️  Resuming execution...');
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
          fleetHandled = await this.attemptFleetDispatch(ready, plan, agents, context, options);
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
          const step = plan.steps.find(s => s.stepNumber === stepNumber)!;
          const agent = this.resolveAgent(agents, step.agentName);

          if (!agent) {
            throw new Error(`Agent ${step.agentName} not found for step ${stepNumber}`);
          }

          inFlight.add(stepNumber);

          return context.executionQueue!.enqueue(
            `step-${stepNumber}`,
            () => this.executeStepInSwarm(step, agent, context, options),
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
          const criticResult = this.runCriticReview(completedInBatch, context, plan);
          context.criticResults.push(criticResult);
          logger.info(`  🎭 Critic score: ${criticResult.score}/100 (${criticResult.recommendation})`);
          if (criticResult.flags.length > 0) {
            logger.info(`  ⚠️  Critic flags: ${criticResult.flags.join(', ')}`);
            logger.info('  ⏸️  Governance pause: awaiting human approval...');
            this.pauseRequested = true;
            await this.waitForResume();
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
      await this.mergeWaveBranches(pendingMerge, context, options);
      pendingMerge.length = 0;
    }

    // Execution summary
    const completedResults = context.results.filter(r => r.status === 'completed');
    const failedResults = context.results.filter(r => r.status === 'failed');
    logger.info(`\n📊 Execution Summary:`);
    logger.info(`  ${'─'.repeat(40)}`);
    completedResults.forEach(r => {
      const durationMs = r.startTime && r.endTime
        ? new Date(r.endTime).getTime() - new Date(r.startTime).getTime()
        : 0;
      logger.info(`  ✅ ${r.agentName}:${r.stepNumber} (${Math.round(durationMs / 1000)}s)`);
    });
    failedResults.forEach(r => {
      logger.info(`  ❌ ${r.agentName}:${r.stepNumber} - ${r.error || 'unknown error'}`);
    });
    logger.info(`  ${'─'.repeat(40)}`);
    logger.info(`  ${completedResults.length} passed, ${failedResults.length} failed, ${waveCounter} batch(es)`);

    if (context.unmergedBranches && context.unmergedBranches.length > 0) {
      logger.info(`\n⚠️  ${context.unmergedBranches.length} branch(es) could not merge (work preserved on branch):`);
      for (const um of context.unmergedBranches) {
        logger.info(`  • Step ${um.stepNumber} (${um.agentName}): ${um.branchName}`);
      }
    }

    // Remove any remaining worktrees (failed or unmerged steps) so their
    // leftover test files don't pollute recursive test runners during gates.
    // mergeWaveBranches already cleaned merged steps; this catches the rest.
    await this.cleanupRemainingWorktrees(context);

    // Install dependencies if any agent added new ones to package.json.
    // Without this, quality gates' `npm test` would fail on MODULE_NOT_FOUND
    // for newly-added packages like express or cors.
    await this.installDependenciesIfNeeded();

    // final quality gates run on the merged state (hard gate)
    // this happens before auto-PR so we don't create a PR for a failing run
    const gatesEnabled = options?.qualityGates !== false;
    if (gatesEnabled) {
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
      const skippedGateKeys = this.targetMode ? SELF_IMPROVEMENT_GATE_KEYS : undefined;
      let gatesResult = await run_quality_gates(
        this.workingDir, gatesConfig, gatesOut, baselineFiles, baseCommit,
        skippedReqIds, skippedGateKeys,
      );
      context.finalGateResults = gatesResult.results;

      if (!gatesResult.passed && gatesConfig.failOnIssues) {
        const failedIds = new Set(gatesResult.results.filter(r => r.status === 'fail').map(r => r.id));
        const agentMap = context.agents || agents;
        let remediationAttempted = false;

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

          const addSteps: Array<{ agent: string; task: string; afterStep?: number }> = [];

          const dupStep = this.buildRemediationStep(
            gatesResult.results.find(r => r.id === 'duplicate-blocks'),
            gatesConfig.autoAddRefactorStepOnDuplicateBlocks,
            'duplicateRefactorAdded', context, agentMap,
            'Quality gates flagged repeated code blocks. Extract shared utilities/hooks/middleware and refactor duplicates away. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
            '⚠️  Final quality gates: duplicate blocks detected; scheduling refactor',
            maxCompletedStep, lastAgent,
          );
          if (dupStep) addSteps.push(dupStep);

          const readmeStep = this.buildRemediationStep(
            gatesResult.results.find(r => r.id === 'readme-claims'),
            gatesConfig.autoAddReadmeTruthStepOnReadmeClaims,
            'readmeTruthAdded', context, agentMap,
            'Quality gates flagged README claims that are not backed by code. Either implement the missing features or downgrade/remove the claims. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
            '⚠️  Final quality gates: README claims mismatch; scheduling truth step',
            maxCompletedStep, lastAgent,
          );
          if (readmeStep) addSteps.push(readmeStep);

          const scaffoldStep = this.buildRemediationStep(
            gatesResult.results.find(r => r.id === 'scaffold-defaults'),
            gatesConfig.autoAddScaffoldFixStepOnScaffoldDefaults,
            'scaffoldFixAdded', context, agentMap,
            'Quality gates flagged scaffold defaults. Remove placeholder assets and generic scaffold README sections, and ensure HTML title/app metadata are meaningful. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
            '⚠️  Final quality gates: scaffold defaults detected; scheduling cleanup',
            maxCompletedStep, lastAgent,
          );
          if (scaffoldStep) addSteps.push(scaffoldStep);

          const configStep = this.buildRemediationStep(
            gatesResult.results.find(r => r.id === 'hardcoded-config'),
            gatesConfig.autoAddConfigFixStepOnHardcodedConfig,
            'configFixAdded', context, agentMap,
            'Quality gates flagged hardcoded config values. Move API base URLs, ports, retry counts, timeouts, and environment-specific values into env/typed config. For Vite proxy targets, prefer import.meta.env with a safe default. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
            '⚠️  Final quality gates: hardcoded config detected; scheduling cleanup',
            maxCompletedStep, lastAgent,
          );
          if (configStep) addSteps.push(configStep);

          const a11yStep = this.buildRemediationStep(
            gatesResult.results.find(r => r.id === 'accessibility'),
            gatesConfig.autoAddAccessibilityFixStepOnAccessibility,
            'accessibilityFixAdded', context, agentMap,
            'Quality gates flagged accessibility issues. Fix all items from the gate report: skip-to-content link, heading hierarchy, aria-labels, focus-visible styles, meta description + theme-color tags, responsive CSS (viewport meta, media queries or relative units), CSS custom properties on :root with prefers-color-scheme:dark override, semantic HTML landmarks (main, nav, header), img alt attributes. Use the gate report as the source of truth. Re-run tests and ensure quality gates pass.',
            '⚠️  Final quality gates: accessibility issues detected; scheduling fix',
            maxCompletedStep, lastAgent,
          );
          if (a11yStep) addSteps.push(a11yStep);

          const testCovStep = this.buildRemediationStep(
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
            addSteps.push(singleStep);
            logger.warn(`⚠️  Final quality gates failed (${failedIds.size} gates); scheduling single consolidated remediation step...`);
          } else if (addSteps.length === 1) {
            logger.warn('⚠️  Final quality gates failed; attempting one remediation pass...');
          }

          if (addSteps.length > 0) {
            remediationAttempted = true;
            await this.executeReplan(context, { retrySteps: [], addSteps }, agentMap, options);
            gatesResult = await run_quality_gates(
              this.workingDir, gatesConfig, gatesOut, baselineFiles, baseCommit,
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

                const retryAgent = this.resolveAgent(agentMap, 'integrator_finalizer')
                  ? 'integrator_finalizer'
                  : lastAgent;
                const retryMaxStep = Math.max(...context.plan.steps.map(s => s.stepNumber));

                logger.warn('⚠️  First remediation did not resolve all gate failures. Running second attempt with specific findings...');
                await this.executeReplan(context, {
                  retrySteps: [],
                  addSteps: [{ agent: retryAgent, task: retryTask, afterStep: retryMaxStep }]
                }, agentMap, options);

                gatesResult = await run_quality_gates(
                  this.workingDir, gatesConfig, gatesOut, baselineFiles, baseCommit,
                  skippedReqIds, skippedGateKeys,
                );
                context.finalGateResults = gatesResult.results;
              }
            }
          }
        }

        if (!gatesResult.passed) {
          if (remediationAttempted && failedResults.length === 0) {
            // All plan steps passed but remediation couldn't fully resolve
            // pre-existing quality gaps. Downgrade to a warning so the run
            // isn't marked failed for issues outside the plan's scope.
            const remaining = gatesResult.results
              .filter(r => r.status === 'fail')
              .map(r => `${r.id} (${r.issues.length} issues)`);
            logger.warn(`⚠️  Quality gates still have issues after remediation: ${remaining.join(', ')}`);
            logger.warn('   Treating as warning since all plan steps passed.');
          } else {
            logger.error('❌ Quality gates failed. See report in:', gatesOut);
            throw new Error('Quality gates failed');
          }
        }
      }
    }

    // merge all agent branches back to main
    logger.info('\n🔀 Merging agent branches to main...');
    // Clean up any stale locks before final merge (e.g. from cancelled runs)
    context.contextBroker.forceReleaseStaleLocks();
    await this.mergeAllBranches(context);

    // Finalize metrics and save to analytics log
    if (context.metricsCollector) {
      const metrics = context.metricsCollector.finalize();

      // Save metrics to run directory
      const metricsPath = path.join(runDir, 'metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), 'utf8');

      // Append to analytics log
      const analyticsLog = new AnalyticsLog();
      analyticsLog.appendRun(metrics);

      logger.info(`\n📊 Metrics saved: ${metricsPath}`);

      // Save cost attribution alongside metrics
      if (context.costEstimate && context.stepCostRecords) {
        const modelName = options?.model || defaultModelForAdapter(options?.cliAgent);
        const totalEstimated = context.costEstimate.totalPremiumRequests;
        const totalActual = context.stepCostRecords.reduce((s, r) => s + r.actualPremiumRequests, 0);
        const attribution: CostAttribution = {
          totalEstimatedPremiumRequests: totalEstimated,
          totalActualPremiumRequests: totalActual,
          estimateAccuracy: context.costEstimator?.getAccuracy() ?? 1.0,
          modelUsed: modelName,
          modelMultiplier: context.costEstimate.modelMultiplier,
          overageTriggered: context.costEstimate.overageCostUSD > 0,
          perStep: context.stepCostRecords,
        };
        const costPath = path.join(runDir, 'cost-attribution.json');
        fs.writeFileSync(costPath, JSON.stringify(attribution, null, 2), 'utf8');
      }

      // Persist session state for audit/resume support
      // Use the runDir basename as session ID so it matches the directory
      // the CLI created (context.executionId differs by a few ms)
      const runDirId = path.basename(runDir);
      const completedSteps = context.results.filter(r => r.status === 'completed');
      const sessionState: SessionState = {
        sessionId: runDirId,
        graph: {
          goal: plan.goal,
          steps: plan.steps.map(s => ({ stepNumber: s.stepNumber, task: s.task, agent: s.agentName }))
        },
        branchMap: Object.fromEntries(
          context.results
            .filter(r => r.branchName)
            .map(r => [String(r.stepNumber), r.branchName!])
        ),
        transcripts: Object.fromEntries(
          context.results
            .filter(r => r.sessionResult?.transcriptPath)
            .map(r => [String(r.stepNumber), r.sessionResult!.transcriptPath!])
        ),
        metrics: metrics as unknown as Record<string, unknown>,
        gateResults: context.finalGateResults || [],
        status: completedSteps.length === plan.steps.length ? 'completed' : 'failed',
        lastCompletedStep: Math.max(0, ...completedSteps.map(r => r.stepNumber))
      };
      // Write directly to runDir (saveSession uses cwd which differs for demos)
      fs.writeFileSync(
        path.join(runDir, 'session-state.json'),
        JSON.stringify(sessionState, null, 2),
        'utf8'
      );
      // Also persist via collector so audit/metrics CLI can find it from project root
      context.metricsCollector.saveSession(runDirId, sessionState);
    }

    // OWASP ASI compliance report (when --owasp-report is set)
    if (options?.owaspReport) {
      try {
        const { OwaspMapper } = await import('./owasp-mapper');
        const { OwaspReportRenderer } = await import('./owasp-report-renderer');

        const verificationResults = context.results
          .map(r => r.verificationResult)
          .filter((v): v is VerificationResult => v !== undefined);

        const repaired = context.results.filter(r => (r.retryCount ?? 0) > 0 && r.status === 'completed').length;
        const failed = context.results.filter(r => r.status === 'failed').length;
        const completed = context.results.filter(r => r.status === 'completed').length;
        const passed = completed - repaired;
        const exhausted = context.results.filter(r => r.status === 'failed' && (r.retryCount ?? 0) > 0).length;

        // Read version from package.json at project root
        let toolVersion = '4.1.0';
        try {
          const pkgPath = path.join(__dirname, '..', 'package.json');
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          toolVersion = pkg.version || toolVersion;
        } catch {
          // Fall back to hardcoded version if package.json is unavailable
        }

        const meta = {
          executionId: context.executionId,
          toolVersion,
          governanceEnabled: !!options.governance,
          strictIsolation: !!options.strictIsolation,
          adapterType: options.cliAgent || 'copilot',
          totalSteps: plan.steps.length,
          passedSteps: passed,
          repairedSteps: repaired,
          failedSteps: failed,
          retriesExhausted: exhausted,
        };

        const mapper = new OwaspMapper();
        const complianceReport = mapper.map(verificationResults, meta);

        fs.writeFileSync(
          path.join(runDir, 'owasp-compliance.md'),
          OwaspReportRenderer.toMarkdown(complianceReport),
          'utf8'
        );
        fs.writeFileSync(
          path.join(runDir, 'owasp-compliance.json'),
          OwaspReportRenderer.toJson(complianceReport),
          'utf8'
        );

        logger.info(`  OWASP ASI: ${complianceReport.mitigatedRisks}/${complianceReport.applicableRisks} applicable risks mitigated`);
      } catch (owaspErr) {
        logger.warn(`  OWASP report generation failed: ${owaspErr instanceof Error ? owaspErr.message : owaspErr}`);
      }
    }

    // Record execution in knowledge base
    if (context.knowledgeBase) {
      const totalPatternsDetected = context.waveAnalyses?.reduce(
        (sum, analysis) => sum + analysis.detectedPatterns.length, 0
      ) || 0;
      context.knowledgeBase.recordRun(totalPatternsDetected);

      // Record cost history for future estimation calibration
      if (context.costEstimate && context.stepCostRecords) {
        const modelName = options?.model || defaultModelForAdapter(options?.cliAgent);
        const totalRetries = context.stepCostRecords.reduce((s, r) => s + r.retryCount, 0);
        const totalActual = context.stepCostRecords.reduce((s, r) => s + r.actualPremiumRequests, 0);
        const totalEstimated = context.costEstimate.totalPremiumRequests;
        const evidence: CostHistoryEvidence = {
          runId: context.executionId,
          estimated: totalEstimated,
          actual: totalActual,
          retries: totalRetries,
          steps: plan.steps.length,
          model: modelName,
        };
        context.knowledgeBase.addOrUpdatePattern({
          category: 'cost_history',
          insight: `${plan.steps.length} steps, model ${modelName}, ${totalActual} premium requests, ${totalRetries} retries`,
          confidence: 'high',
          evidence: [JSON.stringify(evidence)],
          impact: 'medium',
        });
      }
    }

    // Auto-create PR if requested
    if (options?.autoPR) {
      logger.info('\n📝 Creating PR...');
      try {
        const toolManager = new ExternalToolManager({
          enableExternal: options.enableExternal || false,
          dryRun: options.dryRun || false,
          logFile: path.join(runDir, 'external-commands.log')
        });

        const deploymentManager = new DeploymentManager(toolManager, this.workingDir);
        const prAutomation = new PRAutomation(toolManager, this.workingDir);

        const deployments = deploymentManager.loadDeploymentMetadata(runDir);
        const summary = prAutomation.generatePRSummary(context, deployments);
        const prResult = await prAutomation.createPR(summary);

        if (prResult.success) {
          logger.info(`✅ PR created: ${prResult.url}`);
        } else {
          logger.warn(`⚠️  PR creation failed: ${prResult.error}`);
        }
      } catch (error) {
        logger.warn(`⚠️  PR automation error: ${error instanceof Error ? error.message : error}`);
      }
    }

    return context;
  }

  /**
   * Shared auto-remediation logic for quality gate failures.
   * Returns a remediation step descriptor if the gate failed and auto-fix
   * is both enabled and not already triggered; otherwise returns null.
   * Includes specific gate findings in the task so the fix agent knows exactly what to address.
   */
  private buildRemediationStep(
    gateResult: { status: string; issues?: Array<{ message: string; filePath?: string; hint?: string }> } | undefined,
    configEnabled: boolean,
    triggeredFlag: keyof NonNullable<SwarmExecutionContext['qualityGatesTriggered']>,
    context: SwarmExecutionContext,
    agents: Map<string, AgentProfile>,
    taskDescription: string,
    warningMessage: string,
    afterStep: number,
    fallbackAgent: string,
  ): { agent: string; task: string; afterStep: number } | null {
    if (!gateResult || gateResult.status !== 'fail') return null;
    if (!configEnabled) return null;
    if (!context.qualityGatesTriggered || context.qualityGatesTriggered[triggeredFlag]) return null;

    const preferredAgent = this.resolveAgent(agents, 'integrator_finalizer')
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
   * execute replan: retry failed steps on new branches with suffix
   * preserves completed work, only re-runs what failed
   */
  private async executeReplan(
    context: SwarmExecutionContext,
    replanPayload: ReplanPayload,
    agents: Map<string, AgentProfile>,
    options?: SwarmExecutionOptions
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

      const agent = this.resolveAgent(agents, step.agentName);
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
        await this.switchBranch(context.mainBranch);
        await this.createAgentBranch(retryBranchName, context.mainBranch);

        // Build repair context from the failed step's results
        const stepDir = path.join(context.runDir, 'steps', `step-${stepNumber}`);
        const transcriptPath = path.join(stepDir, 'share.md');
        const verificationReportPath = path.join(
          context.runDir, 'verification', `step-${stepNumber}-verification.md`
        );

        const failedChecks: string[] = [];
        let rootCause = 'Verification checks failed';
        if (result?.verificationResult) {
          const repairAgentHelper = new RepairAgent(this.workingDir);
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

        const repairAgent = new RepairAgent(this.workingDir, 3);
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
          await this.executeStepInSwarm(retryStep, agent, context, options);
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
        const agent = this.resolveAgent(agents, added.agentName);
        if (!agent) {
          logger.warn(`  replan: agent ${added.agentName} not found for step ${added.stepNumber}, skipping`);
          return;
        }

        logger.info(`  🧩 Executing added step ${added.stepNumber} (${agent.name})`);
        try {
          await this.executeStepInSwarm(added, agent, context, options);
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
        .filter((r): r is ParallelStepResult =>
          !!r && r.status === 'completed' && !!r.branchName
        );
      if (completedReplan.length > 0) {
        context.contextBroker.forceReleaseStaleLocks();
        await this.mergeWaveBranches(completedReplan, context, options);
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

  /**
   * Execute a single step within the swarm
   */
  private async executeStepInSwarm(
    step: PlanStep,
    agent: AgentProfile,
    context: SwarmExecutionContext,
    options?: SwarmExecutionOptions
  ): Promise<void> {
    const resultIndex = context.results.findIndex(r => r.stepNumber === step.stepNumber);
    const result = context.results[resultIndex];
    if (!result) {
      throw new Error(`Result for step ${step.stepNumber} not found`);
    }

    try {
      // wait for dependencies with spinner feedback
      if (step.dependencies.length > 0) {
        const depSpinner = new Spinner(
          `Step ${step.stepNumber} — Waiting for dependencies (${step.dependencies.join(', ')})...`,
          { style: 'pulse', prefix: '  ' }
        );
        depSpinner.start();

        try {
          const satisfied = await context.contextBroker.waitForDependencies(step.dependencies, DEFAULT_DEPENDENCY_WAIT_MS);
          if (!satisfied) {
            depSpinner.fail(`Step ${step.stepNumber} — Dependencies timeout`);
            throw new Error('Dependencies timeout after 10 minutes');
          }
          depSpinner.succeed(`Step ${step.stepNumber} — Dependencies ready`);
        } catch (depError) {
          depSpinner.fail(`Step ${step.stepNumber} — Dependency failed`);
          throw depError;
        }
      }

      // Track step execution
      context.metricsCollector?.trackStep(step.stepNumber, agent.name);

      // create per-agent branch and worktree for true parallel isolation
      const branchName = `swarm/${context.executionId}/step-${step.stepNumber}-${agent.name.toLowerCase()}`;
      result.branchName = branchName;
      result.status = 'running';
      result.startTime = new Date().toISOString();

      // Notify progress: step is now running
      options?.onProgress?.(context, `step-running:${step.stepNumber}`);

      // Use git worktree so each agent has its own isolated working directory
      const stepRepoDir = step.repo || this.workingDir;
      const worktreePath = await this.createAgentWorktree(branchName, context.mainBranch, context.runDir, step.stepNumber, stepRepoDir);
      logger.info(`  🌿 Step ${step.stepNumber} (${agent.name}) on branch: ${branchName}`);

      // Capture baseline SHA before agent execution for outcome-based verification
      const baseSha = execSync('git rev-parse HEAD', { cwd: worktreePath, encoding: 'utf8' }).trim();

      // build enhanced prompt with dependency context
      const strictIsolation = options?.strictIsolation ?? false;
      const dependencyContext = context.contextBroker.getDependencyContext(step.dependencies, strictIsolation);
      const enhancedPrompt = this.buildSwarmPrompt(step, agent, context, dependencyContext);

      // Inner fleet toggle: prefix prompt with /fleet for parallel sub-agent dispatch
      const finalPrompt = options?.useInnerFleet
        ? `/fleet ${enhancedPrompt}`
        : enhancedPrompt;
      if (options?.useInnerFleet) {
        logger.info(`  ⚡ [inner-fleet] Step ${step.stepNumber} dispatched via /fleet`);
      }

      // execute session on agent branch - IN THE WORKTREE DIRECTORY
      const stepDir = path.join(context.runDir, 'steps', `step-${step.stepNumber}`);
      const transcriptPath = path.join(stepDir, 'share.md');

      // Ensure step directory exists before session runs
      if (!fs.existsSync(stepDir)) {
        fs.mkdirSync(stepDir, { recursive: true });
      }

      // Create a session executor for this worktree
      // Per-step cliAgent takes priority; falls back to run-level option; defaults to copilot
      const adapterName = step.cliAgent || options?.cliAgent || 'copilot';
      const stepAdapter = resolveAdapter(adapterName);
      const worktreeExecutor = new SessionExecutor(worktreePath, stepAdapter);

      const sessionOptions: SessionOptions = {
        allowAllTools: true,
        shareToFile: transcriptPath,
        logPrefix: `[${agent.name}:${step.stepNumber}]`, // live console logging for parallelism proof
        ...(options?.model && { model: options.model }),
        ...(options?.onAgentLine && { onAgentLine: options.onAgentLine }),
      };

      // Generate per-step hooks for scope enforcement and evidence capture
      // Hooks default to on unless explicitly disabled via --no-hooks
      let generatedHooks: GeneratedHooks | undefined;
      if (options?.hooksEnabled !== false) {
        const hookGen = new HookGenerator();
        generatedHooks = hookGen.generateStepHooks({
          step,
          agent,
          executionId: context.executionId,
          runDir: context.runDir,
          stepBranch: branchName,
          workingDir: worktreePath,
          existingTestFiles: context.baselineSnapshot?.testFiles || [],
        });
        // Hooks are auto-loaded by Copilot CLI from <gitRoot>/.github/hooks/
      }

      // replay mode: reuse a matching prior transcript instead of calling Copilot
      if (options?.replay && context.knowledgeBase) {
        const patterns = context.knowledgeBase.findSimilarTasks(step.task, 0.9);
        const match = patterns.find(p => p.evidence.length > 0);
        if (match) {
          const priorTranscript = match.evidence[0];
          if (priorTranscript && fs.existsSync(priorTranscript)) {
            logger.info(`  ♻️  [replay] Step ${step.stepNumber}: replaying from cached transcript`);
            fs.copyFileSync(priorTranscript, transcriptPath);
            result.sessionResult = {
              output: 'replayed from cache',
              success: true,
              duration: 0,
              exitCode: 0,
              transcriptPath: transcriptPath,
            };
            result.status = 'completed';
            result.endTime = new Date().toISOString();
            // skip to verification (fall through below)
          }
        }
      }

      // only call the agent if we don't already have a session result (e.g. from replay)
      if (!result.sessionResult) {
        // Print static header instead of animated spinner when live logging
        // This prevents spinner animation from interleaving with agent output
        logger.info(`  🐝 Step ${step.stepNumber} (${agent.name}) — Agent working...`);
        logger.info(`  ${'─'.repeat(60)}`);

        const toolName = options?.cliAgent || 'copilot';
        let sessionResult: SessionResult;

        if (toolName !== 'copilot') {
          // Non-copilot tools route through the adapter layer, which provides
          // stall detection, heartbeat, and tool-specific CLI flag handling.
          const adapter = resolveAdapter(toolName);
          const spawnOpts: AgentSpawnOptions = {
            prompt: finalPrompt,
            workdir: worktreePath,
          };
          if (options?.model) spawnOpts.model = options.model;

          const agentResult = await adapter.spawn(spawnOpts);
          sessionResult = {
            success: agentResult.exitCode === 0,
            output: agentResult.stdout + agentResult.stderr,
            exitCode: agentResult.exitCode,
            duration: agentResult.durationMs,
            premiumRequestsConsumed: agentResult.premiumRequestsConsumed,
          };
          if (agentResult.exitCode !== 0) {
            (sessionResult as SessionResult).error = agentResult.stderr;
          }
          if (agentResult.shareTranscriptPath) {
            sessionResult.transcriptPath = agentResult.shareTranscriptPath;
          }
        } else {
          sessionResult = await worktreeExecutor.executeSession(finalPrompt, sessionOptions);
        }

        // Print completion with timing; differentiate success from failure
        logger.info(`  ${'─'.repeat(60)}`);

        result.sessionResult = sessionResult;

        // Non-zero exit code does not mean the agent failed its task.
        // Claude Code often exits non-zero after completing file changes
        // (e.g., cleanup command fails, permission prompt at exit).
        // Let the verification pipeline judge whether the work is acceptable.
        if (!sessionResult.success) {
          logger.warn(`  ⚠️  Step ${step.stepNumber} (${agent.name}) exited with code ${sessionResult.exitCode}; checking committed work`);
        }
        // Session-complete log line is intentionally omitted — the
        // subsequent verification spinner ("Step N verified ✓") is the
        // user-visible marker of step completion. Printing both produced
        // back-to-back redundant lines in demo output.
      }

      // Clean up hook files after session completes (evidence log in runDir persists)
      if (generatedHooks) {
        const hookGen = new HookGenerator();
        hookGen.cleanupHooks(generatedHooks.hooksFilePath);
      }

      // Check if transcript was created, create fallback if not
      if (!fs.existsSync(transcriptPath)) {
        const fallbackContent = `# Copilot Session Transcript\n\nSession output:\n\`\`\`\n${result.sessionResult?.output || 'No output captured'}\n\`\`\`\n`;
        fs.writeFileSync(transcriptPath, fallbackContent, 'utf8');
      }

      // parse transcript for context
      const transcriptContent = fs.readFileSync(transcriptPath, 'utf8');
      const shareIndex = this.shareParser.parse(transcriptContent);

      // Track commits from this step
      if (shareIndex.gitCommits) {
        shareIndex.gitCommits.forEach(() => {
          context.metricsCollector?.trackCommit(agent.name);
        });

        // Analyze commit quality for anti-patterns
        await this.analyzeCommitQuality(shareIndex.gitCommits, step.stepNumber, agent.name, context);
      }

      // Commit any uncommitted work the agent left behind.
      // Some adapters (e.g. Codex) modify files without committing;
      // the git_diff verification check only sees committed changes.
      try {
        const status = execSync('git status --porcelain', { cwd: worktreePath, encoding: 'utf8' }).trim();
        if (status) {
          // Exclude orchestrator-reserved and build-artifact paths from per-step commits.
          // Bare `git add -A` captures orchestrator state written to runs/, plans/,
          // .quickfix/, node_modules/, __pycache__, etc., bloating commit diffs with
          // noise unrelated to the agent's actual work (smoke5c failure mode, issue #27).
          // gitPathspecExcludes() mirrors the Python-side capture exclusion from
          // worktree_reserved_paths.py so both sides stay in sync. See PR 2.
          const excludes = gitPathspecExcludes();
          execSync(
            `git add -A -- . ${excludes.map(e => `'${e}'`).join(' ')}`,
            { cwd: worktreePath, stdio: 'pipe' }
          );
          execSync(
            `git commit -m "auto-commit uncommitted work from step ${step.stepNumber} (${agent.name})"`,
            { cwd: worktreePath, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
          );
        }
      } catch {
        // Commit may fail if working tree is truly clean or in detached HEAD; non-fatal
      }

      // verify the step with spinner feedback
      const verifySpinner = new Spinner(`Step ${step.stepNumber} — Verifying work...`, { style: 'dots', prefix: '  ' });
      verifySpinner.start();

      const verificationResult = await this.verifier.verifyStep(
        step.stepNumber,
        agent.name,
        transcriptPath,
        {
          // only require tests if task explicitly mentions testing/test suite
          requireTests: /\b(test suite|unit test|integration test|e2e test|write tests)\b/i.test(step.task),
          // only require build if task explicitly mentions build process (not "build an app")
          requireBuild: /\b(npm build|run build|compile|bundle|webpack)\b/i.test(step.task),
          // commits are desired but not blocking for demo
          requireCommits: false
        },
        shareIndex,
        generatedHooks?.evidenceLogPath,
        { workdir: worktreePath, baseSha }
      );

      result.verificationResult = verificationResult;

      // Track verification result
      context.metricsCollector?.trackVerification(verificationResult.passed);

      // generate and commit verification report
      const reportPath = path.join(
        context.runDir,
        'verification',
        `step-${step.stepNumber}-verification.md`
      );

      await this.verifier.generateVerificationReport(verificationResult, reportPath);

      if (verificationResult.passed) {
        verifySpinner.succeed(`Step ${step.stepNumber} (${agent.name}) verified ✓`);

        // add to shared context BEFORE advisory gates so replan steps can depend on this step
        const contextEntry: ContextEntry = {
          stepNumber: step.stepNumber,
          agentName: agent.name,
          timestamp: new Date().toISOString(),
          data: {
            filesChanged: shareIndex.changedFiles,
            outputsSummary: step.expectedOutputs.join(', '),
            branchName,
            commitShas: shareIndex.gitCommits.map(c => c.sha || 'unknown'),
            verificationPassed: verificationResult.passed,
            transcript: transcriptPath
          }
        };
        context.contextBroker.addStepContext(contextEntry);

        await this.verifier.commitVerificationReport(
          reportPath,
          step.stepNumber,
          agent.name,
          true
        );

        // Quality gates run only in the final pass (after all branches merged) to avoid
        // spawning extra Copilot sessions mid-execution. The final gates block handles
        // auto-remediation for every gate type, making per-step checks redundant.

        // optional deployment for devops_pro when --confirm-deploy is set
        if (agent.name === 'DevOpsPro' && options?.confirmDeploy) {
          await this.executeOptionalDeployment(step, agent, context, options);
        }
      } else {
        // verification failed - attempt rollback
        verifySpinner.warn(`Step ${step.stepNumber} verification failed, rolling back...`);

        const rollbackResult = await this.verifier.rollback(
          step.stepNumber,
          branchName,
          shareIndex.changedFiles,
          context.mainBranch,
        );

        if (rollbackResult.success) {
          logger.info(`  🔄 Rollback complete: ${rollbackResult.filesRestored.length} file(s) restored`);
        }

        throw new Error('Step failed verification - see verification report');
      }

      // context was already added before advisory gates block

      result.status = 'completed';
      result.endTime = new Date().toISOString();

      // Record actual cost for this step
      if (context.costEstimator && context.stepCostRecords) {
        const stepEstimate = context.costEstimate?.perStep.find(s => s.stepNumber === step.stepNumber);
        const durationMs = result.startTime && result.endTime
          ? new Date(result.endTime).getTime() - new Date(result.startTime).getTime()
          : 0;
        // D5: Use instrumented request count from adapter when available.
        // The adapter parses the actual CLI output for request markers
        // (e.g. Copilot's "Requests N Premium" stderr summary).
        // Fall back to 1 only when the adapter could not determine the count.
        const instrumentedRequests = result.sessionResult?.premiumRequestsConsumed;
        const actualRequests = typeof instrumentedRequests === 'number' ? instrumentedRequests : 1;
        context.costEstimator.recordActual(step.stepNumber, stepEstimate?.estimatedPremiumRequests ?? 1, actualRequests, 0);
        context.stepCostRecords.push({
          stepNumber: step.stepNumber,
          agentName: agent.name,
          estimatedPremiumRequests: stepEstimate?.estimatedPremiumRequests ?? 1,
          actualPremiumRequests: actualRequests,
          retryCount: 0,
          promptTokens: stepEstimate?.estimatedPromptTokens ?? 0,
          fleetMode: !!options?.useInnerFleet,
          durationMs,
        });
      }

      // Notify progress: step completed
      options?.onProgress?.(context, `step-done:${step.stepNumber}`);

      // The per-branch merge confirmation ("✅ Merged swarm/...") is
      // already emitted by BranchMerger. No need to announce the step's
      // completion a third time after the verification spinner.

    } catch (error: unknown) {
      const err = error as Error;
      result.status = 'failed';
      result.error = err.message;
      result.endTime = new Date().toISOString();

      // Signal completion even for failed steps so dependent replan steps
      // don't hang forever in waitForDependencies. The replan step can
      // check context.results to see the step failed and adapt.
      const failedEntry: ContextEntry = {
        stepNumber: step.stepNumber,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
        data: {
          filesChanged: [],
          outputsSummary: 'step failed verification',
          branchName: result.branchName || '',
          commitShas: [],
          verificationPassed: false,
          transcript: path.join(context.runDir, 'steps', `step-${step.stepNumber}`, 'share.md')
        }
      };
      context.contextBroker.addStepContext(failedEntry);

      // Notify progress: step failed
      options?.onProgress?.(context, `step-failed:${step.stepNumber}`);

      logger.error(`  ❌ Step ${step.stepNumber} (${agent.name}) failed: ${err.message}`);
      throw error;
    }
  }

  /**
  /** Critic review on completed wave results. Delegates to critic-reviewer module. */
  private runCriticReview(completedResults: ParallelStepResult[], _context: SwarmExecutionContext, plan: ExecutionPlan): CriticResult {
    return _runCriticReview(completedResults, plan);
  }

  /** Build prompt for swarm step execution. Delegates to prompt-builder module. */
  private buildSwarmPrompt(step: PlanStep, agent: AgentProfile, context: SwarmExecutionContext, dependencyContext: string): string {
    return _buildSwarmPrompt(step, agent, context, dependencyContext);
  }

  /** Build dependency graph from plan. Delegates to wave-scheduler module. */
  private buildDependencyGraph(plan: ExecutionPlan): Map<number, number[]> {
    return _buildDependencyGraph(plan);
  }

  /** Identify waves of parallel execution (topological sort by levels). Delegates to wave-scheduler module. */
  private identifyExecutionWaves(graph: Map<number, number[]>): number[][] {
    return _identifyExecutionWaves(graph);
  }

  /**
   * Create a git worktree for an agent - delegates to WorktreeManager.
   */
  private async createAgentWorktree(
    branchName: string,
    fromBranch: string,
    runDir: string,
    stepNumber: number,
    repoDir?: string
  ): Promise<string> {
    return this.worktreeManager.createAgentWorktree(branchName, fromBranch, runDir, stepNumber, repoDir);
  }

  /**
   * Remove a git worktree after merge - delegates to WorktreeManager.
   */
  private async removeAgentWorktree(worktreePath: string): Promise<void> {
    return this.worktreeManager.removeAgentWorktree(worktreePath);
  }

  /**
   * Remove all remaining worktree directories under runs/<id>/worktrees/.
   * mergeWaveBranches cleans up merged steps, but failed or unmerged steps
   * leave worktrees containing test files that recursive test runners
   * (node --test, Jest, etc.) discover during quality gates.
   */
  private async cleanupRemainingWorktrees(context: SwarmExecutionContext): Promise<void> {
    const worktreesDir = path.join(context.runDir, 'worktrees');
    if (!fs.existsSync(worktreesDir)) return;

    const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });
    const remainingDirs = entries.filter(e => e.isDirectory());
    if (remainingDirs.length === 0) return;

    logger.info(`\n🧹 Cleaning up ${remainingDirs.length} remaining worktree(s) before quality gates...`);
    for (const dir of remainingDirs) {
      const worktreePath = path.join(worktreesDir, dir.name);
      try {
        await this.worktreeManager.removeAgentWorktree(worktreePath);
      } catch (err: unknown) {
        // Force-remove if git worktree remove fails (e.g., already detached)
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup; log but don't block execution
          logger.warn(`  ⚠️  Could not remove worktree ${dir.name}: ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Create a new git branch for an agent - delegates to WorktreeManager.
   */
  private async createAgentBranch(branchName: string, fromBranch: string): Promise<void> {
    return this.worktreeManager.createAgentBranch(branchName, fromBranch);
  }

  /**
   * Attempt to dispatch a batch of steps via a single /fleet prompt.
   * If fleet dispatch fails or any subtask cannot be mapped back, returns false
   * so the caller can fall back to subprocess mode.
   */
  private async attemptFleetDispatch(
    readySteps: number[],
    plan: ExecutionPlan,
    agents: Map<string, AgentProfile>,
    context: SwarmExecutionContext,
    options?: SwarmExecutionOptions
  ): Promise<boolean> {
    const fleetExecutor = new FleetExecutor(this.workingDir);

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
        const result: ParallelStepResult = {
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
   * Merge completed branches to main. Delegates to BranchMerger with
   * the appropriate context and tracks unmerged branches on the context.
   */
  private async mergeWaveBranches(
    completedResults: ParallelStepResult[],
    context: SwarmExecutionContext,
    options?: SwarmExecutionOptions
  ): Promise<void> {
    const mergeCtx: MergeContext = {
      mainBranch: context.mainBranch,
      contextBroker: context.contextBroker,
      prManager: context.prManager,
    };
    const unmerged = await this.branchMerger.mergeWaveBranches(
      completedResults, mergeCtx, options?.prMode,
      context.prUrls, context.stepCostRecords, context.plan
    );
    if (unmerged.length > 0) {
      if (!context.unmergedBranches) context.unmergedBranches = [];
      context.unmergedBranches.push(...unmerged);
    }

    // Remove worktrees for merged steps so their leftover test files
    // don't confuse recursive test runners (node --test, Jest, etc.)
    const worktreesDir = path.join(context.runDir, 'worktrees');
    for (const result of completedResults) {
      if (result.branchName) {
        const worktreePath = path.join(worktreesDir, `step-${result.stepNumber}`);
        await this.worktreeManager.removeAgentWorktree(worktreePath);
      }
    }
  }

  /**
   * Merge all agent branches back to main and clean up worktrees
   */
  /**
   * Merge all agent branches back to main - delegates to BranchMerger.
   */
  private async mergeAllBranches(context: SwarmExecutionContext): Promise<void> {
    const mergeCtx: MergeContext = {
      mainBranch: context.mainBranch,
      contextBroker: context.contextBroker,
      prManager: context.prManager,
    };
    const unmerged = await this.branchMerger.mergeAllBranches(
      context.results, context.runDir, mergeCtx
    );
    if (unmerged.length > 0) {
      if (!context.unmergedBranches) context.unmergedBranches = [];
      context.unmergedBranches.push(...unmerged);
    }
  }

  /**
   * Detect whether agents introduced new dependencies and install them.
   * Runs after all branches are merged but before quality gates so that
   * `npm test` has access to any newly-added packages.
   */
  private async installDependenciesIfNeeded(): Promise<void> {
    const pkgPath = path.join(this.workingDir, 'package.json');
    const nodeModulesPath = path.join(this.workingDir, 'node_modules');

    if (!fs.existsSync(pkgPath)) return;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (Object.keys(allDeps).length === 0) return;

      // Check if any declared dependency is missing from node_modules
      const missing = Object.keys(allDeps).filter(dep => {
        return !fs.existsSync(path.join(nodeModulesPath, dep));
      });

      if (missing.length === 0) return;

      logger.info(`\n\ud83d\udce6 Installing ${missing.length} new dependenc${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}`);

      // Use the right package manager for the project
      const installCmd = fs.existsSync(path.join(this.workingDir, 'yarn.lock'))
        ? 'yarn install --frozen-lockfile 2>/dev/null || yarn install'
        : fs.existsSync(path.join(this.workingDir, 'pnpm-lock.yaml'))
          ? 'pnpm install --no-frozen-lockfile'
          : 'npm install --loglevel=error';

      execSync(installCmd, {
        cwd: this.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120_000,
      });
      logger.info('  \u2705 Dependencies installed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`  \u26a0\ufe0f  Dependency install failed (quality gates may report test failures): ${msg}`);
    }
  }

  /**
   * Switch to a git branch - delegates to WorktreeManager.
   */
  private async switchBranch(branchName: string): Promise<void> {
    return this.worktreeManager.switchBranch(branchName);
  }

  /**
   * Merge a branch with conflict detection
   */
  /**
   * Wait for resume signal
   */
  private async waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.resumeRequested || !this.pauseRequested) {
          clearInterval(checkInterval);
          this.resumeRequested = false;
          resolve();
        }
      }, 500); // Check every 500ms
    });
  }

  /**
   * Rebase a branch onto main and retry the merge - delegates to BranchMerger.
   */
  private tryRebaseAndMerge(branchName: string, context: SwarmExecutionContext): boolean {
    const mergeCtx: MergeContext = {
      mainBranch: context.mainBranch,
      contextBroker: context.contextBroker,
      prManager: context.prManager,
    };
    return this.branchMerger.tryRebaseAndMerge(branchName, mergeCtx);
  }

  /**
   * Merge a single branch via git merge --no-ff - delegates to BranchMerger.
   */
  private async mergeBranch(branchName: string, context: SwarmExecutionContext): Promise<void> {
    const mergeCtx: MergeContext = {
      mainBranch: context.mainBranch,
      contextBroker: context.contextBroker,
      prManager: context.prManager,
    };
    return this.branchMerger.mergeBranch(branchName, mergeCtx);
  }

  /**
   * Get current git branch - delegates to WorktreeManager.
   */
  private getCurrentBranch(): string {
    return this.worktreeManager.getCurrentBranch();
  }

  /**
   * Ensure repo has at least one commit - delegates to WorktreeManager.
   */
  private ensureInitialCommit(): void {
    this.worktreeManager.ensureInitialCommit();
  }

  /**
   * Clean up leftover git state from crashed runs: abort pending merges,
   * reset staged/unmerged index entries, and restore working tree files.
   * Prevents cascading failures when binary files (e.g. .pyc, .db) from
   * a previous merge conflict block branch creation or verification commits.
   */
  private sanitizeGitState(): void {
    const opts = { cwd: this.workingDir, stdio: 'pipe' as const, encoding: 'utf8' as const };

    try {
      execSync('git merge --abort', opts);
      logger.info('  [cleanup] Aborted in-progress merge from previous run');
    } catch { /* no merge in progress; expected */ }

    // Check for unmerged or staged entries that would block new operations
    try {
      const status = execSync('git status --porcelain', opts).trim();
      const hasUnmerged = status.split('\n').some(line => line.startsWith('U') || line.startsWith('AA') || line.startsWith('DD'));
      if (hasUnmerged) {
        execSync('git reset HEAD', opts);
        execSync('git checkout -- .', opts);
        logger.info('  [cleanup] Reset unmerged files from previous crashed run');
      }
    } catch { /* status check failed; not critical */ }

    // Prune stale worktrees left by previous crashes
    try {
      execSync('git worktree prune', opts);
    } catch { /* prune failed; not critical */ }
  }

  private generateExecutionId(): string {
    return `swarm-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }

  /**
  /** Analyze commit quality and flag anti-patterns. Delegates to commit-quality-analyzer module. */
  private async analyzeCommitQuality(commits: ShareIndex['gitCommits'], stepNumber: number, agentName: string, _context: SwarmExecutionContext): Promise<void> {
    return _analyzeCommitQuality(commits, stepNumber, agentName);
  }

  /**
   * Write .copilot-instructions.md to the repo root with boilerplate every agent needs.
   * Copilot CLI picks this up automatically, so per-step prompts stay minimal.
   */
  private writeSharedInstructions(baseline?: BaselineSnapshot, tierInjection?: string): void {
    _writeSharedInstructions(this.workingDir, baseline, tierInjection);
  }

  /**
   * Run meta-analysis off the critical path. Fires asynchronously via setImmediate
   * so the scheduler can launch the next step without waiting for KB updates.
   */
  private runAsyncMetaAnalysis(
    context: SwarmExecutionContext,
    plan: ExecutionPlan,
    runDir: string,
    completedSteps: number[]
  ): void {
    if (!context.metaAnalyzer || !context.knowledgeBase) return;

    // Use the most recent completed step as the "wave" we are analyzing
    const waveIndex = completedSteps.length;

    try {
      const waveAnalysis = context.metaAnalyzer.analyzeWave(
        waveIndex,
        completedSteps,
        context.results,
        plan,
        context.executionId
      );

      context.waveAnalyses?.push(waveAnalysis);

      // Persist analysis snapshot
      const analysisPath = path.join(runDir, `analysis-batch-${waveIndex}.json`);
      fs.writeFileSync(analysisPath, JSON.stringify(waveAnalysis, null, 2), 'utf8');

      // Feed insights back into the knowledge base
      if (waveAnalysis.knowledgeUpdates.length > 0) {
        waveAnalysis.knowledgeUpdates.forEach(update => {
          context.knowledgeBase!.addOrUpdatePattern({
            category: update.category,
            insight: update.insight,
            confidence: update.confidence,
            evidence: [update.evidence],
            impact: update.confidence === 'high' ? 'high' : 'medium'
          });
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[analytics] Wave analysis failed (non-fatal): ${msg}`);
    }
  }

  /**
   * execute optional deployment for devops_pro when --confirm-deploy is set
   * captures preview URL and stores in context
   */
  private async executeOptionalDeployment(
    step: PlanStep,
    agent: AgentProfile,
    context: SwarmExecutionContext,
    options: { confirmDeploy?: boolean; enableExternal?: boolean; dryRun?: boolean }
  ): Promise<void> {
    await _executeOptionalDeployment(this.workingDir, step, agent, {
      runDir: context.runDir,
      executionId: context.executionId,
      results: context.results,
      deployments: context.deployments,
    }, options);
  }
}

export default SwarmOrchestrator;
