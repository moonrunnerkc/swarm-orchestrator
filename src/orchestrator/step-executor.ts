import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { resolveAdapter, AgentSpawnOptions } from '../adapters';
import { AgentProfile } from '../config-loader';
import { BaselineSnapshot } from '../baseline-scanner';
import { analyzeCommitQuality as _analyzeCommitQuality } from '../commit-quality-analyzer';
import { CostEstimate, CostEstimator } from '../cost-estimator';
import { DeploymentMetadata } from '../deployment-manager';
import { executeOptionalDeployment as _executeOptionalDeployment } from '../deployment-handler';
import { GeneratedHooks, HookGenerator } from '../hook-generator';
import { KnowledgeBaseManager } from '../knowledge-base';
import MetricsCollector from '../metrics-collector';
import { StepCostRecord } from '../metrics-types';
import { ExecutionPlan, PlanStep } from '../plan-generator';
import { buildSwarmPrompt as _buildSwarmPrompt } from '../prompt-builder';
import SessionExecutor, { SessionOptions, SessionResult } from '../session-executor';
import ShareParser, { ShareIndex } from '../share-parser';
import { Spinner } from '../spinner';
import { DEFAULT_DEPENDENCY_WAIT_MS } from '../defaults';
import VerifierEngine, { VerificationResult } from '../verifier-engine';
import { gitPathspecExcludes } from '../worktree-reserved-paths';
import { getLogger } from '../logger';

const logger = getLogger('orchestrator');

/**
 * Human-readable label for a CLI agent tool, used in fallback transcript headers.
 */
function transcriptToolLabel(tool: string): string {
  switch (tool) {
    case 'codex': return 'Codex';
    case 'claude-code': return 'Claude Code';
    case 'claude-code-teams': return 'Claude Code Teams';
    case 'copilot': return 'Copilot';
    default: return tool.charAt(0).toUpperCase() + tool.slice(1);
  }
}

/**
 * Narrow view of `ParallelStepResult` that step-executor mutates.
 * Defined locally so this module does not import from
 * swarm-orchestrator, which would form a circular dependency.
 * `ParallelStepResult` is assignable to this shape.
 */
export interface StepExecutorStepResult {
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
 * Narrow view of `ContextBroker` members step-executor calls.
 */
export interface StepExecutorContextBroker {
  waitForDependencies(deps: number[], timeoutMs: number): Promise<boolean>;
  getDependencyContext(deps: number[], strictIsolation?: boolean): string;
  addStepContext(entry: {
    stepNumber: number;
    agentName: string;
    timestamp: string;
    data: Record<string, unknown>;
  }): void;
}

/**
 * Context subset step-executor reads and mutates. Defined locally so
 * this module does not import `SwarmExecutionContext` from
 * swarm-orchestrator; `SwarmExecutionContext` satisfies this shape
 * structurally.
 */
export interface StepExecutorContext {
  plan: ExecutionPlan;
  results: StepExecutorStepResult[];
  contextBroker: StepExecutorContextBroker;
  mainBranch: string;
  executionId: string;
  runDir: string;
  metricsCollector?: MetricsCollector;
  baselineSnapshot?: BaselineSnapshot;
  knowledgeBase?: KnowledgeBaseManager;
  costEstimator?: CostEstimator;
  costEstimate?: CostEstimate;
  stepCostRecords?: StepCostRecord[];
  deployments?: DeploymentMetadata[];
}

/**
 * Options step-executor reads. Mirrors the subset of
 * `SwarmExecutionOptions` touched by executeStepInSwarm. Optional
 * callbacks use method-shorthand syntax so `SwarmExecutionOptions`
 * (which carries `(ctx: SwarmExecutionContext) => void` callbacks)
 * remains assignable under `exactOptionalPropertyTypes: true`.
 */
export interface StepExecutorOptions {
  model?: string;
  cliAgent?: string;
  strictIsolation?: boolean;
  useInnerFleet?: boolean;
  hooksEnabled?: boolean;
  confirmDeploy?: boolean;
  enableExternal?: boolean;
  dryRun?: boolean;
  onProgress?(context: StepExecutorContext, event: string): void;
  onAgentLine?(line: string): void;
}

/**
 * Orchestrator surface step-executor calls back into. Kept narrow
 * (4 members) by inlining the prompt-builder, commit-quality-analyzer,
 * and deployment-handler calls directly in this module; those
 * sibling modules already duck-type their contexts and do not
 * import from swarm-orchestrator, so no new cycle is introduced.
 */
export interface StepExecutorHost {
  readonly workingDir: string;
  readonly shareParser: ShareParser;
  readonly verifier: VerifierEngine;
  createAgentWorktree(
    branchName: string,
    fromBranch: string,
    runDir: string,
    stepNumber: number,
    repoDir?: string
  ): Promise<string>;
}

/**
 * Execute a single step end-to-end: wait for deps, create worktree,
 * build prompt, run the agent session, commit
 * uncommitted work, verify, record context / cost / metrics, optional
 * deployment on success, rollback on failure.
 *
 * Mutates `context.results[<stepNumber>]` in place for status,
 * branchName, timestamps, sessionResult, verificationResult, and error.
 * Pushes to `context.stepCostRecords` when cost tracking is active.
 *
 * Throws on verification failure so the scheduler can mark the step
 * failed; a ContextEntry is still added to the broker on failure so
 * downstream waiters don't hang.
 *
 * @param host - orchestrator surface (workingDir, shareParser,
 *   verifier, createAgentWorktree)
 * @param step - the plan step to execute
 * @param agent - the agent assigned to this step
 * @param context - mutable execution context
 * @param options - execution options (model, cliAgent, hooks, etc.)
 */
export async function executeStepInSwarm(
  host: StepExecutorHost,
  step: PlanStep,
  agent: AgentProfile,
  context: StepExecutorContext,
  options?: StepExecutorOptions
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
    const stepRepoDir = step.repo || host.workingDir;
    const worktreePath = await host.createAgentWorktree(branchName, context.mainBranch, context.runDir, step.stepNumber, stepRepoDir);
    logger.info(`  🌿 Step ${step.stepNumber} (${agent.name}) on branch: ${branchName}`);

    // Capture baseline SHA before agent execution for outcome-based verification
    const baseSha = execSync('git rev-parse HEAD', { cwd: worktreePath, encoding: 'utf8' }).trim();

    // build enhanced prompt with dependency context
    const strictIsolation = options?.strictIsolation ?? false;
    const dependencyContext = context.contextBroker.getDependencyContext(step.dependencies, strictIsolation);
    const enhancedPrompt = _buildSwarmPrompt(
      step,
      agent,
      { ...context, targetProjectRoot: host.workingDir },
      dependencyContext,
    );

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

    // only call the agent if we don't already have a session result
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
      const toolLabel = transcriptToolLabel(options?.cliAgent || 'copilot');
      const fallbackContent = `# ${toolLabel} Session Transcript\n\nSession output:\n\`\`\`\n${result.sessionResult?.output || 'No output captured'}\n\`\`\`\n`;
      fs.writeFileSync(transcriptPath, fallbackContent, 'utf8');
    }

