import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { defaultModelForAdapter } from './adapters';
import { AgentProfile, ConfigLoader } from './config-loader';
import ContextBroker from './context-broker';
import { DeploymentMetadata } from './deployment-manager';
import { ExecutionQueue, QueueStats } from './execution-queue';
import { KnowledgeBaseManager } from './knowledge-base';
import { MetaAnalyzer, MetaReviewResult } from './meta-analyzer';
import MetricsCollector from './metrics-collector';
import { ExecutionPlan, PlanStep, ReplanPayload } from './plan-generator';
import { runPostExecution, PostRunContext } from './post-run-reporter';
import { load_quality_gates_config } from './quality-gates';
import type { GateResult } from './quality-gates';
import SessionExecutor, { SessionResult } from './session-executor';
import ShareParser, { ShareIndex } from './share-parser';
import VerifierEngine, { VerificationResult } from './verifier-engine';
import { AdaptiveConcurrencyManager, WaveResizer } from './wave-resizer';
import { CostEstimator, CostEstimate } from './cost-estimator';
import { StepCostRecord } from './metrics-types';
import PRManager from './pr-manager';
import { WorktreeManager } from './worktree-manager';
import { BranchMerger, MergeContext } from './branch-merger';
import { BaselineSnapshot, scanBaseline } from './baseline-scanner';
import { TaskClassifier } from './task-classifier';
import { TIER_MAPS } from './tier-maps';
import { RequirementFilter, FilteredRequirements } from './requirement-filter';
import { getLogger, isPrettyMode } from './logger';
import { buildSwarmPrompt as _buildSwarmPrompt, writeSharedInstructions as _writeSharedInstructions } from './prompt-builder';
import { buildDependencyGraph as _buildDependencyGraph, identifyExecutionWaves as _identifyExecutionWaves } from './wave-scheduler';
import { executeOptionalDeployment as _executeOptionalDeployment } from './deployment-handler';
import { analyzeCommitQuality as _analyzeCommitQuality } from './commit-quality-analyzer';
import { PauseController } from './orchestrator/pause-controller';
import { sanitizeGitState as _sanitizeGitState, installDependenciesIfNeeded as _installDependenciesIfNeeded } from './orchestrator/git-state-utils';
import { runAsyncMetaAnalysis as _runAsyncMetaAnalysis } from './orchestrator/async-meta-analysis';
import {
  runFinalGatesPipeline as _runFinalGatesPipeline,
  buildRemediationStepForDelegate as _buildRemediationStepForDelegate,
  RemediationHost,
  QualityGatesTriggeredFlags,
} from './orchestrator/final-gates-remediation';
import {
  executeReplan as _executeReplan,
  ReplanHost,
} from './orchestrator/replan-runner';
import {
  executeStepInSwarm as _executeStepInSwarm,
  StepExecutorHost,
} from './orchestrator/step-executor';
import {
  runWaveLoop as _runWaveLoop,
  SchedulerHost,
} from './orchestrator/wave-scheduler-loop';

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
  lean?: boolean;
  useInnerFleet?: boolean;
  prMode?: 'auto' | 'review';
  hooksEnabled?: boolean;
  cliAgent?: string;
  owaspReport?: boolean;
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
export class SwarmOrchestrator implements RemediationHost, ReplanHost, StepExecutorHost, SchedulerHost {
  private sessionExecutor: SessionExecutor;
  public readonly shareParser: ShareParser;
  public readonly verifier: VerifierEngine;
  public readonly workingDir: string;
  private worktreeManager: WorktreeManager;
  private branchMerger: BranchMerger;
  public readonly pauseController: PauseController = new PauseController();

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
  public readonly targetMode: boolean;

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
   * Handles plans using lowercase ('worker', 'reviewer') against YAML agents.
   * Public to satisfy `RemediationHost`; callers outside the class should still
   * treat it as an internal helper.
   */
  resolveAgent(agents: Map<string, AgentProfile>, name: string): AgentProfile | undefined {
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
    this.pauseController.requestPause();
  }

  /**
   * Request resume of paused execution
   */
  requestResume(): void {
    this.pauseController.requestResume();
  }

