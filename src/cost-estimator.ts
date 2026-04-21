import { ExecutionPlan } from './plan-generator';
import { KnowledgeBaseManager } from './knowledge-base';
import { CostHistoryEvidence } from './metrics-types';
import { DEFAULT_REMEDIATION_RATE, DEFAULT_RETRY_PROBABILITY } from './defaults';

/**
 * Model multipliers for premium request consumption.
 * Each copilot -p invocation = 1 base premium request * multiplier.
 * Updated as GitHub changes pricing: https://docs.github.com/en/copilot/concepts/billing/copilot-requests
 * Model availability varies by Copilot plan; Copilot CLI will reject
 * unavailable models at runtime with "not available" on stderr.
 */
export const MODEL_MULTIPLIERS: Record<string, number> = {
  'claude-sonnet-4': 1,
  'claude-sonnet-4.6': 1,
  'claude-opus-4': 1,
  'gpt-4o': 1,
  'gpt-5.2': 1,
  'gpt-5.4': 1,
  'o3': 20,
  'o4-mini': 5,
};

const MAX_RETRY_PROBABILITY = 0.50;
const OVERAGE_COST_PER_REQUEST = 0.04;

// Quality gate remediation overhead: proportion of planned steps that
// typically trigger remediation follow-ups. Derived from observed runs
// where ~29% of total requests were gate-triggered remediation steps.
// Rounded down to 0.25 as a conservative default. Applied per-step, then
// ceiled to whole requests since partial agent invocations aren't possible.
const MAX_REMEDIATION_RATE = 0.50;

// Rough token count for the static boilerplate injected by buildSwarmPrompt.
// Measured from actual prompt captures; chars / 4 approximation.
const STATIC_BOILERPLATE_TOKENS = 350;

export interface CostEstimateOptions {
  modelName: string;
  remainingAllowance?: number;
  fleetMode?: boolean;
  qualityGatesEnabled?: boolean;
  /** When true, plan was generated with gate-aware prompts; reduces retry probability by 30%. */
  gateAwarePrompts?: boolean;
}

export interface StepCostEstimate {
  stepNumber: number;
  agentName: string;
  estimatedPromptTokens: number;
  estimatedPremiumRequests: number;
  retryProbability: number;
  rationale: string;
}

export interface CostEstimate {
  totalPremiumRequests: number;
  lowEstimate: number;
  highEstimate: number;
  perStep: StepCostEstimate[];
  retryBuffer: number;
  remediationBuffer: number;
  modelMultiplier: number;
  overageCostUSD: number;
  remainingAllowance?: number;
}

interface ActualRecord {
  stepNumber: number;
  estimatedRequests: number;
  actualRequests: number;
  retryCount: number;
}

export class CostEstimator {
  private knowledgeBase: KnowledgeBaseManager | undefined;
  private actuals: ActualRecord[] = [];

  constructor(knowledgeBase?: KnowledgeBaseManager) {
    this.knowledgeBase = knowledgeBase;
  }

