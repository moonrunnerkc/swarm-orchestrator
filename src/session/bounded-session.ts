// A Session decorator that caps the total number of LLM calls and the
// cumulative output tokens charged against an upstream session.
//
// Why: a pathological or malicious contract with hundreds of obligations
// can drive unbounded API spending against the user's API key. The
// existing `--cost-cap` flag clamps a single streaming generation, and
// the per-adapter time budgets clamp a falsifier turn, but neither caps
// the whole-run total. For a published GitHub Action that runs against
// users' own API keys, that gap is a denial-of-wallet surface.
//
// `BoundedSession` wraps any Session, decrements a shared counter on
// every `complete()` / `stream()` call, and throws `BudgetExceededError`
// once the call ceiling or the cumulative-output-token ceiling is
// crossed. Throws fail the run with exit code 1, surfacing the cap on
// stderr; the caller does not have to special-case it.

import type {
  Session,
  SessionRequest,
  SessionResponse,
  SessionStreamObserver,
  SessionStreamResult,
  SessionUsage,
  ProviderInfo,
} from './types';
import { emptyUsage } from './types';

/** Thrown when a BoundedSession exhausts its call or token budget. The
 *  error message names the limit so an operator can raise it. */
export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly kind: 'calls' | 'output-tokens',
    public readonly limit: number,
  ) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface SessionBudget {
  /** Cumulative `complete()` + `stream()` calls allowed across the run.
   *  Null disables the call-count gate. */
  maxCalls: number | null;
  /** Cumulative output tokens allowed across the run. Null disables the
   *  token gate. Output tokens are counted because they are the major
   *  billing axis and the simplest to measure post-call. */
  maxOutputTokens: number | null;
}

/** Decorate a Session with run-wide call-count and output-token caps. A
 *  null on either limit disables that gate; an all-null budget collapses
 *  to a transparent passthrough so callers can wrap unconditionally. */
export class BoundedSession implements Session {
  private callsSoFar = 0;
  private outputSoFar = 0;

  constructor(
    private readonly inner: Session,
    private readonly budget: SessionBudget,
  ) {}

  async complete(request: SessionRequest): Promise<SessionResponse> {
    this.assertCallBudget();
    const response = await this.inner.complete(request);
    this.recordUsage(response.usage);
    return response;
  }

  async stream(
    request: SessionRequest,
    observer: SessionStreamObserver,
  ): Promise<SessionStreamResult> {
    this.assertCallBudget();
    const result = await this.inner.stream(request, observer);
    this.recordUsage(result.response.usage);
    return result;
  }

  totalUsage(): SessionUsage {
    return this.inner.totalUsage();
  }

  providerInfo(): ProviderInfo {
    return this.inner.providerInfo();
  }

  projectContext(): string {
    return this.inner.projectContext();
  }

  /** Visible for tests and for the run-handler's end-of-run summary. */
  remainingCalls(): number | null {
    if (this.budget.maxCalls === null) return null;
    return Math.max(0, this.budget.maxCalls - this.callsSoFar);
  }

  /** Visible for tests and for the run-handler's end-of-run summary. */
  remainingOutputTokens(): number | null {
    if (this.budget.maxOutputTokens === null) return null;
    return Math.max(0, this.budget.maxOutputTokens - this.outputSoFar);
  }

  private assertCallBudget(): void {
    if (this.budget.maxCalls !== null && this.callsSoFar >= this.budget.maxCalls) {
      throw new BudgetExceededError(
        `LLM call budget exhausted (--max-llm-calls=${this.budget.maxCalls}); ` +
          'raise the cap or shrink the contract',
        'calls',
        this.budget.maxCalls,
      );
    }
    if (
      this.budget.maxOutputTokens !== null &&
      this.outputSoFar >= this.budget.maxOutputTokens
    ) {
      throw new BudgetExceededError(
        `LLM output-token budget exhausted (--max-llm-tokens=${this.budget.maxOutputTokens}); ` +
          'raise the cap or shrink the contract',
        'output-tokens',
        this.budget.maxOutputTokens,
      );
    }
    this.callsSoFar += 1;
  }

  private recordUsage(usage: SessionUsage = emptyUsage()): void {
    this.outputSoFar += usage.outputTokens;
  }
}