  /**
   * Check if pause is requested
   */
  isPauseRequested(): boolean {
    return this.pauseController.isPauseRequested();
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

    // Scheduler loop: greedy as-soon-as-ready scheduling, lean-mode KB
    // injection, optional /fleet dispatch, adaptive concurrency.
    // See src/orchestrator/wave-scheduler-loop.ts
    // for the INVARIANT on context.plan re-read (executeReplan may swap
    // it mid-run; scheduler re-reads context.plan.steps every iteration).
    await _runWaveLoop(this, plan, agents, context, options);

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
    logger.info(`  ${completedResults.length} passed, ${failedResults.length} failed, ${context.totalWaves ?? 0} batch(es)`);

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

    // Re-queue failed steps before quality gates so their objectives aren't silently
    // dropped. A step that fails verification doesn't disappear — its required work
    // is still in scope. Build a targeted repair task per failed step, include the
    // original task text and the verification failure context, and run a replan pass
    // so the repair executes on the current merged state before gates run against it.
    const retriableFailures = context.results.filter(
      r => r.status === 'failed' && (r.retryCount ?? 0) < 3
    );
    if (retriableFailures.length > 0) {
      const completedStepNumbers = context.results
        .filter(r => r.status === 'completed')
        .map(r => r.stepNumber);
      const maxCompletedStep = completedStepNumbers.length > 0
        ? Math.max(...completedStepNumbers)
        : 0;

      const failedStepRetries: Array<{ agent: string; task: string; afterStep?: number }> = [];
      for (const failed of retriableFailures) {
        const originalStep = context.plan.steps.find(s => s.stepNumber === failed.stepNumber);
        if (!originalStep) continue;

        const failureDetail = failed.verificationResult?.failureContext ?? failed.error ?? 'Verification failed';
        const retryTask = [
          `The previous attempt by ${originalStep.agentName} failed verification.`,
          `Failure reason:\n${failureDetail}`,
          ``,
          `Original task:`,
          originalStep.task,
        ].join('\n');
        failedStepRetries.push({
          agent: originalStep.agentName,
          task: retryTask,
          ...(maxCompletedStep > 0 ? { afterStep: maxCompletedStep } : {}),
        });
      }

      if (failedStepRetries.length > 0) {
        logger.info(`\n🔁 Re-queuing ${failedStepRetries.length} failed step(s) with original objectives...`);
        await this.executeReplan(
          context,
          { retrySteps: [], addSteps: failedStepRetries },
          agents,
          options,
        );
        // Re-run dep install in case the repair step added packages.
        await this.installDependenciesIfNeeded();
      }
    }

    // final quality gates run on the merged state (hard gate)
    // this happens before auto-PR so we don't create a PR for a failing run
    const gatesEnabled = options?.qualityGates !== false;
    if (gatesEnabled) {
      const pipelineResult = await _runFinalGatesPipeline(
        this, context, runDir, agents, gatesConfig, options,
      );

      if (!pipelineResult.passed && gatesConfig.failOnIssues) {
        if (pipelineResult.remediationAttempted && failedResults.length === 0) {
          // All plan steps passed but remediation couldn't fully resolve
          // pre-existing quality gaps. Downgrade to a warning so the run
          // isn't marked failed for issues outside the plan's scope.
          const remaining = pipelineResult.finalGateResults
            .filter(r => r.status === 'fail')
            .map(r => `${r.id} (${r.issues.length} issues)`);
          logger.warn(`⚠️  Quality gates still have issues after remediation: ${remaining.join(', ')}`);
          logger.warn('   Treating as warning since all plan steps passed.');
        } else {
          logger.error('❌ Quality gates failed. See report in:', pipelineResult.gatesOut);
          throw new Error('Quality gates failed');
        }
      }
    }

    // merge all agent branches back to main
    logger.info('\n🔀 Merging agent branches to main...');
    // Clean up any stale locks before final merge (e.g. from cancelled runs)
    context.contextBroker.forceReleaseStaleLocks();
    await this.mergeAllBranches(context);

    // Metrics, cost attribution, session state, OWASP, KB recordRun, auto-PR.
    // All of this lives in src/post-run-reporter.ts; the inline block was a
    // pre-existing duplicate. See docs/post-run-diff-report.md for the
    // behavioral diff that preceded this swap.
    const postRunContext: PostRunContext = context;
    const postRunOptions: Parameters<typeof runPostExecution>[4] = {};
    if (options?.model !== undefined) postRunOptions.model = options.model;
    if (options?.cliAgent !== undefined) postRunOptions.cliAgent = options.cliAgent;
    if (options?.owaspReport !== undefined) postRunOptions.owaspReport = options.owaspReport;
    if (options?.strictIsolation !== undefined) postRunOptions.strictIsolation = options.strictIsolation;
    if (options?.enableExternal !== undefined) postRunOptions.enableExternal = options.enableExternal;
    if (options?.dryRun !== undefined) postRunOptions.dryRun = options.dryRun;
    if (options?.autoPR !== undefined) postRunOptions.autoPR = options.autoPR;
    await runPostExecution(this.workingDir, runDir, postRunContext, plan, postRunOptions);

    return context;
  }

