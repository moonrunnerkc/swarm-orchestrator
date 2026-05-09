import type { ObligationType, ObligationV1 } from '../contract/types';
import type { PersonaSpec } from './types';
import type { PersonaRegistry } from './persona-registry';

/**
 * Per-obligation status the Phase 2 population manager carries while it
 * walks the contract. `pending` obligations are eligible for synthesis;
 * `satisfied` and `failed` are terminal.
 */
export type ObligationStatus = 'pending' | 'in-progress' | 'satisfied' | 'failed';

/**
 * Snapshot of the population manager's view of the world. Predicates take a
 * read-only handle to this state and return either a persona match or null.
 */
export interface PopulationState {
  /** Obligations in canonical order, parallel to `status`. */
  readonly obligations: readonly ObligationV1[];
  /** Per-obligation status, parallel to `obligations`. */
  readonly status: readonly ObligationStatus[];
}

/**
 * A trigger predicate. Phase 2 supports the simple "wake when contract has
 * unsatisfied obligation of type X" shape; the function below is the
 * factory. A predicate either fires (returns the next obligation index it
 * wants to claim) or sleeps (returns null).
 *
 * Phase 3 will broaden this to ledger-state predicates per overhaul guide
 * §4.3 (stigmergic coordination); the function signature deliberately
 * mirrors what Phase 3 will need.
 */
export type TriggerPredicate = (state: PopulationState) => number | null;

/**
 * Factory for the Phase 2 predicate: "fire when there is an unsatisfied
 * obligation of type X." Returns the index of the first matching pending
 * obligation, or null when none.
 */
export function unsatisfiedObligationOfType(type: ObligationType): TriggerPredicate {
  return (state: PopulationState): number | null => {
    for (let i = 0; i < state.obligations.length; i += 1) {
      const o = state.obligations[i];
      const s = state.status[i];
      if (!o || s === undefined) continue;
      if (s === 'pending' && o.type === type) return i;
    }
    return null;
  };
}

/**
 * For each obligation type the persona handles, build a Phase 2 trigger
 * predicate. Combined trigger: fires on any obligation with a type the
 * persona handles. Used by `selectPersonaForState` to walk the registry.
 */
export function personaTrigger(persona: PersonaSpec): TriggerPredicate {
  const predicates = persona.handles.map(unsatisfiedObligationOfType);
  return (state) => {
    for (const p of predicates) {
      const idx = p(state);
      if (idx !== null) return idx;
    }
    return null;
  };
}

/** A persona/obligation pairing the manager will execute next. */
export interface PersonaSelection {
  persona: PersonaSpec;
  obligationIndex: number;
}

/**
 * Walk the registry and return the first persona whose trigger predicate
 * fires for the given state. Phase 2 sequentializes execution, so we walk
 * in registration order and take the first match. Returns null when no
 * persona's predicate fires (i.e. all obligations are non-pending).
 */
export function selectPersonaForState(
  registry: PersonaRegistry,
  state: PopulationState,
): PersonaSelection | null {
  for (const persona of registry.list()) {
    const idx = personaTrigger(persona)(state);
    if (idx !== null) {
      return { persona, obligationIndex: idx };
    }
  }
  return null;
}
