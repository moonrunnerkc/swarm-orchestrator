/**
 * Public surface of the v8 persona layer. Phase 2 ships:
 *   - `PersonaSpec` and `PersonaSampling` types.
 *   - `PersonaRegistry` and the three default personas (architect, implementer, verifier).
 *   - The Phase 2 trigger-predicate evaluator.
 */

export type { ModelTier, PersonaSampling, PersonaSpec } from './types';

export {
  ARCHITECT_PERSONA,
  DEFAULT_PERSONA_IDS,
  IMPLEMENTER_PERSONA,
  PersonaRegistry,
  VERIFIER_PERSONA,
  createDefaultRegistry,
} from './persona-registry';

export {
  personaTrigger,
  selectPersonaForState,
  unsatisfiedObligationOfType,
  type ObligationStatus,
  type PersonaSelection,
  type PopulationState,
  type TriggerPredicate,
} from './predicates';