  /**
   * Shared auto-remediation logic for quality gate failures -
   * delegates to final-gates-remediation module. Kept as a thin private
   * method so tests that invoke it via `(orch as any).buildRemediationStep`
   * continue to work unchanged.
   */
  private buildRemediationStep(
    gateResult: { status: string; issues?: Array<{ message: string; filePath?: string; hint?: string }> } | undefined,
    configEnabled: boolean,
    triggeredFlag: keyof QualityGatesTriggeredFlags,
    context: SwarmExecutionContext,
    agents: Map<string, AgentProfile>,
    taskDescription: string,
    warningMessage: string,
    afterStep: number,
    fallbackAgent: string,
  ): { agent: string; task: string; afterStep: number } | null {
    return _buildRemediationStepForDelegate(
      this, gateResult, configEnabled, triggeredFlag, context, agents,
      taskDescription, warningMessage, afterStep, fallbackAgent,
    );
  }

  /**
   * execute replan - delegates to replan-runner module. Public to satisfy
   * `RemediationHost` and `ReplanHost`; callers outside the class should
   * still treat it as an internal helper.
   *
   * WARNING: mutates context.plan by assignment. See replan-runner.ts
   * for the full invariant comment.
   */
  async executeReplan(
    context: SwarmExecutionContext,
    replanPayload: ReplanPayload,
    agents: Map<string, AgentProfile>,
    options?: SwarmExecutionOptions
  ): Promise<void> {
    return _executeReplan(this, context, replanPayload, agents, options);
  }

  /**
   * Execute a single step within the swarm - delegates to step-executor module.
   * Public to satisfy `ReplanHost` and `StepExecutorHost`; callers outside
   * the class should still treat it as an internal helper.
   */
  async executeStepInSwarm(
    step: PlanStep,
    agent: AgentProfile,
    context: SwarmExecutionContext,
    options?: SwarmExecutionOptions
  ): Promise<void> {
    return _executeStepInSwarm(this, step, agent, context, options);
  }
  /** Build prompt for swarm step execution. Delegates to prompt-builder module. */
  private buildSwarmPrompt(step: PlanStep, agent: AgentProfile, context: SwarmExecutionContext, dependencyContext: string): string {
    // Pass the orchestrator's working dir so prompt-builder can read the
    // target project's package.json to discover the real test gate.
    return _buildSwarmPrompt(
      step,
      agent,
      { ...context, targetProjectRoot: this.workingDir },
      dependencyContext,
    );
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
   * Public to satisfy `StepExecutorHost`.
   */
  async createAgentWorktree(
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
   * Public to satisfy `ReplanHost`.
   */
  async createAgentBranch(branchName: string, fromBranch: string): Promise<void> {
    return this.worktreeManager.createAgentBranch(branchName, fromBranch);
  }

  /**
   * Merge completed branches to main. Delegates to BranchMerger with
   * the appropriate context and tracks unmerged branches on the context.
   * Public to satisfy `ReplanHost`.
   */
  async mergeWaveBranches(
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
   * Detect whether agents introduced new dependencies and install them - delegates to git-state-utils.
   */
  private async installDependenciesIfNeeded(): Promise<void> {
    return _installDependenciesIfNeeded(this.workingDir);
  }

  /**
   * Switch to a git branch - delegates to WorktreeManager.
   * Public to satisfy `ReplanHost`.
   */
  async switchBranch(branchName: string): Promise<void> {
    return this.worktreeManager.switchBranch(branchName);
  }

  /**
   * Merge a branch with conflict detection
   */
  /**
   * Wait for resume signal - delegates to PauseController.
   */
  private async waitForResume(): Promise<void> {
    return this.pauseController.waitForResume();
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
   * Clean up leftover git state from crashed runs - delegates to git-state-utils.
   */
  private sanitizeGitState(): void {
    _sanitizeGitState(this.workingDir);
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
   * Run meta-analysis off the critical path - delegates to async-meta-analysis module.
   */
  private runAsyncMetaAnalysis(
    context: SwarmExecutionContext,
    plan: ExecutionPlan,
    runDir: string,
    completedSteps: number[]
  ): void {
    _runAsyncMetaAnalysis(context, plan, runDir, completedSteps);
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