  estimate(plan: ExecutionPlan, options: CostEstimateOptions): CostEstimate {
    const multiplier = MODEL_MULTIPLIERS[options.modelName] ?? 1;
    let retryProbability = this.calibrateRetryProbability(plan);

    // Gate-aware prompts reduce repair cycles by front-loading requirements.
    // Conservative estimate: 30% reduction in retry probability.
    if (options.gateAwarePrompts) {
      retryProbability *= 0.7;
    }

    const perStep: StepCostEstimate[] = plan.steps.map(step => {
      const taskTokens = Math.ceil(step.task.length / 4);
      const promptTokens = STATIC_BOILERPLATE_TOKENS + taskTokens;
      const baseRequests = 1 * multiplier;
      const fleetMultiplier = options.fleetMode
        ? this.estimateFleetMultiplier(step.task)
        : 1;
      // Per-step estimate is the base cost without retry inflation.
      // Retry buffer is calculated as an aggregate across the plan.
      const stepRequests = baseRequests * fleetMultiplier;

      return {
        stepNumber: step.stepNumber,
        agentName: step.agentName,
        estimatedPromptTokens: promptTokens,
        estimatedPremiumRequests: stepRequests,
        retryProbability,
        rationale: this.buildRationale(multiplier, fleetMultiplier, retryProbability, options),
      };
    });

    const baseTotalNoRetry = perStep.reduce((sum, s) => sum + s.estimatedPremiumRequests, 0);
    // Retry buffer is the aggregate expected retry cost across all steps
    const retryBuffer = Math.ceil(baseTotalNoRetry * retryProbability);
    // Remediation buffer: when quality gates are enabled, some steps will
    // fail gate checks and trigger automated follow-up remediation steps.
    // Each remediation step costs one premium request per model multiplier.
    const remediationRate = options.qualityGatesEnabled
      ? this.calibrateRemediationRate(plan)
      : 0;
    const remediationBuffer = Math.ceil(plan.steps.length * remediationRate * multiplier);
    const totalRaw = baseTotalNoRetry + retryBuffer + remediationBuffer;

    // Low estimate assumes no retries and no remediation
    const lowEstimate = baseTotalNoRetry;
    const highEstimate = totalRaw;

    const overageCostUSD = options.remainingAllowance !== undefined
      ? Math.max(0, totalRaw - options.remainingAllowance) * OVERAGE_COST_PER_REQUEST
      : 0;

    return {
      totalPremiumRequests: totalRaw,
      lowEstimate,
      highEstimate,
      perStep,
      retryBuffer: Math.max(0, retryBuffer),
      remediationBuffer,
      modelMultiplier: multiplier,
      overageCostUSD: parseFloat(overageCostUSD.toFixed(2)),
      ...(options.remainingAllowance !== undefined
        ? { remainingAllowance: options.remainingAllowance }
        : {}),
    };
  }

  recordActual(stepNumber: number, estimatedRequests: number, actualRequests: number, retryCount: number): void {
    this.actuals.push({ stepNumber, estimatedRequests, actualRequests, retryCount });
  }

  /**
   * Ratio of correctly-estimated steps to total recorded steps.
   * A step is "correct" if estimated >= actual (no underestimate).
   * Returns 1.0 when no actuals recorded (no data to disprove accuracy).
   */
  getAccuracy(): number {
    if (this.actuals.length === 0) return 1.0;

    const totalEstimated = this.actuals.reduce((s, a) => s + a.estimatedRequests, 0);
    const totalActual = this.actuals.reduce((s, a) => s + a.actualRequests, 0);

    if (totalActual === 0) return 1.0;
    // Conservative overestimates are acceptable; only penalize underestimates.
    // Accuracy for overestimates: actual / estimated (closer to 1 = tighter).
    // Accuracy for underestimates: estimated / actual (penalizes gaps).
    if (totalEstimated >= totalActual) {
      return totalActual / totalEstimated;
    }
    return totalEstimated / totalActual;
  }

  /**
   * Pull historical failure rate from knowledge base cost_history patterns.
   * Falls back to DEFAULT_RETRY_PROBABILITY when no history exists.
   * Parses structured CostHistoryEvidence from evidence array.
   * Falls back to legacy string parsing for pre-v3.3 entries.
   */
  private calibrateRetryProbability(_plan: ExecutionPlan): number {
    if (!this.knowledgeBase) return DEFAULT_RETRY_PROBABILITY;

    const costPatterns = this.knowledgeBase.getPatternsByCategory('cost_history');
    if (costPatterns.length === 0) return DEFAULT_RETRY_PROBABILITY;

    let totalRetries = 0;
    let totalSteps = 0;
    for (const pattern of costPatterns) {
      // Try structured evidence first (single JSON string per entry)
      const parsed = this.parseStructuredEvidence(pattern.evidence);
      if (parsed) {
        totalSteps += parsed.actual;
        totalRetries += parsed.retries;
        continue;
      }

      // Legacy fallback: string-encoded fields
      for (const ev of pattern.evidence) {
        if (ev.startsWith('actual:')) {
          const actual = parseInt(ev.split(':')[1], 10);
          if (!isNaN(actual)) totalSteps += actual;
        }
      }
      const retryMatch = pattern.insight.match(/(\d+)\s+retries/);
      if (retryMatch) {
        totalRetries += parseInt(retryMatch[1], 10);
      }
    }

    if (totalSteps === 0) return DEFAULT_RETRY_PROBABILITY;

    const rate = totalRetries / totalSteps;
    return Math.min(rate, MAX_RETRY_PROBABILITY);
  }

