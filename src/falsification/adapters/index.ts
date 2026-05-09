/**
 * Public entry point for the falsification adapter subsystem.
 *
 * Exports the contract types, the registry, the cost aggregator, and the
 * `defaultAdapterRegistry()` factory the dispatcher uses to obtain a
 * registry pre-populated with the built-in adapters. Phase 1 wires
 * `CodexFalsifier` in so the contract-conformance integration test
 * (`test/falsification/adapters/contract-conformance.test.ts`) sees a
 * registered adapter.
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
export { CodexFalsifier } from './codex/codex-falsifier';
export type { CodexFalsifierOptions } from './codex/codex-falsifier';

import { AdapterRegistry } from './registry';
import { CodexFalsifier } from './codex/codex-falsifier';

/**
 * Build a registry pre-populated with the orchestrator's built-in
 * falsifier adapters. Phase 1 registers `CodexFalsifier` with default
 * options (binary path `codex`, model `o4-mini`); callers that need to
 * inject a different binary path or model construct a `CodexFalsifier`
 * directly and register it on a fresh `AdapterRegistry`.
 */
export function defaultAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new CodexFalsifier());
  return registry;
}
