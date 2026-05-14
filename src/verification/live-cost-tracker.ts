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
  capUsd: number;
  projectedUsd: number;
  baselineUsd: number;
  inFlightOutputTokens: number;
  ts: string;
}

// One instance per run. Observers built by `observerForStream()` route
// into the same accounting state so concurrent tournament candidates
// each contribute their in-flight output to a single ceiling.
export class LiveCostTracker {
  private readonly capUsd: number | null;
  private readonly price: PricePerToken;
  private committed: SessionUsage = emptyUsage();
  private readonly inFlight: Map<number, number> = new Map();
  private nextStreamId = 0;
  private lastAbort: CostAbortInfo | null = null;

  constructor(opts: { capUsd: number | null; price?: PricePerToken; baseline?: SessionUsage }) {
    this.capUsd = opts.capUsd;
    this.price = opts.price ?? SONNET4_PRICE_PER_TOKEN;
    if (opts.baseline) this.committed = { ...opts.baseline };
  }

  hasCap(): boolean { return this.capUsd !== null; }
  cap(): number | null { return this.capUsd; }

  spentUsd(): number {
    const u = this.committed;
    const p = this.price;
    return u.inputTokens * p.input + u.cacheReadTokens * p.cacheRead + u.cacheCreationTokens * p.cacheCreation + u.outputTokens * p.output;
  }

  projectedUsd(): number {
    let proj = this.spentUsd();
    for (const tokens of this.inFlight.values()) proj += tokens * this.price.output;
    return proj;
  }

  isOverCap(): boolean {
    return this.capUsd !== null && this.projectedUsd() >= this.capUsd;
  }

  // Cooperative cancellation signal for non-streaming adapters
  // (Codex/Copilot/Claude Code falsifier subprocesses) — they check
  // between calls and short-circuit when this flips true.
  isCancelled(): boolean { return this.isOverCap(); }

  lastAbortInfo(): CostAbortInfo | null {
    return this.lastAbort ? { ...this.lastAbort } : null;
  }

  commitUsage(usage: SessionUsage): void {
    this.committed = addUsage(this.committed, usage);
  }

  // Returns a SessionStreamObserver paired with a `finalize` callback.
  // The observer delegates to `inner` when the cost cap is intact and
  // aborts (overriding `inner`'s decision) the moment the projected spend
  // would cross the cap. The closed-over stream id lets concurrent calls
  // each track their own in-flight output without stomping on each other.
  // Callers MUST invoke `finalize(usage)` exactly once per stream after
  // settle; that drops the in-flight slot and commits actual billed usage.
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

  snapshot(): { committedUsd: number; projectedUsd: number; capUsd: number | null } {
    return {
      committedUsd: this.spentUsd(),
      projectedUsd: this.projectedUsd(),
      capUsd: this.capUsd,
    };
  }
}

/** Stable for replay/audit. */
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