    // parse transcript for context
    const transcriptContent = fs.readFileSync(transcriptPath, 'utf8');
    const shareIndex: ShareIndex = host.shareParser.parse(transcriptContent);

    // Track commits from this step
    if (shareIndex.gitCommits) {
      shareIndex.gitCommits.forEach(() => {
        context.metricsCollector?.trackCommit(agent.name);
      });

      // Analyze commit quality for anti-patterns
      await _analyzeCommitQuality(shareIndex.gitCommits, step.stepNumber, agent.name);
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

    const verificationResult = await host.verifier.verifyStep(
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

    await host.verifier.generateVerificationReport(verificationResult, reportPath);

    if (verificationResult.passed) {
      verifySpinner.succeed(`Step ${step.stepNumber} (${agent.name}) verified ✓`);

      // add to shared context BEFORE advisory gates so replan steps can depend on this step
      context.contextBroker.addStepContext({
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
      });

      await host.verifier.commitVerificationReport(
        reportPath,
        step.stepNumber,
        agent.name,
        true
      );

      // Quality gates run only in the final pass (after all branches merged) to avoid
      // spawning extra Copilot sessions mid-execution. The final gates block handles
      // auto-remediation for every gate type, making per-step checks redundant.

      // optional deployment for deployment-focused steps when --confirm-deploy is set
      const isDeploymentStep = /\b(deploy|deployment|vercel|netlify)\b/i.test(step.task);
      if (isDeploymentStep && options?.confirmDeploy) {
        await _executeOptionalDeployment(host.workingDir, step, agent, {
          runDir: context.runDir,
          executionId: context.executionId,
          results: context.results,
          deployments: context.deployments,
        }, {
          ...(options.confirmDeploy !== undefined && { confirmDeploy: options.confirmDeploy }),
          ...(options.enableExternal !== undefined && { enableExternal: options.enableExternal }),
          ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
        });
      }
    } else {
      // verification failed - attempt rollback
      verifySpinner.warn(`Step ${step.stepNumber} verification failed, rolling back...`);

      const rollbackResult = await host.verifier.rollback(
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
    context.contextBroker.addStepContext({
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
    });

    // Notify progress: step failed
    options?.onProgress?.(context, `step-failed:${step.stepNumber}`);

    logger.error(`  ❌ Step ${step.stepNumber} (${agent.name}) failed: ${err.message}`);
    throw error;
  }
}
