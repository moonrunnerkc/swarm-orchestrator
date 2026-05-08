/**
 * Public surface of the v8 population layer. Phase 2 ships:
 *   - The sequential population manager (one persona at a time).
 *   - File-emit applier (architect persona's only synthesis path).
 *   - Mutable state builder consumed by the manager.
 */

export {
  listPersonaIds,
  renderDynamicMessage,
  runPopulation,
  type ObligationOutcome,
  type RunPopulationOptions,
  type RunPopulationResult,
} from './manager';

export {
  applyFileEmit,
  extractFencedBody,
  writeFileObligation,
  type FileEmitResult,
} from './diff-applier';

export { PopulationStateBuilder } from './state';
