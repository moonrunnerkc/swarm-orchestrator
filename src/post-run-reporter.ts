import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from './logger';
import { ExecutionPlan } from './plan-generator';
import MetricsCollector from './metrics-collector';
import { CostEstimator, CostEstimate } from './cost-estimator';
import { StepCostRecord, CostAttribution, CostHistoryEvidence } from './metrics-types';
import { KnowledgeBaseManager } from './knowledge-base';
import { MetaReviewResult } from './meta-analyzer';
import type { GateResult } from './quality-gates';
import AnalyticsLog from './analytics-log';
import { SessionState } from './types';
import { VerificationResult } from './verifier-engine';
import ExternalToolManager from './external-tool-manager';
import DeploymentManager from './deployment-manager';
import PRAutomation from './pr-automation';
import { defaultModelForAdapter } from './adapters';
import { BaselineSnapshot } from './baseline-scanner';

const logger = getLogger('post-run');

/**
 * Structural subset of `ParallelStepResult` that this module consumes.
 * Mirrored locally so post-run-reporter does not import from
 * swarm-orchestrator, which — now that swarm-orchestrator imports
 * `runPostExecution` — would form a circular dependency.
 * `ParallelStepResult` (the orchestrator's full type) is assignable to
 * this narrower shape, so existing callers need no changes.
 */
export interface PostRunStepResult {
  stepNumber: number;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  branchName?: string;
  sessionResult?: { transcriptPath?: string };
  verificationResult?: VerificationResult;
  retryCount?: number;
}

export interface PostRunContext {
  executionId: string;
  /**
   * Integration branch name (e.g. "main", "master", "trunk"). Flows into
   * `generatePRSummary` as `baseBranch` when `options.autoPR` is set.
   * Required even when autoPR is not used so the type stays explicit about
   * the orchestrator invariant.
   */
  mainBranch: string;
  results: PostRunStepResult[];
  metricsCollector?: MetricsCollector;
  costEstimator?: CostEstimator;
  costEstimate?: CostEstimate;
  stepCostRecords?: StepCostRecord[];
  knowledgeBase?: KnowledgeBaseManager;
  waveAnalyses?: MetaReviewResult[];
  finalGateResults?: GateResult[];
  baselineSnapshot?: BaselineSnapshot;
}

export interface PostRunOptions {
  model?: string;
  cliAgent?: string;
  owaspReport?: boolean;
  strictIsolation?: boolean;
  enableExternal?: boolean;
  dryRun?: boolean;
  autoPR?: boolean;
}

export async function runPostExecution(
  workingDir: string,
  runDir: string,
  context: PostRunContext,
  plan: ExecutionPlan,
  options?: PostRunOptions
): Promise<void> {
  // Finalize metrics and save to analytics log
  if (context.metricsCollector) {
    const metrics = context.metricsCollector.finalize();

    // Save metrics to run directory
    const metricsPath = path.join(runDir, 'metrics.json');
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), 'utf8');

    // Append to analytics log
    const analyticsLog = new AnalyticsLog();
    analyticsLog.appendRun(metrics);

    logger.debug(`metrics ${metricsPath}`);

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

      const deploymentManager = new DeploymentManager(toolManager, workingDir);
      const prAutomation = new PRAutomation(toolManager, workingDir);

      const deployments = deploymentManager.loadDeploymentMetadata(runDir);
      // generatePRSummary accepts a narrow PRSummaryContext (duck-typed in
      // pr-automation.ts). `mainBranch` on the PostRunContext feeds
      // PRSummary.baseBranch; plan fills in plan.goal.
      const summary = prAutomation.generatePRSummary({ ...context, plan }, deployments);
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
}
