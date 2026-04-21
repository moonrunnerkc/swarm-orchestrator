import { ParallelStepResult } from './swarm-orchestrator';
import { ExecutionPlan, PlanStep } from './plan-generator';

export interface MetaReviewResult {
  analysisTimestamp: string;
  executionId: string;
  waveAnalyzed: number;
  overallHealth: 'healthy' | 'degraded' | 'critical';
  stepReviews: StepReview[];
  detectedPatterns: DetectedPattern[];
  replanNeeded: boolean;
  replanReason: string | null;
  suggestedChanges: SuggestedChange[];
  knowledgeUpdates: KnowledgeUpdate[];
  nextActions: string[];
}

export interface StepReview {
  stepNumber: number;
  agentName: string;
  verificationPassed: boolean;
  issues: string[];
  rootCause: string;
  recommendation: string;
}

export interface DetectedPattern {
  type: 'anti-pattern' | 'good-pattern' | 'context-gap' | 'scope-creep';
  pattern: string;
  occurrences: number;
  affectedAgents: string[];
  example: string;
  severity: 'low' | 'medium' | 'high';
}

export interface SuggestedChange {
  type: 're-execute' | 'add-step' | 'modify-step' | 'reorder-steps';
  targetStep?: number;
  reason: string;
  details: string;
}

export interface KnowledgeUpdate {
  category: 'dependency_order' | 'agent_behavior' | 'anti_pattern' | 'best_practice';
  insight: string;
  confidence: 'low' | 'medium' | 'high';
  evidence: string;
}

export interface ReplanDecision {
  shouldReplan: boolean;
  reason: string;
  newSteps?: PlanStep[];
  stepsToRetry?: number[];
  preserveHistory: boolean;
}

/**
 * meta-analysis engine - reviews execution quality and decides on replanning
 */
export class MetaAnalyzer {
  /**
   * analyze wave results and determine if replanning needed
   */
  analyzeWave(
    waveIndex: number,
    waveSteps: number[],
    results: ParallelStepResult[],
    plan: ExecutionPlan,
    executionId: string
  ): MetaReviewResult {
    const waveResults = results.filter(r => waveSteps.includes(r.stepNumber));
    
    const stepReviews: StepReview[] = waveResults.map(result => {
      return this.reviewStep(result);
    });

    const detectedPatterns = this.detectPatterns(waveResults);
    const failureRate = stepReviews.filter(r => !r.verificationPassed).length / stepReviews.length;
    
    let overallHealth: MetaReviewResult['overallHealth'] = 'healthy';
    if (failureRate > 0.5) {
      overallHealth = 'critical';
    } else if (failureRate > 0.2) {
      overallHealth = 'degraded';
    }

    const replanNeeded = failureRate > 0.5;
    const replanReason = replanNeeded 
      ? `Wave ${waveIndex + 1} failed: ${Math.round(failureRate * 100)}% of steps did not pass verification`
      : null;

    const suggestedChanges = this.generateSuggestedChanges(stepReviews, plan);
    const knowledgeUpdates = this.extractKnowledge(stepReviews, detectedPatterns);
    const nextActions = this.determineNextActions(overallHealth, replanNeeded, suggestedChanges);

    return {
      analysisTimestamp: new Date().toISOString(),
      executionId,
      waveAnalyzed: waveIndex + 1,
      overallHealth,
      stepReviews,
      detectedPatterns,
      replanNeeded,
      replanReason,
      suggestedChanges,
      knowledgeUpdates,
      nextActions
    };
  }

  /**
   * review individual step result
   */
  private reviewStep(result: ParallelStepResult): StepReview {
    const verificationPassed = result.verificationResult?.passed ?? false;
    const issues: string[] = [];
    let rootCause = 'Unknown';
    let recommendation = 'Continue';

    if (!verificationPassed && result.verificationResult) {
      // analyze verification failures
      result.verificationResult.checks.forEach(check => {
        if (!check.passed && check.required) {
          issues.push(`${check.type}: ${check.description} - ${check.reason || 'failed'}`);
        }
      });

      if (result.verificationResult.unverifiedClaims.length > 0) {
        issues.push(`Unverified claims: ${result.verificationResult.unverifiedClaims.length} detected`);
      }

      // determine root cause
      if (issues.some(i => i.includes('test'))) {
        rootCause = 'Tests not executed or failed';
        recommendation = 'Re-execute with explicit test requirement';
      } else if (issues.some(i => i.includes('build'))) {
        rootCause = 'Build not executed or failed';
        recommendation = 'Re-execute with build verification';
      } else if (issues.some(i => i.includes('commit'))) {
        rootCause = 'No commits made';
        recommendation = 'Re-execute with commit requirement';
      } else {
        rootCause = 'Verification checks failed';
        recommendation = 'Review transcript and re-execute';
      }
    }

    return {
      stepNumber: result.stepNumber,
      agentName: result.agentName,
      verificationPassed,
      issues,
      rootCause,
      recommendation
    };
  }

