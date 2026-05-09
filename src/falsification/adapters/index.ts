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
 * Phase 1 registered `CodexFalsifier` (property-must-hold strategy).
 * Phase 3 (close-out 2026-05-09 — P3.5.a) added `CopilotFalsifier`
 * (import-graph-must-satisfy and function-must-have-signature
 * strategies) as a default-on adapter; Copilot's marginal yield/$ on
 * the Phase 3 N=20 obligation set was 38.46, well above the Codex
 * Phase 2 baseline of 5.91, so the ablation arm earned its slot.
 *
 * Callers that need to disable Copilot (e.g. an environment without a
 * `copilot` binary) pass `includeCopilot: false`.
 */
export interface DefaultRegistryOptions {
  /**
   * Register the Copilot falsifier alongside Codex. Default true after
   * the Phase 3 close-out shipped B' (DECISIONS.md 2026-05-09). The
   * flag exists so an environment without a copilot binary, or a test
   * that wants Codex-only behaviour, can opt out.
   */
  readonly includeCopilot?: boolean;
}

export function defaultAdapterRegistry(options: DefaultRegistryOptions = {}): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new CodexFalsifier());
  const includeCopilot = options.includeCopilot ?? true;
  if (includeCopilot) {
    registry.register(new CopilotFalsifier());
  }
  return registry;
}
