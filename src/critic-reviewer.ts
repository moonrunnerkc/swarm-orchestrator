import { ParallelStepResult } from './swarm-orchestrator';
import { ExecutionPlan } from './plan-generator';
import { CriticResult } from './types';

/**
 * Pure critic-review function extracted from SwarmOrchestrator.
 *
 * Scores completed step results against the execution plan and returns
 * a CriticResult with a numeric score, typed flags, and a recommendation
 * of 'approve' | 'revise' | 'reject'.
 */
export function runCriticReview(
  completedResults: ParallelStepResult[],
  plan: ExecutionPlan
): CriticResult {
  const flags: string[] = [];
  let score = 100;

  // per-axis deduction weights
  const weights: Record<string, number> = {
    test: 20, build: 25, lint: 5, commit: 10, claim: 5
  };

  for (const result of completedResults) {
    const step = plan.steps.find(s => s.stepNumber === result.stepNumber);
    if (!step) continue;

    // aggregate checks by type for this step
    if (result.verificationResult) {
      const byType = new Map<string, { passed: number; failed: number; reasons: string[] }>();
      for (const check of result.verificationResult.checks) {
        const entry = byType.get(check.type) || { passed: 0, failed: 0, reasons: [] };
        if (check.passed) {
          entry.passed++;
        } else {
          entry.failed++;
          if (check.reason) entry.reasons.push(check.reason);
        }
        byType.set(check.type, entry);
      }

      // score each axis and generate typed flags
      for (const [type, counts] of byType) {
        if (counts.failed > 0) {
          const deduction = (weights[type] || 10) * counts.failed;
          score -= deduction;
          const total = counts.passed + counts.failed;
          const detail = counts.reasons.length > 0 ? ` (${counts.reasons[0]})` : '';
          flags.push(`step-${result.stepNumber}: ${counts.failed}/${total} ${type} checks failed${detail}`);
        }
      }
    }

    // missing session output
    if (step.expectedOutputs.length > 0 && !result.sessionResult) {
      flags.push(`step-${result.stepNumber}: no session output captured`);
      score -= 10;
    }
  }

  score = Math.max(0, Math.min(100, score));
  const recommendation = flags.length === 0 ? 'approve' : score >= 60 ? 'revise' : 'reject';

  return { score, flags, recommendation };
}
