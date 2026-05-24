// Thin in-memory cache around a RegistryProbe. The cache is keyed by
// `(registry, name, version)` so two PRs that mock the same package
// only generate one underlying lookup. The cache is process-local
// and never persisted to disk: shadow-mode audits, scoring runs, and
// CI invocations each get a fresh cache.

import type { ProbeQuery, ProbeResult, RegistryProbe } from './types';

export class CachingRegistryProbe implements RegistryProbe {
  private readonly cache = new Map<string, ProbeResult>();

  constructor(private readonly inner: RegistryProbe) {}

  query(q: ProbeQuery): Promise<ProbeResult> | ProbeResult {
    const key = cacheKey(q);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const raw = this.inner.query(q);
    if (raw instanceof Promise) {
      return raw.then((result) => {
        this.cache.set(key, result);
        return result;
      });
    }
    this.cache.set(key, raw);
    return raw;
  }

  snapshotDate(): string {
    return this.inner.snapshotDate();
  }

  /** Test-only inspection of the cache size. */
  size(): number {
    return this.cache.size;
  }
}

function cacheKey(q: ProbeQuery): string {
  return `${q.registry}::${q.name}::${q.version ?? '*'}`;
}