  /**
   * Pull historical remediation rate from knowledge base cost_history patterns.
   * Remediation steps are quality-gate-triggered follow-ups (not retries).
   * Falls back to DEFAULT_REMEDIATION_RATE when no history with remediation
   * data exists. Only structured evidence (v4.2+) carries remediation counts.
   */
  private calibrateRemediationRate(_plan: ExecutionPlan): number {
    if (!this.knowledgeBase) return DEFAULT_REMEDIATION_RATE;

    const costPatterns = this.knowledgeBase.getPatternsByCategory('cost_history');
    if (costPatterns.length === 0) return DEFAULT_REMEDIATION_RATE;

    let totalPlannedSteps = 0;
    let totalRemediationSteps = 0;
    for (const pattern of costPatterns) {
      const parsed = this.parseStructuredEvidence(pattern.evidence);
      if (!parsed) continue;
      if (typeof parsed.remediationSteps !== 'number') continue;
      totalPlannedSteps += parsed.steps;
      totalRemediationSteps += parsed.remediationSteps;
    }

    if (totalPlannedSteps === 0) return DEFAULT_REMEDIATION_RATE;

    const rate = totalRemediationSteps / totalPlannedSteps;
    return Math.min(rate, MAX_REMEDIATION_RATE);
  }

  /**
   * Attempt to parse a CostHistoryEvidence object from the evidence array.
   * Returns null if the evidence uses the legacy string format.
   */
  private parseStructuredEvidence(evidence: string[]): CostHistoryEvidence | null {
    if (evidence.length !== 1) return null;
    try {
      const obj = JSON.parse(evidence[0]) as Record<string, unknown>;
      if (typeof obj.runId === 'string' && typeof obj.actual === 'number') {
        return obj as unknown as CostHistoryEvidence;
      }
    } catch {
      // Not JSON; legacy format
    }
    return null;
  }

  /**
   * Heuristic fleet multiplier: tasks mentioning multiple files or components
   * likely trigger more subagents.
   */
  private estimateFleetMultiplier(taskDescription: string): number {
    const lower = taskDescription.toLowerCase();
    const multiFileIndicators = [
      'multiple files', 'several files', 'all files',
      'each module', 'every module', 'across modules',
      'components', 'services', 'endpoints',
    ];
    const matchCount = multiFileIndicators.filter(ind => lower.includes(ind)).length;

    if (matchCount >= 2) return 4;
    if (matchCount === 1) return 3;

    // Check for list-like patterns (commas separating items in the task)
    const commaSegments = taskDescription.split(',').length;
    if (commaSegments >= 4) return 3;
    if (commaSegments >= 2) return 2;

    return 2; // fleet always spawns at least one subagent beyond the coordinator
  }

  private buildRationale(
    multiplier: number,
    fleetMultiplier: number,
    retryProb: number,
    options: CostEstimateOptions,
  ): string {
    const parts: string[] = [
      `${options.modelName} (${multiplier}x)`,
    ];
    if (options.fleetMode) {
      parts.push(`fleet (${fleetMultiplier}x subagents)`);
    }
    parts.push(`${(retryProb * 100).toFixed(0)}% retry buffer`);
    return parts.join(', ');
  }
}
