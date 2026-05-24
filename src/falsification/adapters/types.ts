// Adapters are *falsifiers*, not alternative producers. If they cannot
// falsify within the time budget they return `no-falsification-found`
// rather than pretending success.

import type { ObligationV1, ObligationType } from '../../contract/types';

export interface FalsificationInput {
  readonly patchSha: string;
  readonly obligation: ObligationV1;
  // String paths rather than a structured type so adapters don't couple
  // to internal v8 representations.
  readonly contextRefs: readonly string[];
  readonly timeBudgetMs: number;
  // Already checked out at `patchSha`. The dispatcher isolates and
  // discards the workspace after the call returns.
  readonly workspaceRoot: string;
}

// Contents are inlined so a reviewer can reproduce without re-running
// the adapter.
export interface CounterExampleInput {
  readonly files: ReadonlyArray<{ readonly relPath: string; readonly bytes: string }>;
  readonly reproducer: string;
  readonly reproducerOutput: string;
  readonly reproducerExitCode: number;
}

export interface CounterExampleResult {
  readonly kind: 'counter-example-input';
  readonly obligationType: ObligationType;
  readonly inputs: readonly CounterExampleInput[];
}

// Reserved for future strategies that write into the project's
// regression suite.
export interface RegressionFixtureResult {
  readonly kind: 'regression-fixture';
  readonly obligationType: ObligationType;
  readonly fixturePath: string;
  readonly notes: string;
}

// Reserved for stateful or model-checking strategies.
export interface PropertyViolationTraceResult {
  readonly kind: 'property-violation-trace';
  readonly obligationType: ObligationType;
  readonly steps: readonly string[];
  readonly reproducer: string;
}

export type NoFalsificationReason =
  | 'time-budget-exhausted'
  | 'no-counter-example-discovered'
  | 'strategy-not-applicable'
  | 'baseline-predicate-failed';

// Flat-rate subscriptions (`chatgpt`) report dollarsBilled === 0 even
// when the token estimate is positive; per-token auth (`api`) reports
// them equal.
export type AdapterAuthMethod = 'chatgpt' | 'api' | 'unknown';

export interface NoFalsificationFoundResult {
  readonly kind: 'no-falsification-found';
  readonly obligationType: ObligationType;
  readonly reason: NoFalsificationReason;
  readonly attempts: number;
  readonly detail?: string;
}

export type FalsificationResult =
  | CounterExampleResult
  | RegressionFixtureResult
  | PropertyViolationTraceResult
  | NoFalsificationFoundResult;

export interface AdapterCostRecord {
  readonly adapterName: string;
  readonly obligationType: ObligationType;
  readonly wallClockMs: number;
  // Back-compat alias: equals dollarsTokenEstimate. New code should
  // read dollarsBilled or dollarsTokenEstimate directly.
  readonly dollarsSpent: number;
  readonly authMethod: AdapterAuthMethod;
  // Real charge to the operator's account; zero under flat-rate.
  readonly dollarsBilled: number;
  // Upper-bound from token counts × rate card. For Copilot this is
  // subscription-imputed at $0.026/Premium-request; for cross-adapter
  // like-for-like, read dollarsApiEquivalent.
  readonly dollarsTokenEstimate: number;
  // What the same workload would cost on the comparable per-token API
  // rate card, regardless of how it was actually billed. For Copilot
  // this maps Premium requests to GPT-4-Turbo-equivalent token costs
  // (see copilot-cost.ts); for Codex and ClaudeCode equals
  // dollarsTokenEstimate.
  readonly dollarsApiEquivalent: number;
  readonly counterExamplesFound: number;
  // requestedCandidates - counterExamplesFound.
  readonly falsePositives: number;
}

// Adapters are sequential: no batching, no scheduling.
// `handles` is advisory; an adapter receiving an out-of-list obligation
// must return `strategy-not-applicable`, not throw.
export interface FalsifierAdapter {
  readonly name: string;
  readonly handles: readonly ObligationType[];
  // Errors from the underlying tool (missing CLI, auth failure, parse
  // failure) must be thrown — the dispatcher surfaces them, it does
  // not silently treat them as `no-falsification-found`.
  falsify(input: FalsificationInput): Promise<FalsifyOutcome>;
}

export interface FalsifyOutcome {
  readonly result: FalsificationResult;
  readonly cost: AdapterCostRecord;
}
