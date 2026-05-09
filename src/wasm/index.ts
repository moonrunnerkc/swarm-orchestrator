/**
 * Public surface of the v8 Phase 5 WASM deterministic-floor module.
 */

export {
  DEFAULT_STRATEGY_TIMEOUT_MS,
  SandboxEscapeError,
  StrategyTimeoutError,
  WasmRuntime,
  ensureInsideRepoRoot,
} from './wasm-runtime';

export {
  DEFAULT_STRATEGIES,
  DEFAULT_STRATEGY_NAMES,
  createDefaultRuntime,
} from './registry';

export {
  scaffoldTemplateStrategy,
  registerTemplate,
  hasTemplateFor,
  canScaffold,
  listTemplateKeys,
} from './strategies/scaffold-template';

export {
  importSortStrategy,
  isImportSortable,
  sortImports,
} from './strategies/import-sort';

export { formatPrettierStrategy, formatBody } from './strategies/format-prettier';

export type {
  DeterministicStrategy,
  DispatchOutcome,
  StrategyContext,
  StrategyResult,
} from './types';
