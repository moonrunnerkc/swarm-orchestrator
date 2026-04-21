import * as path from 'path';
import RepoAnalyzer from './repo-analyzer';
import GitHubIssuesIngester from './github-issues-ingester';
import MultiRepoCoordinator from './multi-repo-coordinator';
import BootstrapEvidenceManager from './bootstrap-evidence';
import { PlanGenerator } from './plan-generator';
import { ConfigLoader } from './config-loader';
import {
  BootstrapAnalysisResult,
  AnnotatedPlanStep,
  SourceAnnotation,
  GitHubIssueReference
} from './bootstrap-types';
import { ExecutionPlan } from './plan-generator';
import { getLogger } from './logger';
const logger = getLogger('bootstrap-orchestrator');

/**
 * Bootstrap Orchestrator - main entry point for bootstrap mode
 * Coordinates analysis, ingestion, and plan generation
 */
export class BootstrapOrchestrator {
  private repoAnalyzer: RepoAnalyzer;
  private issuesIngester: GitHubIssuesIngester;
  private multiRepoCoordinator: MultiRepoCoordinator;
  private evidenceManager: BootstrapEvidenceManager;
  private planGenerator: PlanGenerator;

  constructor() {
    this.repoAnalyzer = new RepoAnalyzer();
    this.issuesIngester = new GitHubIssuesIngester();
    this.multiRepoCoordinator = new MultiRepoCoordinator();
    this.evidenceManager = new BootstrapEvidenceManager();
    
    const configLoader = new ConfigLoader();
    const agents = configLoader.loadAllAgents();
    this.planGenerator = new PlanGenerator(agents);
  }

  /**
   * Execute full bootstrap analysis and plan generation
   */
  async bootstrap(
    repoPaths: string[],
    goal: string,
    runDir: string
  ): Promise<{ evidencePath: string; plan: ExecutionPlan & { steps: AnnotatedPlanStep[] } }> {
    logger.info('🔍 Bootstrap Analysis Starting...\n');

    // Step 1: Analyze all repos
    logger.info(`Analyzing ${repoPaths.length} repository(ies)...`);
    const repoAnalyses = await Promise.all(
      repoPaths.map(p => this.repoAnalyzer.analyzeRepo(p))
    );
    
    for (const analysis of repoAnalyses) {
      logger.info(`  ✓ ${analysis.repoName}: ${analysis.languages.join(', ')}`);
      logger.info(`    Build scripts: ${analysis.buildScripts.length}`);
      logger.info(`    Test scripts: ${analysis.testScripts.length}`);
      logger.info(`    Dependencies: ${analysis.dependencies.length}`);
      logger.info(`    Tech debt markers: ${analysis.techDebtMarkers.length}`);
      logger.info(`    Baseline concerns: ${analysis.baselineConcerns.length}`);
    }
    logger.info();

    // Step 2: Identify cross-repo relationships
    logger.info('Identifying cross-repo relationships...');
    const relationships = this.multiRepoCoordinator.identifyRelationships(repoAnalyses);
    logger.info(`  Found ${relationships.length} relationship(s)`);
    for (const rel of relationships) {
      logger.info(`    ${rel.sourceRepo} → ${rel.targetRepo} (${rel.type})`);
    }
    logger.info();

    // Step 3: Ingest GitHub issues
    logger.info('Fetching GitHub issues...');
    const allIssues: GitHubIssueReference[] = [];
    for (const repoPath of repoPaths) {
      const issues = await this.issuesIngester.fetchIssues(repoPath);
      allIssues.push(...issues);
    }
    logger.info(`  Found ${allIssues.length} open issue(s)`);
    
    // Link relevant issues to goal
    const relevantIssues = this.issuesIngester.linkIssuesToTasks(allIssues, goal);
    logger.info(`  ${relevantIssues.length} issue(s) relevant to goal`);
    for (const issue of relevantIssues.slice(0, 5)) {
      logger.info(`    #${issue.number}: ${issue.title}`);
    }
    logger.info();

    // Step 4: Build analysis result
    const analysisResult: BootstrapAnalysisResult = {
      repos: repoAnalyses,
      relationships,
      issues: relevantIssues,
      goal,
      analyzedAt: new Date().toISOString()
    };

    // Step 5: Generate annotated plan
    logger.info('Generating execution plan...');
    const plan = this.generateAnnotatedPlan(goal, analysisResult, repoPaths);
    logger.info(`  Generated ${plan.steps.length} step(s)`);
    logger.info();

    // Step 6: Save evidence
    logger.info('Saving bootstrap evidence...');
    const evidence = this.evidenceManager.createEvidence(goal, analysisResult, plan);
    const evidencePath = this.evidenceManager.saveEvidence(evidence, runDir);
    logger.info(`  ✓ Evidence saved: ${evidencePath}`);
    logger.info();

    logger.info('✅ Bootstrap analysis complete!\n');

    return { evidencePath, plan };
  }

