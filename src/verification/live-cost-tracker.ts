/**
 * Live cost tracker for mid-stream cost-cap enforcement.
 *
 * The Phase 6 streaming verifier already exposes a `SessionStreamObserver`
 * that may abort an in-flight generation when an assertion fires. The
 * cost tracker plugs into the same observer surface and aborts when the
 * projected cumulative spend, including the still-flowing partial
 * output, would exceed an operator-supplied USD cap.
 *
 * Centralization rationale: every adapter that streams routes through
 * `Session.stream()`. The tracker therefore lives in one place, consumes
 * the same chunk events the verifier already gets, and never needs an
 * adapter-specific accounting branch. Adapters that DO NOT stream
 * (Codex/Copilot/Claude Code subprocess falsifiers) cooperate via a
 * lightweight cancellation token (`isCancelled()`), checked between
 * adapter calls in the dispatcher.
 *
 * Determinism: the tracker's decision to abort depends only on
 *   (a) the running token estimate from the chars observed so far, and
 *   (b) the immutable per-token price schedule supplied at construction.
 * Replay drives the same token sequence and the same prices, so abort
 * decisions reproduce.
 *
 * Pricing: defaults match the Sonnet 4 schedule used by the post-run
 * `--cost-cap` gate in `cli/v8/run-handler.ts`. Callers may override
 * for other adapters without changing the tracker shape.
 */

import {
  addUsage,
  emptyUsage,
  type SessionStreamObserver,
  type SessionUsage,
} from '../session/types';
import { estimateTokens } from '../session/token-estimator';

/** Per-token USD prices the tracker uses to convert tokens to dollars. */
export interface PricePerToken {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

/** Sonnet 4 schedule. Mirrors `cli/v8/run-handler.ts` constants. */
export const SONNET4_PRICE_PER_TOKEN: PricePerToken = {
  input: 3 / 1_000_000,
  cacheRead: 0.3 / 1_000_000,
  cacheCreation: 3.75 / 1_000_000,
  output: 15 / 1_000_000,
};

/** What the tracker reports about a single abort decision. */
export interface CostAbortInfo {
  /** Cap that was exceeded, in USD. */
  capUsd: number;
  /** Spend the tracker projected at the moment of abort. */
  projectedUsd: number;
  /** Cumulative spend already committed before this stream started. */
  baselineUsd: number;
  /** Approximate output tokens observed in the still-flowing stream. */
  inFlightOutputTokens: number;
  /** ISO-8601 timestamp of the abort. */
  ts: string;
}

/**
 * Shared, mutable cost tracker. One instance per run. Observers built
 * by `observerForStream()` route into the same accounting state, so
 * concurrent tournament candidates each contribute their in-flight
 * output to a single ceiling.
 */
export class LiveCostTracker {
  private readonly capUsd: number | null;
  private readonly price: PricePerToken;
  /**
   * Spend already committed by completed (or aborted) calls. Updated by
   * `commitUsage()` whenever a stream settles.
   */
  private committed: SessionUsage = emptyUsage();
  /**
   * Per-stream in-flight output token estimate. Keys are unique per
   * `observerForStream()` invocation; values are the running token
   * count derived from `partialText`.
   */
  private readonly inFlight: Map<number, number> = new Map();
  private nextStreamId = 0;
  private lastAbort: CostAbortInfo | null = null;

  constructor(opts: { capUsd: number | null; price?: PricePerToken; baseline?: SessionUsage }) {
    this.capUsd = opts.capUsd;
    this.price = opts.price ?? SONNET4_PRICE_PER_TOKEN;
    if (opts.baseline) this.committed = { ...opts.baseline };
  }

  /** True if a finite cap was configured. */
  hasCap(): boolean {
    return this.capUsd !== null;
  }

  /** Configured cap in USD, or null. */
  cap(): number | null {
    return this.capUsd;
  }

  /** Spend committed so far, in USD. */
  spentUsd(): number {
    return usageToUsd(this.committed, this.price);
  }

  /**
   * Spend projected including every in-flight stream's output-token
   * estimate at this moment.
   */
  projectedUsd(): number {
    let proj = this.spentUsd();
    for (const tokens of this.inFlight.values()) {
      proj += tokens * this.price.output;
    }
    return proj;
  }

  /** Whether the projected spend is at or above the cap. */
  isOverCap(): boolean {
    if (this.capUsd === null) return false;
    return this.projectedUsd() >= this.capUsd;
  }

  /**
   * Cooperative cancellation signal for non-streaming adapters
   * (Codex/Copilot/Claude Code falsifier subprocesses). They check
   * between calls and short-circuit when this flips true.
   */
  isCancelled(): boolean {
    return this.isOverCap();
  }

  /** Last abort info, or null when the tracker has never aborted. */
  lastAbortInfo(): CostAbortInfo | null {
    return this.lastAbort ? { ...this.lastAbort } : null;
  }

  /** Commit a settled call's usage to the running total. */
  commitUsage(usage: SessionUsage): void {
    this.committed = addUsage(this.committed, usage);
  }

  /**
   * Build a `SessionStreamObserver` paired with a `finalize` callback
   * that delegates to `inner` when the cost cap is intact and aborts
   * (overriding `inner`'s decision) the moment the projected spend would
   * cross the cap. The returned object carries a closed-over stream id
   * so multiple concurrent calls each track their own in-flight output
   * without stomping on each other.
   *
   * Callers MUST invoke `finalize(usage)` exactly once per stream after
   * settle; that drops the in-flight slot and commits actual billed
   * usage to the running total.
   */
  observerForStream(inner?: SessionStreamObserver): {
    observer: SessionStreamObserver;
    finalize: (usage: SessionUsage | null) => void;
  } {
    const id = this.nextStreamId++;
    this.inFlight.set(id, 0);
    const observer: SessionStreamObserver = (event) => {
      const tokens = estimateTokens(event.partialText);
      this.inFlight.set(id, tokens);
      if (this.capUsd !== null) {
        const projected = this.projectedUsd();
        if (projected >= this.capUsd) {
          this.lastAbort = {
            capUsd: this.capUsd,
            projectedUsd: projected,
            baselineUsd: this.spentUsd(),
            inFlightOutputTokens: tokens,
            ts: new Date().toISOString(),
          };
          return { kind: 'abort', reason: COST_CAP_ABORT_REASON };
        }
      }
      return inner ? inner(event) : { kind: 'continue' as const };
    };
    const finalize = (usage: SessionUsage | null): void => {
      this.inFlight.delete(id);
      if (usage) this.commitUsage(usage);
    };
    return { observer, finalize };
  }

  /** Snapshot for ledger writers and tests. */
  snapshot(): { committedUsd: number; projectedUsd: number; capUsd: number | null } {
    return {
      committedUsd: this.spentUsd(),
      projectedUsd: this.projectedUsd(),
      capUsd: this.capUsd,
    };
  }
}

/** Reason string used for cost-cap aborts. Stable for replay/audit. */
export const COST_CAP_ABORT_REASON = 'cost-cap exceeded';

/** Convert a `SessionUsage` to USD using `price`. */
export function usageToUsd(usage: SessionUsage, price: PricePerToken): number {
  return (
    usage.inputTokens * price.input +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheCreationTokens * price.cacheCreation +
    usage.outputTokens * price.output
  );
}
