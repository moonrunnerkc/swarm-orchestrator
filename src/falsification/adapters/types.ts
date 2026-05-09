/**
 * Falsifier-adapter contract.
 *
 * An adapter is a *falsifier*, not an alternative producer. It takes a patch
 * SHA, an obligation, and a writable workspace, and tries to falsify the
 * obligation by surfacing a counter-example, a regression fixture, or a
 * property-violation trace. If it cannot falsify within the supplied time
 * budget it returns the `no-falsification-found` variant rather than
 * pretending success.
 *
 * Source of the four-variant contract: `docs/adapter-integration.md` Phase 0.
 * Lock the shape of `FalsificationResult` before any adapter implementation
 * lands so the registry and downstream consumers stay schema-stable.
 */

import type { ObligationV1, ObligationType } from '../../contract/types';

/**
 * Inputs every adapter receives, identical regardless of which obligation
 * type it claims to handle. The adapter is responsible for short-circuiting
 * on obligation types it does not support; the dispatcher passes them
 * through unchanged.
 */
export interface FalsificationInput {
  /** Git SHA of the patch under test. The adapter must not mutate this commit. */
  readonly patchSha: string;
  /** The obligation to falsify. */
  readonly obligation: ObligationV1;
  /**
   * Pointers to evidence the adapter may use as additional context (paths to
   * battery findings, prior verifier outputs, etc.). Strings rather than a
   * structured type so adapters do not couple to internal v8 representations.
   */
  readonly contextRefs: readonly string[];
  /** Wall-clock budget. Adapter must return before this elapses. */
  readonly timeBudgetMs: number;
  /**
   * Absolute path to a writable workspace already checked out at `patchSha`.
   * The adapter is free to write inside this directory; the dispatcher
   * isolates and discards it after the call returns.
   */
  readonly workspaceRoot: string;
}

/**
 * One concrete input that, when applied to the workspace, makes the
 * obligation fail. The reproducer command is what the dispatcher (or a
 * human) re-runs to confirm the failure.
 */
export interface CounterExampleInput {
  /**
   * Files the adapter added or modified inside the workspace to construct
   * this counter-example. Paths are relative to the workspace root.
   * Contents are inlined so the dispatcher can persist them verbatim and
   * a reviewer can reproduce without re-running the adapter.
   */
  readonly files: ReadonlyArray<{ readonly relPath: string; readonly bytes: string }>;
  /** Shell command that reproduces the failure when run from `workspaceRoot`. */
  readonly reproducer: string;
  /** Captured combined stdout+stderr from running `reproducer`. */
  readonly reproducerOutput: string;
  /** Exit code observed for `reproducer`. Non-zero is the failing signal. */
  readonly reproducerExitCode: number;
}

/**
 * Variant: the adapter found one or more concrete inputs that falsify the
 * obligation. Each entry has been independently re-run by the adapter and
 * confirmed to fail; entries that did not actually fail are not included
 * here (they are accounted for under `AdapterCostRecord.falsePositives`).
 */
export interface CounterExampleResult {
  readonly kind: 'counter-example-input';
  readonly obligationType: ObligationType;
  readonly inputs: readonly CounterExampleInput[];
}

/**
 * Variant: the adapter promoted its findings to a regression fixture
 * (a file the test suite picks up directly) rather than an ad-hoc input.
 * Phase 1 does not produce these; reserved for future strategies that
 * write into the project's regression suite.
 */
export interface RegressionFixtureResult {
  readonly kind: 'regression-fixture';
  readonly obligationType: ObligationType;
  /** Absolute path of the fixture written. */
  readonly fixturePath: string;
  /** Free-form notes for reviewers. */
  readonly notes: string;
}

/**
 * Variant: the adapter observed a property violation but cannot reduce it
 * to a single reproducer. The trace is the ordered list of steps the
 * adapter took that produced the violation. Phase 1 does not produce this
 * variant; reserved for stateful or model-checking strategies.
 */
export interface PropertyViolationTraceResult {
  readonly kind: 'property-violation-trace';
  readonly obligationType: ObligationType;
  readonly steps: readonly string[];
  /** Best-effort reproducer command, may be empty for non-deterministic traces. */
  readonly reproducer: string;
}

/** Reason the adapter returned no falsification. */
export type NoFalsificationReason =
  | 'time-budget-exhausted'
  | 'no-counter-example-discovered'
  | 'strategy-not-applicable'
  | 'baseline-predicate-failed';

