/**
 * Type definitions for productivity analytics and personalization
 */

/**
 * Metrics captured from a single orchestrator run
 */
export interface RunMetrics {
  executionId: string;
  goal: string;
  startTime: string;
  endTime: string;
  totalTimeMs: number;
  waveCount: number;
  stepCount: number;
  commitCount: number;
  verificationsPassed: number;
  verificationsFailed: number;
  recoveryEvents: RecoveryEvent[];
  agentsUsed: string[];
}

/**
 * A recovery event where failure led to replan/retry and eventual success
 */
export interface RecoveryEvent {
  stepNumber: number;
  agentName: string;
  failedAt: string;
  recoveredAt: string;
  recoveryMethod: 'retry' | 'replan' | 'rollback' | 'manual';
}

/**
 * A single entry in the analytics log
 */
export interface AnalyticsEntry {
  schemaVersion: number;
  timestamp: string;
  metrics: RunMetrics;
}

/**
 * User preferences and learned behaviors
 */
export interface UserProfile {
  schemaVersion: number;
  preferences: {
    commitStyle?: 'conventional' | 'imperative' | 'descriptive' | 'mixed';
    agentPriorities?: Record<string, number>; // agent name -> priority (1-10)
    preferredModel?: string;
    verbosity?: 'minimal' | 'normal' | 'detailed';
  };
  learnedBehaviors?: {
    averageRunTime?: number;
    mostUsedAgents?: string[];
    commitFrequency?: number; // commits per step
  };
}

/**
 * Comparison result between current and historical runs
 */
export interface MetricsComparison {
  current: RunMetrics;
  averageHistorical: {
    totalTimeMs: number;
    commitCount: number;
    verificationPassRate: number;
  };
  delta: {
    timePercent: number; // positive = slower, negative = faster
    commitCountDiff: number;
    passRateDiff: number;
  };
}

/**
 * Premium request consumption for a single step.
 * Estimated pre-execution, actual recorded post-execution.
 */
export interface StepCostRecord {
  stepNumber: number;
  agentName: string;
  estimatedPremiumRequests: number;
  actualPremiumRequests: number;
  retryCount: number;
  promptTokens: number;
  fleetMode: boolean;
  durationMs: number;
}

/**
 * Per-adapter falsification yield and cost aggregate. One entry per
 * (adapter, obligation-type) pair per run, aggregated across calls.
 * Schema fixed in Phase 0 of `docs/adapter-integration.md`; new fields
 * append, never replace, so older readers stay compatible. Distinct from
 * the per-call `AdapterCostRecord` in
 * `src/falsification/adapters/types.ts`: that one is what an adapter
 * returns from a single `falsify()` call, this one is what gets written
 * to `cost-attribution.json` after every call has been aggregated.
 */
export interface AdapterCostAggregate {
  /** Stable, kebab-case adapter identifier matching the registry key. */
  adapterName: string;
  /** Obligation type the rows below were collected against. */
  obligationType: string;
  /** Number of `falsify()` calls aggregated into this record. */
  calls: number;
  /**
   * Sum of per-call `dollarsSpent`. Equals `dollarsTokenEstimate` and is
   * preserved for backward compatibility with consumers that pre-date the
   * auth-method split.
   */
  dollarsSpent: number;
  /**
   * Sum of per-call `dollarsBilled`. Real charges to the operator's
   * account; zero across calls made under flat-rate subscription auth.
   */
  dollarsBilled: number;
  /**
   * Sum of per-call `dollarsTokenEstimate`. Upper-bound cost from token
   * counts × rate card; populated regardless of auth tier.
   */
  dollarsTokenEstimate: number;
  /** Wall-clock milliseconds across `calls`. */
  wallClockMs: number;
  /** Confirmed counter-examples produced across `calls`. */
  counterExamplesFound: number;
  /** Adapter-claimed candidates that did not actually falsify. */
  falsePositives: number;
}

/**
 * Aggregate cost attribution for an entire swarm run.
 * Saved alongside RunMetrics in metrics.json.
 */
export interface CostAttribution {
  totalEstimatedPremiumRequests: number;
  totalActualPremiumRequests: number;
  estimateAccuracy: number;
  modelUsed: string;
  modelMultiplier: number;
  overageTriggered: boolean;
  perStep: StepCostRecord[];
  /**
   * Per-adapter dollar totals and yield, keyed by adapter name. Optional so
   * runs that did not enable any falsifier (or used `--falsifiers off`)
   * omit the field entirely instead of writing an empty object that readers
   * have to special-case. Added in Phase 0 of the adapter-reintegration
   * work.
   */
  adapters?: AdapterCostAggregate[];
  /**
   * Sum of `adapters[].dollarsSpent`, materialized so the run report can
   * surface the cross-adapter total without iterating. Optional for the
   * same reason as `adapters`.
   */
  adapterDollarsTotal?: number;
}

/**
 * Structured evidence for cost_history knowledge base entries.
 * Replaces the previous string-encoded format to eliminate fragile parsing.
 */
export interface CostHistoryEvidence {
  runId: string;
  estimated: number;
  actual: number;
  retries: number;
  steps: number;
  model: string;
  /** Quality gate remediation steps triggered during this run. Added in v4.2. */
  remediationSteps?: number;
}
