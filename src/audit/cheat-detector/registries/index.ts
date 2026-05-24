// Factory for the default registry probe stack: offline allowlist
// wrapped in the caching layer. Online-network probes are exposed via
// the same `RegistryProbe` interface; the consumer wires them in
// explicitly when network access is desired.
//
// The shared singleton (`defaultRegistryProbe`) makes 200 PR audits
// in one process share one cache, which is the v10.2-advisory plan's
// "2000 registry calls → 200" property.

import { CachingRegistryProbe } from './cache';
import { OfflineAllowlistProbe } from './offline-allowlist';
import type { RegistryProbe } from './types';

export type { ProbeQuery, ProbeResult, ProbeVerdict, RegistryName, RegistryProbe } from './types';
export { CachingRegistryProbe } from './cache';
export { OfflineAllowlistProbe } from './offline-allowlist';
export { extractUsesRefs } from './github-actions-scan';
export type { UsesRef } from './github-actions-scan';

let defaultProbe: RegistryProbe | undefined;

export function defaultRegistryProbe(): RegistryProbe {
  if (defaultProbe === undefined) {
    defaultProbe = new CachingRegistryProbe(new OfflineAllowlistProbe());
  }
  return defaultProbe;
}

/** Test-only: drop the default cache so tests do not bleed into each other. */
export function __resetDefaultRegistryProbe(): void {
  defaultProbe = undefined;
}