/**
 * Auth method the adapter used for the underlying CLI/API call. Drives the
 * `dollarsBilled` vs `dollarsTokenEstimate` split: subscription-style auth
 * (ChatGPT) charges flat-rate so `dollarsBilled` is 0 even when the token
 * estimate is positive; API-key auth charges per-token so the two values
 * coincide.
 */
export type AdapterAuthMethod = 'chatgpt' | 'api' | 'unknown';

/**
 * Variant: the adapter ran but did not find a falsification. This is a
 * first-class outcome, not an error. Phase 1's dev gate explicitly counts
 * the rate of this variant.
 */
export interface NoFalsificationFoundResult {
  readonly kind: 'no-falsification-found';
  readonly obligationType: ObligationType;
  readonly reason: NoFalsificationReason;
  /** Number of distinct attempts the adapter made before giving up. */
  readonly attempts: number;
  /** Free-form detail; populated when `reason` is `strategy-not-applicable`. */
  readonly detail?: string;
}

/** Discriminated union of every adapter outcome. */
export type FalsificationResult =
  | CounterExampleResult
  | RegressionFixtureResult
  | PropertyViolationTraceResult
  | NoFalsificationFoundResult;

/**
 * Per-call cost and yield record. Aggregated into `cost-attribution.json`
 * by the dispatcher; the adapter populates one of these for every
 * `falsify()` invocation, regardless of outcome.
 */
export interface AdapterCostRecord {
  readonly adapterName: string;
  readonly obligationType: ObligationType;
  /** Wall-clock from before-spawn to after-result-parse, milliseconds. */
  readonly wallClockMs: number;
  /**
   * Real dollars spent on this call (subprocess provider charges, API
   * usage, etc.). Adapters that cannot measure cost report 0 and document
   * the gap in their adapter-specific docs.
   *
   * Equal to `dollarsTokenEstimate` and preserved for backward
   * compatibility with consumers that pre-date the auth-method split.
   * New code should read `dollarsBilled` (real charge) or
   * `dollarsTokenEstimate` (computed upper bound) directly.
   */
  readonly dollarsSpent: number;
  /**
   * Auth method the underlying CLI/API used for this call. Flat-rate
   * subscriptions (`chatgpt`) report `dollarsBilled === 0` even when the
   * token-estimate is positive; per-token auth (`api`) reports them equal.
   */
  readonly authMethod: AdapterAuthMethod;
  /**
   * Real dollars charged to the operator's account for this call. Zero
   * under flat-rate subscriptions. Phase 2's cost comparison uses this
   * value when computing the price-per-confirmed-yield headline metric so
   * the result is not inflated by token estimates against subscription
   * tiers.
   */
  readonly dollarsBilled: number;
  /**
   * Upper-bound dollar value computed from token counts × rate card.
   * Always populated when token counts are available, regardless of auth
   * tier. Equals `dollarsBilled` under per-token auth; equals the would-be
   * API cost under flat-rate subscriptions.
   */
  readonly dollarsTokenEstimate: number;
  /** Count of confirmed counter-examples in the result. */
  readonly counterExamplesFound: number;
  /**
   * Candidates the adapter generated that turned out *not* to falsify on
   * adapter-side re-run. Phase 1 sets this to (requestedCandidates -
   * counterExamplesFound). The Phase 1 dev gate hand-inspects these.
   */
  readonly falsePositives: number;
}

/**
 * Single-call falsifier interface. Adapters are sequential in Phase 1; the
 * dispatcher invokes one at a time. No batching, no scheduling, no bandit.
 *
 * `handles` is advisory: the registry uses it to filter which adapters
 * the dispatcher offers an obligation to. An adapter may still receive
 * an obligation outside its `handles` list (for example, a future
 * dispatcher running every adapter on every obligation as a control); in
 * that case the adapter must return `no-falsification-found` with reason
 * `strategy-not-applicable` rather than throwing.
 */
export interface FalsifierAdapter {
  /** Stable, kebab-case identifier. Used as the registry key. */
  readonly name: string;
  /** Obligation types this adapter's strategy claims to handle. */
  readonly handles: readonly ObligationType[];
  /**
   * Run the falsification strategy. Must respect `input.timeBudgetMs`.
   * Errors from the underlying tool (missing CLI, auth failure, parse
   * failure) are real errors and must be thrown — the dispatcher
   * surfaces them, it does not silently treat them as
   * `no-falsification-found`.
   */
  falsify(input: FalsificationInput): Promise<FalsifyOutcome>;
}

/** Pair returned by every adapter call. */
export interface FalsifyOutcome {
  readonly result: FalsificationResult;
  readonly cost: AdapterCostRecord;
}
