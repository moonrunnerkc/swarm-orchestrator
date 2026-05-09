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
export { CopilotFalsifier } from './copilot/copilot-falsifier';
export type { CopilotFalsifierOptions } from './copilot/copilot-falsifier';

import { AdapterRegistry } from './registry';
import { CodexFalsifier } from './codex/codex-falsifier';
import { CopilotFalsifier } from './copilot/copilot-falsifier';

/**
 * Build a registry pre-populated with the orchestrator's built-in
 * falsifier adapters.
 *
 * Phase 1 registered `CodexFalsifier` (the property-must-hold strategy).
 * Phase 3 registers `CopilotFalsifier` behind a per-adapter flag — it is
 * NOT included by default until Phase 3's empirical gate ships B'.
 * Callers that want Copilot enabled construct a registry by hand or pass
 * `includeCopilot: true`.
 */
export interface DefaultRegistryOptions {
  /**
   * Register the Copilot falsifier alongside Codex. Default false until
   * Phase 3's empirical decision flips it on (per the Phase 3 close-out
   * in DECISIONS.md). The flag exists so the Phase 3 measurement harness
   * and integration tests can opt in without code changes elsewhere.
   */
  readonly includeCopilot?: boolean;
}

export function defaultAdapterRegistry(options: DefaultRegistryOptions = {}): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new CodexFalsifier());
  if (options.includeCopilot === true) {
    registry.register(new CopilotFalsifier());
  }
  return registry;
}