  /**
   * Generate plan with source annotations.
   * Stamps each step with the resolved target repo path so execution
   * creates worktrees from the correct repository, not the orchestrator's own repo.
   */
  private generateAnnotatedPlan(
    goal: string,
    analysis: BootstrapAnalysisResult,
    repoPaths?: string[]
  ): ExecutionPlan & { steps: AnnotatedPlanStep[] } {
    // Use PlanGenerator to create base plan
    const basePlan = this.planGenerator.createPlan(goal);

    // Resolve target repo paths so worktrees are created from the right git history
    const resolvedRepoPaths = (repoPaths || []).map(p => path.resolve(p));
    const primaryRepo = resolvedRepoPaths[0];

    if (primaryRepo) {
      if (!basePlan.metadata) {
        basePlan.metadata = { totalSteps: basePlan.steps.length };
      }
      basePlan.metadata.targetDir = primaryRepo;
    }
    
    // Annotate steps with analysis evidence
    const annotatedSteps: AnnotatedPlanStep[] = basePlan.steps.map(step => {
      // Stamp step with the target repo so execution knows where to create worktrees
      if (primaryRepo && !step.repo) {
        step.repo = step.repo || primaryRepo;
      }
      const annotations: SourceAnnotation[] = [];

      // Link to relevant issues
      for (const issue of analysis.issues) {
        if (this.isStepRelatedToIssue(step.task, issue.title)) {
          annotations.push({
            type: 'github_issue',
            reference: `#${issue.number}`,
            evidence: `Issue: ${issue.title} (${issue.url})`
          });
        }
      }

      // Link to tech debt if tester/security step
      if (step.agentName === 'tester_elite' || step.agentName === 'security_auditor') {
        const relevantDebt = analysis.repos.flatMap(r => r.techDebtMarkers).slice(0, 3);
        for (const debt of relevantDebt) {
          annotations.push({
            type: 'tech_debt',
            reference: debt.location,
            evidence: debt.evidence
          });
        }
      }

      // Link to build scripts if relevant
      if (step.task.toLowerCase().includes('build') || step.task.toLowerCase().includes('compile')) {
        const buildScripts = analysis.repos.flatMap(r => r.buildScripts);
        for (const script of buildScripts) {
          annotations.push({
            type: 'build_script',
            reference: script.source,
            evidence: `Build command: ${script.command}`
          });
        }
      }

      return {
        ...step,
        sourceAnnotations: annotations
      };
    });

    return {
      ...basePlan,
      steps: annotatedSteps
    };
  }

  private isStepRelatedToIssue(task: string, issueTitle: string): boolean {
    const taskWords = task.toLowerCase().split(/\s+/);
    const issueWords = issueTitle.toLowerCase().split(/\s+/);
    
    // Simple keyword overlap check
    const overlap = taskWords.filter(w => w.length > 3 && issueWords.includes(w));
    return overlap.length >= 2;
  }
}

export default BootstrapOrchestrator;
