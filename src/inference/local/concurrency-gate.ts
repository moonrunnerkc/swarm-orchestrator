// A LocalBackend wrapper that bounds the number of concurrent
// `chat` / `stream` calls. Necessary because the underlying
// HTTP daemon (Ollama in particular) serializes inference for
// a single loaded model: queueing N parallel requests means
// the late ones spend most of their per-request timeout
// budget WAITING in the daemon's queue, then abort during
// inference. Limiting client-side concurrency to 1 (the
// documented `--local-max-concurrency` default) lets each call
// start its timeout when it actually begins talking to the
// model.

import type {
  BackendRequest,
  BackendResponse,
  BackendStreamObserver,
  BackendStreamResult,
  LocalBackend,
  SupportedGrammar,
} from './backend';

export class ConcurrencyLimitedBackend implements LocalBackend {
  readonly name: string;
  private readonly inner: LocalBackend;
  private readonly limit: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(inner: LocalBackend, limit: number) {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error(`ConcurrencyLimitedBackend: limit must be >= 1, got ${limit}`);
    }
    this.inner = inner;
    this.limit = limit;
    this.name = inner.name;
  }

  supportsGrammar(): readonly SupportedGrammar[] {
    return this.inner.supportsGrammar();
  }

  async chat(request: BackendRequest): Promise<BackendResponse> {
    await this.acquire();
    try {
      return await this.inner.chat(request);
    } finally {
      this.release();
    }
  }

  async stream(
    request: BackendRequest,
    observer: BackendStreamObserver,
  ): Promise<BackendStreamResult> {
    await this.acquire();
    try {
      return await this.inner.stream(request, observer);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}
