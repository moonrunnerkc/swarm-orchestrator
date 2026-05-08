/**
 * Default strategy registry for the v8 Phase 5 deterministic floor.
 * Returns a fresh `WasmRuntime` populated with the three first-party
 * strategies the §8 spec calls out: a formatter wrapper, an import
 * sorter, and a scaffolding template engine.
 */

import { WasmRuntime } from './wasm-runtime';
import { formatPrettierStrategy } from './strategies/format-prettier';
import { importSortStrategy } from './strategies/import-sort';
import { scaffoldTemplateStrategy } from './strategies/scaffold-template';
import type { DeterministicStrategy } from './types';

/** Names of the three first-party strategies, in registration order. */
export const DEFAULT_STRATEGY_NAMES = [
  'scaffold-template',
  'import-sort',
  'format-prettier',
] as const;

/** Snapshot of the three default strategies. Consumers may extend this list. */
export const DEFAULT_STRATEGIES: readonly DeterministicStrategy[] = [
  scaffoldTemplateStrategy,
  importSortStrategy,
  formatPrettierStrategy,
];

/**
 * Build a fresh runtime with the default strategies registered. Returns
 * a new instance per call so callers may register additional strategies
 * without affecting other runs.
 */
export function createDefaultRuntime(): WasmRuntime {
  return new WasmRuntime(DEFAULT_STRATEGIES);
}
