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
  DEPENDENCY_AUDITOR_PERSONA,
  DOCUMENTATION_WRITER_PERSONA,
  IMPLEMENTER_PERSONA,
  MIGRATION_SPECIALIST_PERSONA,
  PersonaRegistry,
  SECURITY_REVIEWER_PERSONA,
  TEST_AUTHOR_PERSONA,
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

export {
  TOURNAMENT_VERIFIER_PERSONA,
  clampScore,
  parseVerifierScore,
  renderVerifierPrompt,
  scoreCandidate,
  type ScoredCandidate,
  type VerifierScore,
} from './verifier-persona';
