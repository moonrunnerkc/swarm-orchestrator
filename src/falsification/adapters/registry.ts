/**
 * In-process registry for falsifier adapters.
 *
 * Single-process, single-instance, no DI framework. Names are kebab-case and
 * unique. The registry does not own adapter lifecycle (no init/shutdown
 * hooks); adapters are plain objects that conform to `FalsifierAdapter`.
 *
 * Dispatcher contract: ask the registry for adapters by obligation type, get
 * the (possibly empty) list back, dispatch sequentially. The registry is the
 * only seam between "an adapter exists in code" and "an adapter is reachable
 * by the orchestrator", which keeps the wiring to inspect during a Phase 0
 * review under the 30-minute budget.
 */

import type { FalsifierAdapter } from './types';
import type { ObligationType } from '../../contract/types';

/**
 * In-process map from adapter name to adapter instance.
 *
 * Implemented as a class rather than module-level state so tests can
 * instantiate fresh registries without leaking adapter registrations
 * between test cases. Production code creates exactly one instance.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, FalsifierAdapter>();

  /**
   * Register `adapter` under `adapter.name`. Throws if an adapter with the
   * same name is already registered — silent overwrite hides bugs.
   */
  register(adapter: FalsifierAdapter): void {
    const existing = this.adapters.get(adapter.name);
    if (existing !== undefined) {
      throw new Error(
        `adapter "${adapter.name}" is already registered; ` +
          'unregister it first or pick a different name',
      );
    }
    this.adapters.set(adapter.name, adapter);
  }

  /**
   * Remove an adapter by name. Returns `true` if an adapter was removed,
   * `false` if no adapter with that name existed.
   */
  unregister(name: string): boolean {
    return this.adapters.delete(name);
  }

  /** Look up an adapter by name. Returns `undefined` if not registered. */
  get(name: string): FalsifierAdapter | undefined {
    return this.adapters.get(name);
  }

  /** Whether any adapter is registered under `name`. */
  has(name: string): boolean {
    return this.adapters.has(name);
  }

  /**
   * Names of every registered adapter, in registration order.
   *
   * Order matters: Phase 1's sequential dispatch runs adapters in the
   * order they were registered, so the order is part of the contract a
   * dispatcher relies on.
   */
  names(): readonly string[] {
    return Array.from(this.adapters.keys());
  }

  /** Every registered adapter, in registration order. */
  all(): readonly FalsifierAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Adapters whose `handles` includes `obligationType`, in registration
   * order. An adapter that handles every type appears once per call;
   * an adapter that handles no matching type is omitted entirely.
   */
  forObligation(obligationType: ObligationType): readonly FalsifierAdapter[] {
    const matched: FalsifierAdapter[] = [];
    for (const adapter of this.adapters.values()) {
      if (adapter.handles.includes(obligationType)) {
        matched.push(adapter);
      }
    }
    return matched;
  }

  /** Drop every registered adapter. Test-only convenience. */
  clear(): void {
    this.adapters.clear();
  }

  /** Number of registered adapters. */
  size(): number {
    return this.adapters.size;
  }
}
