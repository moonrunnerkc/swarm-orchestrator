/**
 * Public entry point for the falsification adapter subsystem.
 *
 * Exports the contract types, the registry, the cost aggregator, and the
 * `defaultAdapterRegistry()` factory the dispatcher uses to obtain a
 * registry pre-populated with the built-in adapters. Phase 0 lands the
 * factory with an empty population — the contract-conformance integration
 * test (`test/falsification/adapters/contract-conformance.test.ts`) fails
 * on Phase 0 because no built-in adapter is registered yet, and Phase 1
 * makes it pass by registering `CodexFalsifier`.
 */

export type {
  AdapterCostRecord,
  CounterExampleInput,
  CounterExampleResult,
  FalsificationInput,
  FalsificationResult,
  FalsifierAdapter,
  FalsifyOutcome,
  NoFalsificationFoundResult,
  NoFalsificationReason,
  PropertyViolationTraceResult,
  RegressionFixtureResult,
} from './types';

export { AdapterRegistry } from './registry';
export { aggregateAdapterCosts, totalAdapterDollars } from './cost-aggregator';

import { AdapterRegistry } from './registry';

/**
 * Build a registry pre-populated with the orchestrator's built-in
 * falsifier adapters. Phase 0 returns an empty registry; Phase 1 adds
 * `CodexFalsifier`.
 */
export function defaultAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry();
}
