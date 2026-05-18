import {
  addUsage,
  emptyUsage,
  type SessionStreamObserver,
  type SessionUsage,
} from '../session/types';
import { estimateTokens } from '../session/token-estimator';

export interface BudgetAbortInfo {
  budgetTokens: number;
  projectedTokens: number;
  committedTokens: number;
  inFlightTokens: number;
  ts: string;
}

interface BudgetSnapshot {
  committedTokens: number;
  projectedTokens: number;
  budgetTokens: number | null;
}

export const COST_CAP_ABORT_REASON = 'cost-cap exceeded';

// One instance per run. Observers built by `observerForStream()` route
// into the same accounting state so concurrent tournament candidates
// each contribute their in-flight output to a single ceiling. The
// ceiling is denominated in output tokens — every provider's session
// contract reports tokens uniformly, so the gate is provider-agnostic.
export class LiveCostTracker {
  private readonly budgetTokens: number | null;
  private committed: SessionUsage = emptyUsage();
  private readonly inFlight: Map<number, number> = new Map();
  private nextStreamId = 0;
  private lastAbort: BudgetAbortInfo | null = null;

  constructor(opts: { budgetTokens: number | null; baseline?: SessionUsage }) {
    this.budgetTokens = opts.budgetTokens;
    if (opts.baseline) this.committed = { ...opts.baseline };
  }

  hasBudget(): boolean { return this.budgetTokens !== null; }
  budget(): number | null { return this.budgetTokens; }
  committedTokens(): number { return this.committed.outputTokens; }

  projectedTokens(): number {
    let proj = this.committed.outputTokens;
    for (const tokens of this.inFlight.values()) proj += tokens;
    return proj;
  }

  isOverBudget(): boolean {
    return this.budgetTokens !== null && this.projectedTokens() >= this.budgetTokens;
  }

  isCancelled(): boolean { return this.isOverBudget(); }

  lastAbortInfo(): BudgetAbortInfo | null {
    return this.lastAbort ? { ...this.lastAbort } : null;
  }

  commitUsage(usage: SessionUsage): void {
    this.committed = addUsage(this.committed, usage);
  }

  observerForStream(inner?: SessionStreamObserver): {
    observer: SessionStreamObserver;
    finalize: (usage: SessionUsage | null) => void;
  } {
    const id = this.nextStreamId++;
    this.inFlight.set(id, 0);
    const observer: SessionStreamObserver = (event) => {
      const tokens = estimateTokens(event.partialText);
      this.inFlight.set(id, tokens);
      if (this.budgetTokens !== null) {
        const projected = this.projectedTokens();
        if (projected >= this.budgetTokens) {
          this.lastAbort = {
            budgetTokens: this.budgetTokens,
            projectedTokens: projected,
            committedTokens: this.committed.outputTokens,
            inFlightTokens: tokens,
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

  snapshot(): BudgetSnapshot {
    return {
      committedTokens: this.committed.outputTokens,
      projectedTokens: this.projectedTokens(),
      budgetTokens: this.budgetTokens,
    };
  }
}