  /**
   * detect patterns across multiple steps
   */
  private detectPatterns(results: ParallelStepResult[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // check for generic commit messages (anti-pattern)
    const genericCommitAgents = results.filter(r => {
      const commits = r.verificationResult?.checks.find(c => c.type === 'commit');
      if (!commits?.evidence) return false;
      return /update|fix|change/i.test(commits.evidence) && commits.evidence.length < 30;
    });

    if (genericCommitAgents.length >= 2) {
      patterns.push({
        type: 'anti-pattern',
        pattern: 'generic_commit_messages',
        occurrences: genericCommitAgents.length,
        affectedAgents: genericCommitAgents.map(r => r.agentName),
        example: 'Commits like "update files" or "fix issues"',
        severity: 'medium'
      });
    }

    // check for unverified claims (drift)
    const driftingAgents = results.filter(r => {
      return (r.verificationResult?.unverifiedClaims.length || 0) > 2;
    });

    if (driftingAgents.length >= 1) {
      patterns.push({
        type: 'context-gap',
        pattern: 'unverified_claims',
        occurrences: driftingAgents.length,
        affectedAgents: driftingAgents.map(r => r.agentName),
        example: 'Agent claims work done without evidence in transcript',
        severity: 'high'
      });
    }

    return patterns;
  }

  /**
   * generate suggested changes based on review
   */
  private generateSuggestedChanges(
    stepReviews: StepReview[],
    _plan: ExecutionPlan
  ): SuggestedChange[] {
    const changes: SuggestedChange[] = [];

    stepReviews.forEach(review => {
      if (!review.verificationPassed) {
        changes.push({
          type: 're-execute',
          targetStep: review.stepNumber,
          reason: review.rootCause,
          details: review.recommendation
        });
      }
    });

    return changes;
  }

  /**
   * extract knowledge from analysis
   */
  private extractKnowledge(
    stepReviews: StepReview[],
    patterns: DetectedPattern[]
  ): KnowledgeUpdate[] {
    const updates: KnowledgeUpdate[] = [];

    // extract from patterns
    patterns.forEach(pattern => {
      if (pattern.severity === 'high') {
        updates.push({
          category: pattern.type === 'anti-pattern' ? 'anti_pattern' : 'agent_behavior',
          insight: `Pattern detected: ${pattern.pattern} in ${pattern.occurrences} step(s)`,
          confidence: 'high',
          evidence: pattern.example
        });
      }
    });

    return updates;
  }

  /**
   * determine next actions
   */
  private determineNextActions(
    health: MetaReviewResult['overallHealth'],
    replanNeeded: boolean,
    changes: SuggestedChange[]
  ): string[] {
    const actions: string[] = [];

    if (replanNeeded) {
      actions.push('Trigger full replan');
      actions.push('Preserve git history from completed steps');
    } else if (health === 'degraded') {
      if (changes.length > 0) {
        actions.push(`Re-execute ${changes.length} failed step(s)`);
      }
      actions.push('Monitor next wave closely');
    } else {
      actions.push('Continue to next wave');
    }

    return actions;
  }

  /**
   * make replan decision based on analysis
   */
  makeReplanDecision(
    analysis: MetaReviewResult,
    _plan: ExecutionPlan,
    _completedSteps: number[]
  ): ReplanDecision {
    if (!analysis.replanNeeded) {
      return {
        shouldReplan: false,
        reason: 'Execution healthy, continue as planned',
        preserveHistory: true
      };
    }

    // identify which steps to retry
    const stepsToRetry = analysis.suggestedChanges
      .filter(c => c.type === 're-execute')
      .map(c => c.targetStep!)
      .filter(s => s !== undefined);

    return {
      shouldReplan: true,
      reason: analysis.replanReason || 'Critical issues detected',
      stepsToRetry,
      preserveHistory: true
    };
  }
}
